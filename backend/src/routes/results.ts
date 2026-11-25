import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { resultsContract } from "@monkeytype/contracts/results";
import type {
  CompletedEvent,
  KeyStats,
  PostResultResponse,
  Result,
  ResultMinified,
} from "@monkeytype/schemas/results";
import type { Mode } from "@monkeytype/schemas/shared";
import { isToday, isYesterday } from "@monkeytype/util/date-and-time";
import { roundTo2, stdDev } from "@monkeytype/util/numbers";
import type { Handlers } from "../contract";
import { CONFIGURATION } from "../configuration";
import * as t from "../db/schema";
import type { AppContext } from "../env";
import { MonkeyError, Status } from "../error";
import { newId } from "../utils/misc";
import { isLeaderboardMode, updatePersonalBests } from "../utils/pb";
import { incrementTestActivity } from "../utils/test-activity";
import { calculateXp } from "../utils/xp";
import { getUser, type DBUser } from "./users";

const FIRST_RESULT_GRACE_MS = 10 * 60 * 1000;

type DBResult = typeof t.results.$inferSelect;

/** Row -> upstream's result shape (default values omitted, frontend fills them). */
function toApiResult(row: DBResult): ResultMinified & Record<string, unknown> {
  return {
    ...(row.data as Omit<ResultMinified, "_id">),
    _id: row.id,
    uid: row.uid,
    timestamp: row.timestamp,
    mode: row.mode as ResultMinified["mode"],
    mode2: row.mode2,
    wpm: row.wpm,
    acc: row.acc,
    ...(row.language !== "english" && {
      language: row.language as ResultMinified["language"],
    }),
    ...(row.isPb && { isPb: true }),
  };
}

async function getResultRow(c: AppContext, id: string): Promise<DBResult> {
  const row = await c.var.db.query.results.findFirst({
    where: and(eq(t.results.id, id), eq(t.results.uid, c.var.token.uid)),
  });
  if (row === undefined) throw new MonkeyError(404, "Result not found");
  return row;
}

function fullResult(row: DBResult, name: string): Result<Mode> {
  return {
    ...toApiResult(row),
    name,
    chartData: row.chartData ?? "toolong",
    keySpacingStats: row.keySpacingStats ?? undefined,
    keyDurationStats: row.keyDurationStats ?? undefined,
  };
}

function keyStats(values: number[] | "toolong"): KeyStats | undefined {
  if (values === "toolong" || values.length === 0) return undefined;
  return {
    average: roundTo2(values.reduce((a, b) => a + b, 0) / values.length),
    sd: roundTo2(stdDev(values)),
  };
}

/** Test lengths below which results are not saved (port of upstream). */
export function isTestTooShort(result: CompletedEvent): boolean {
  const { mode, mode2, customText, testDuration, bailedOut } = result;
  const bailedOutTooShort = bailedOut && testDuration < 15;
  if (mode === "time" || mode === "words") {
    const n = parseInt(mode2);
    const min = mode === "time" ? 15 : 10;
    return (
      (n > 0 && n < min) || (n === 0 && testDuration < 15) || bailedOutTooShort
    );
  }
  if (mode === "custom") {
    if (!customText) return true;
    const { mode: limitMode, value } = customText.limit;
    return (
      ((limitMode === "word" || limitMode === "section") && value < 10) ||
      (limitMode === "time" && value < 15) ||
      bailedOutTooShort
    );
  }
  if (mode === "zen") return testDuration < 15;
  return false;
}

function nextStreak(
  streak: DBUser["streak"],
  timestamp: number,
): NonNullable<DBUser["streak"]> {
  const next = {
    length: streak?.length ?? 0,
    maxLength: streak?.maxLength ?? 0,
    lastResultTimestamp: streak?.lastResultTimestamp ?? 0,
    ...(streak?.hourOffset !== undefined && { hourOffset: streak.hourOffset }),
  };
  const offset = next.hourOffset ?? 0;
  if (isYesterday(next.lastResultTimestamp, offset)) next.length += 1;
  else if (!isToday(next.lastResultTimestamp, offset)) next.length = 1;
  next.maxLength = Math.max(next.maxLength, next.length);
  next.lastResultTimestamp = timestamp;
  return next;
}

