import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import type { leaderboardsContract } from "@monkeytype/contracts/leaderboards";
import type { LeaderboardEntry } from "@monkeytype/schemas/leaderboards";
import type { Handlers } from "../contract";
import { CONFIGURATION } from "../configuration";
import * as t from "../db/schema";
import { isDev, type AppContext } from "../env";
import { MonkeyError } from "../error";

const lb = t.leaderboardEntries;

/**
 * Leaderboards are read live from `leaderboard_entries` (one row per user and
 * leaderboard, written only when a result beats the user's entry). Ranks are
 * positions in the (wpm desc, acc desc, timestamp asc) order.
 */
function visible(
  c: AppContext,
  mode: string,
  mode2: string,
  language: string,
): SQL {
  return and(
    eq(lb.mode, mode),
    eq(lb.mode2, mode2),
    eq(lb.language, language),
    eq(t.users.banned, false),
    eq(t.users.lbOptOut, false),
    gte(
      t.users.timeTyping,
      isDev(c) ? 0 : CONFIGURATION.leaderboards.minTimeTyping,
    ),
  ) as SQL;
}

const entryColumns = {
  uid: lb.uid,
  name: t.users.name,
  wpm: lb.wpm,
  acc: lb.acc,
  raw: lb.raw,
  consistency: lb.consistency,
  timestamp: lb.timestamp,
};

// ponytail: count scans the whole leaderboard per request (D1 rows read = entries).
// Cache it (KV or a cron-updated row) if leaderboards grow past ~10k entries.
async function getCount(
  c: AppContext,
  mode: string,
  mode2: string,
  language: string,
): Promise<number> {
  const row = await c.var.db
    .select({ count: count() })
    .from(lb)
    .innerJoin(t.users, eq(t.users.uid, lb.uid))
    .where(visible(c, mode, mode2, language))
    .get();
  return row?.count ?? 0;
}

export async function getRank(
  c: AppContext,
  mode: string,
  mode2: string,
  language: string,
  uid: string,
): Promise<(LeaderboardEntry & { count: number }) | null> {
  const where = visible(c, mode, mode2, language);
  const entry = await c.var.db
    .select(entryColumns)
    .from(lb)
    .innerJoin(t.users, eq(t.users.uid, lb.uid))
    .where(and(where, eq(lb.uid, uid)))
    .get();
  if (entry === undefined) return null;
  const ahead = await c.var.db
    .select({ count: count() })
    .from(lb)
    .innerJoin(t.users, eq(t.users.uid, lb.uid))
    .where(
      and(
        where,
        or(
          gt(lb.wpm, entry.wpm),
          and(eq(lb.wpm, entry.wpm), gt(lb.acc, entry.acc)),
          and(
            eq(lb.wpm, entry.wpm),
            eq(lb.acc, entry.acc),
            lt(lb.timestamp, entry.timestamp),
          ),
        ),
      ),
    )
    .get();
  return {
    ...entry,
    rank: (ahead?.count ?? 0) + 1,
    count: await getCount(c, mode, mode2, language),
  };
}

function checkMode(mode: string, mode2: string, language: string): void {
  if (
    mode !== "time" ||
    (mode2 !== "15" && mode2 !== "60") ||
    language !== "english"
  ) {
    throw new MonkeyError(404, "There is no leaderboard for this mode");
  }
}

function checkNoFriends(friendsOnly: boolean | undefined): void {
  if (friendsOnly === true) {
    throw new MonkeyError(503, "This feature is currently unavailable.");
  }
}

export const leaderboards: Handlers<typeof leaderboardsContract> = {
  async get({ query }, c) {
    const { mode, mode2, language, page, pageSize } = query;
    checkMode(mode, mode2, language);
    checkNoFriends(query.friendsOnly);
    const rows = await c.var.db
      .select(entryColumns)
      .from(lb)
      .innerJoin(t.users, eq(t.users.uid, lb.uid))
      .where(visible(c, mode, mode2, language))
      .orderBy(desc(lb.wpm), desc(lb.acc), asc(lb.timestamp))
      .limit(pageSize)
      .offset(page * pageSize);
    return {
      message: "Leaderboard retrieved",
      data: {
        count: await getCount(c, mode, mode2, language),
        pageSize,
        entries: rows.map((it, i) => ({
          ...it,
          rank: page * pageSize + i + 1,
        })),
      },
    };
  },

  async getRank({ query }, c) {
    checkNoFriends(query.friendsOnly);
    const rank = await getRank(
      c,
      query.mode,
      query.mode2,
      query.language,
      c.var.token.uid,
    );
    if (rank === null) return { message: "Rank retrieved", data: null };
    const { count: _count, ...entry } = rank;
    return { message: "Rank retrieved", data: entry };
  },
};
