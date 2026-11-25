import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { devContract } from "@monkeytype/contracts/dev";
import type { Mode } from "@monkeytype/schemas/shared";
import { MILLISECONDS_IN_DAY } from "@monkeytype/util/date-and-time";
import { roundTo2 } from "@monkeytype/util/numbers";
import type { Handlers } from "../contract";
import * as t from "../db/schema";
import { isDev, type AppContext } from "../env";
import { MonkeyError } from "../error";
import { newId } from "../utils/misc";
import {
  emptyPersonalBests,
  isLeaderboardMode,
  updatePersonalBests,
} from "../utils/pb";
import { incrementTestActivity } from "../utils/test-activity";
import type { DBUser } from "./users";

const random = (min: number, max: number): number =>
  roundTo2(Math.random() * (max - min) + min);
const pick = <T>(values: T[]): T =>
  values[Math.floor(Math.random() * values.length)] as T;

/** Sign up a user in the Auth Emulator (dev only). */
async function createEmulatorUser(
  c: AppContext,
  email: string,
  password: string,
): Promise<string> {
  const host = c.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (host === undefined) {
    throw new MonkeyError(400, "createUser needs the Firebase Auth Emulator");
  }
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${c.env.FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { localId?: string; error?: unknown };
  if (body.localId === undefined) {
    throw new MonkeyError(
      500,
      `Emulator sign up failed: ${JSON.stringify(body.error)}`,
    );
  }
  return body.localId;
}

/** Insert random results into a user's history, updating PBs/leaderboards like a real save. */
export async function generateResults(
  c: AppContext,
  user: DBUser,
  firstTimestamp: number,
  lastTimestamp: number,
  minPerDay: number,
  maxPerDay: number,
): Promise<void> {
  const { db } = c.var;
  const statements: BatchItem<"sqlite">[] = [];
  let completed = 0;
  let timeTyping = 0;
  for (
    let day = firstTimestamp;
    day <= lastTimestamp;
    day += MILLISECONDS_IN_DAY
  ) {
    let timestamp = day - (day % MILLISECONDS_IN_DAY);
    for (let i = Math.round(random(minPerDay, maxPerDay)); i > 0; i--) {
      const mode: Mode = pick(["time", "words"]);
      const mode2 = pick(
        mode === "time" ? ["15", "30", "60", "120"] : ["10", "25", "50", "100"],
      );
      const testDuration = parseInt(mode2);
      timestamp += testDuration * 1000;
      const r = {
        mode,
        mode2,
        wpm: random(80, 120),
        rawWpm: random(80, 120),
        acc: random(80, 100),
        consistency: random(80, 100),
        difficulty: "normal" as const,
        language: "english" as const,
        punctuation: false,
        numbers: false,
        lazyMode: false,
      };
      const isPb = updatePersonalBests(user.personalBests, r);
      incrementTestActivity(user.testActivity, timestamp);
      completed++;
      timeTyping += testDuration;
      statements.push(
        db.insert(t.results).values({
          id: newId(),
          uid: user.uid,
          timestamp,
          mode,
          mode2,
          language: "english",
          wpm: r.wpm,
          acc: r.acc,
          isPb,
          data: {
            rawWpm: r.rawWpm,
            charStats: [131, 0, 0, 0],
            consistency: r.consistency,
            keyConsistency: 33.18,
            testDuration,
          },
          chartData: {
            wpm: Array.from({ length: testDuration }, () => random(80, 120)),
            burst: Array.from({ length: testDuration }, () =>
              Math.round(random(80, 120)),
            ),
            err: Array.from({ length: testDuration }, () =>
              Math.random() < 0.1 ? 1 : 0,
            ),
          },
        }),
      );
      if (isPb && isLeaderboardMode(r)) {
        statements.push(
          db
            .insert(t.leaderboardEntries)
            .values({ ...r, raw: r.rawWpm, uid: user.uid, timestamp })
            .onConflictDoUpdate({
              target: [
                t.leaderboardEntries.mode,
                t.leaderboardEntries.mode2,
                t.leaderboardEntries.language,
                t.leaderboardEntries.uid,
              ],
              set: {
                wpm: r.wpm,
                acc: r.acc,
                raw: r.rawWpm,
                consistency: r.consistency,
                timestamp,
              },
            }),
        );
      }
    }
  }
  statements.push(
    db
      .update(t.users)
      .set({
        personalBests: user.personalBests,
        testActivity: user.testActivity,
        completedTests: sql`${t.users.completedTests} + ${completed}`,
        startedTests: sql`${t.users.startedTests} + ${completed}`,
        timeTyping: sql`${t.users.timeTyping} + ${timeTyping}`,
      })
      .where(eq(t.users.uid, user.uid)),
  );
  // D1 batches are limited in size: chunk them
  for (let i = 0; i < statements.length; i += 50) {
    const chunk = statements.slice(i, i + 50);
    await db.batch(chunk as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
}

export const dev: Handlers<typeof devContract> = {
  async generateData({ body }, c) {
    if (!isDev(c)) {
      throw new MonkeyError(
        503,
        "Development endpoints are only available in dev mode",
      );
    }
    const email = `${body.username}@example.com`;
    let user = await c.var.db.query.users.findFirst({
      where: eq(t.users.name, body.username),
    });
    if (user === undefined) {
      if (body.createUser !== true) {
        throw new MonkeyError(404, `User ${body.username} does not exist.`);
      }
      const uid = await createEmulatorUser(c, email, "password");
      [user] = await c.var.db
        .insert(t.users)
        .values({
          uid,
          name: body.username,
          email,
          addedAt: Date.now(),
          personalBests: emptyPersonalBests(),
          verified: true,
        })
        .returning();
    }
    if (user === undefined) throw new MonkeyError(500, "User not created");

    const now = Date.now();
    const ninetyDaysAgo = now - 90 * MILLISECONDS_IN_DAY;
    const yesterday = now - MILLISECONDS_IN_DAY;
    await generateResults(
      c,
      user,
      body.firstTestTimestamp ?? ninetyDaysAgo,
      body.lastTestTimestamp ?? yesterday,
      body.minTestsPerDay ?? 0,
      body.maxTestsPerDay ?? 5,
    );
    return {
      message: "test data created",
      data: { uid: user.uid, email: user.email },
    };
  },
};