export async function addResult(
  c: AppContext,
  user: DBUser,
  ce: CompletedEvent,
  now = Date.now(),
): Promise<PostResultResponse> {
  const { db } = c.var;
  const uid = user.uid;
  if (user.needsToChangeName) {
    throw new MonkeyError(
      403,
      "Please change your name before submitting a result",
    );
  }
  if (isTestTooShort(ce)) {
    throw new MonkeyError(Status.TEST_TOO_SHORT, "Test too short");
  }
  if (!user.lbOptOut && ce.acc < 75) {
    throw new MonkeyError(400, "Accuracy too low");
  }

  const last = await db
    .select({ timestamp: t.results.timestamp })
    .from(t.results)
    .where(eq(t.results.uid, uid))
    .orderBy(desc(t.results.timestamp))
    .limit(1)
    .get();
  // client supplied abandoned-test time can't be bounded without a previous result
  if (last === undefined) {
    ce.incompleteTestSeconds = 0;
    ce.incompleteTests = [];
  }
  ce.timestamp = Math.floor(now / 1000) * 1000;
  const accountStart = user.addedAt - FIRST_RESULT_GRACE_MS;
  const spacingBase = last?.timestamp ?? accountStart;
  const earliestPossible =
    spacingBase + ce.testDuration * 1000 + ce.incompleteTestSeconds * 1000;
  if (ce.timestamp < earliestPossible - 1000) {
    throw new MonkeyError(
      Status.RESULT_SPACING_INVALID,
      "Invalid result spacing",
    );
  }

  const keySpacingStats = keyStats(ce.keySpacing);
  const keyDurationStats = keyStats(ce.keyDuration);
  if (
    ce.mode === "time" &&
    ce.wpm > 130 &&
    ce.testDuration < 122 &&
    !user.verified &&
    !user.lbOptOut &&
    (keySpacingStats === undefined || keyDurationStats === undefined)
  ) {
    throw new MonkeyError(Status.MISSING_KEY_DATA, "Missing key data");
  }

  let lastHashes = user.lastResultHashes;
  if (CONFIGURATION.users.lastHashesCheck.enabled) {
    if (lastHashes.includes(ce.hash)) {
      throw new MonkeyError(Status.DUPLICATE_RESULT, "Duplicate result");
    }
    lastHashes = [ce.hash, ...lastHashes].slice(
      0,
      CONFIGURATION.users.lastHashesCheck.maxHashes,
    );
  }

  // funbox is cut: such results are saved but never PBs
  const canPb =
    !ce.bailedOut &&
    ce.funbox.length === 0 &&
    ce.mode !== "quote" &&
    !(ce.stopOnLetter && ce.acc < 100);
  const isPb = canPb && updatePersonalBests(user.personalBests, ce);
  const tagPbs: string[] = [];
  if (canPb) {
    for (const tag of user.tags) {
      if (
        ce.tags.includes(tag._id) &&
        updatePersonalBests(tag.personalBests, ce)
      ) {
        tagPbs.push(tag._id);
      }
    }
  }

  const streak = nextStreak(user.streak, ce.timestamp);
  const xp = calculateXp(
    ce,
    CONFIGURATION.users.xp,
    last?.timestamp,
    user.xp,
    streak.length,
  );
  incrementTestActivity(user.testActivity, ce.timestamp);
  const timeTyped = ce.testDuration + ce.incompleteTestSeconds - ce.afkDuration;

  const id = newId();
  // defaults are omitted to keep rows small, like upstream
  const data: Record<string, unknown> = {
    rawWpm: ce.rawWpm,
    charStats: ce.charStats,
    consistency: ce.consistency,
    keyConsistency: ce.keyConsistency,
    testDuration: ce.testDuration,
    ...(ce.mode === "quote" && { quoteLength: ce.quoteLength }),
    ...(ce.restartCount > 0 && { restartCount: ce.restartCount }),
    ...(ce.incompleteTestSeconds > 0 && {
      incompleteTestSeconds: ce.incompleteTestSeconds,
    }),
    ...(ce.afkDuration > 0 && { afkDuration: ce.afkDuration }),
    ...(ce.tags.length > 0 && { tags: ce.tags }),
    ...(ce.bailedOut && { bailedOut: true }),
    ...(ce.blindMode && { blindMode: true }),
    ...(ce.lazyMode && { lazyMode: true }),
    ...(ce.funbox.length > 0 && { funbox: ce.funbox }),
    ...(ce.difficulty !== "normal" && { difficulty: ce.difficulty }),
    ...(ce.numbers && { numbers: true }),
    ...(ce.punctuation && { punctuation: true }),
  };

  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    db.insert(t.results).values({
      id,
      uid,
      timestamp: ce.timestamp,
      mode: ce.mode,
      mode2: ce.mode2,
      language: ce.language,
      wpm: ce.wpm,
      acc: ce.acc,
      isPb,
      data,
      chartData: ce.chartData,
      keySpacingStats,
      keyDurationStats,
    }),
    db
      .update(t.users)
      .set({
        personalBests: user.personalBests,
        tags: user.tags,
        lastResultHashes: lastHashes,
        streak,
        testActivity: user.testActivity,
        xp: sql`${t.users.xp} + ${xp.xp}`,
        startedTests: sql`${t.users.startedTests} + ${ce.restartCount + 1}`,
        completedTests: sql`${t.users.completedTests} + 1`,
        timeTyping: sql`${t.users.timeTyping} + ${timeTyped}`,
      })
      .where(eq(t.users.uid, uid)),
    db
      .insert(t.publicStats)
      .values({
        id: 1,
        testsCompleted: 1,
        testsStarted: ce.restartCount + 1,
        timeTyping: timeTyped,
      })
      .onConflictDoUpdate({
        target: t.publicStats.id,
        set: {
          testsCompleted: sql`${t.publicStats.testsCompleted} + 1`,
          testsStarted: sql`${t.publicStats.testsStarted} + excluded.tests_started`,
          timeTyping: sql`${t.publicStats.timeTyping} + excluded.time_typing`,
        },
      }),
  ];

  if (isPb && isLeaderboardMode(ce) && !user.banned && !user.lbOptOut) {
    statements.push(
      db
        .insert(t.leaderboardEntries)
        .values({
          mode: ce.mode,
          mode2: ce.mode2,
          language: ce.language,
          uid,
          wpm: ce.wpm,
          acc: ce.acc,
          raw: ce.rawWpm,
          consistency: ce.consistency,
          timestamp: ce.timestamp,
        })
        .onConflictDoUpdate({
          target: [
            t.leaderboardEntries.mode,
            t.leaderboardEntries.mode2,
            t.leaderboardEntries.language,
            t.leaderboardEntries.uid,
          ],
          set: {
            wpm: sql`excluded.wpm`,
            acc: sql`excluded.acc`,
            raw: sql`excluded.raw`,
            consistency: sql`excluded.consistency`,
            timestamp: sql`excluded.timestamp`,
          },
          setWhere: sql`excluded.wpm > ${t.leaderboardEntries.wpm}`,
        }),
    );
  }

  await db.batch(statements);

  return {
    isPb,
    tagPbs,
    insertedId: id,
    xp: xp.xp,
    dailyXpBonus: xp.dailyBonus,
    xpBreakdown: xp.breakdown,
    streak: streak.length,
  };
}

export const results: Handlers<typeof resultsContract> = {
  async get({ query }, c) {
    const { onOrAfterTimestamp, offset = 0 } = query;
    const max = CONFIGURATION.results.limits.regularUser;
    let limit =
      query.limit ?? Math.min(CONFIGURATION.results.maxBatchSize, max);
    if (limit + offset > max) {
      if (offset >= max) {
        throw new MonkeyError(422, `Max results limit of ${max} exceeded.`);
      }
      limit = max - offset;
    }
    const rows = await c.var.db
      .select({
        id: t.results.id,
        uid: t.results.uid,
        timestamp: t.results.timestamp,
        mode: t.results.mode,
        mode2: t.results.mode2,
        language: t.results.language,
        wpm: t.results.wpm,
        acc: t.results.acc,
        isPb: t.results.isPb,
        data: t.results.data,
      })
      .from(t.results)
      .where(
        and(
          eq(t.results.uid, c.var.token.uid),
          onOrAfterTimestamp === undefined
            ? undefined
            : gte(t.results.timestamp, onOrAfterTimestamp),
        ),
      )
      .orderBy(desc(t.results.timestamp))
      .limit(limit)
      .offset(offset);
    return {
      message: "Results retrieved",
      data: rows.map((it) =>
        toApiResult({
          ...it,
          chartData: null,
          keySpacingStats: null,
          keyDurationStats: null,
        }),
      ),
    };
  },

  async getById({ params }, c) {
    const [row, user] = await Promise.all([
      getResultRow(c, params.resultId),
      getUser(c, c.var.token.uid),
    ]);
    return { message: "Result retrieved", data: fullResult(row, user.name) };
  },

  async getLast(_req, c) {
    const row = await c.var.db.query.results.findFirst({
      where: eq(t.results.uid, c.var.token.uid),
      orderBy: desc(t.results.timestamp),
    });
    if (row === undefined) throw new MonkeyError(404, "No last result found");
    const user = await getUser(c, c.var.token.uid);
    return { message: "Result retrieved", data: fullResult(row, user.name) };
  },

  async add({ body }, c) {
    const user = await getUser(c, c.var.token.uid);
    return {
      message: "Result saved",
      data: await addResult(c, user, body.result),
    };
  },

  async updateTags({ body }, c) {
    const [row, user] = await Promise.all([
      getResultRow(c, body.resultId),
      getUser(c, c.var.token.uid),
    ]);
    const userTagIds = new Set(user.tags.map((it) => it._id));
    if (!body.tagIds.every((it) => userTagIds.has(it))) {
      throw new MonkeyError(422, "One of the tag id's is not valid");
    }
    const { tags: _old, ...data } = row.data;
    await c.var.db
      .update(t.results)
      .set({
        data: body.tagIds.length > 0 ? { ...data, tags: body.tagIds } : data,
      })
      .where(eq(t.results.id, row.id));

    const result = toApiResult(row);
    const tagPbs: string[] = [];
    const canPb =
      result.funbox === undefined &&
      row.mode !== "quote" &&
      result.bailedOut !== true;
    if (canPb) {
      const pbInput: Parameters<typeof updatePersonalBests>[1] = {
        mode: result.mode,
        mode2: result.mode2,
        wpm: result.wpm,
        rawWpm: result.rawWpm,
        acc: result.acc,
        consistency: result.consistency,
        difficulty: result.difficulty ?? "normal",
        language: result.language ?? "english",
        punctuation: result.punctuation ?? false,
        numbers: result.numbers ?? false,
        lazyMode: result.lazyMode ?? false,
      };
      for (const tag of user.tags) {
        if (
          body.tagIds.includes(tag._id) &&
          updatePersonalBests(tag.personalBests, pbInput)
        ) {
          tagPbs.push(tag._id);
        }
      }
      if (tagPbs.length > 0) {
        await c.var.db
          .update(t.users)
          .set({ tags: user.tags })
          .where(eq(t.users.uid, user.uid));
      }
    }
    return { message: "Result tags updated", data: { tagPbs } };
  },
};
