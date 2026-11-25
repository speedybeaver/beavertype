import { and, count, eq, sql } from "drizzle-orm";
import type { publicContract } from "@monkeytype/contracts/public";
import type { Handlers } from "../contract";
import * as t from "../db/schema";

const lb = t.leaderboardEntries;

export const publicStats: Handlers<typeof publicContract> = {
  // computed live from leaderboard entries (upstream: a cron job over all users)
  async getSpeedHistogram({ query }, c) {
    const bucket = sql<number>`cast(${lb.wpm} / 10 as int) * 10`;
    const rows = await c.var.db
      .select({ bucket, count: count() })
      .from(lb)
      .where(
        and(
          eq(lb.mode, query.mode),
          eq(lb.mode2, query.mode2),
          eq(lb.language, query.language),
        ),
      )
      .groupBy(bucket);
    return {
      message: "Public speed histogram retrieved",
      data: Object.fromEntries(
        rows.map((it) => [it.bucket.toString(), it.count]),
      ),
    };
  },

  async getTypingStats(_req, c) {
    const row = await c.var.db.select().from(t.publicStats).get();
    return {
      message: "Public typing stats retrieved",
      data: {
        testsCompleted: row?.testsCompleted ?? 0,
        testsStarted: row?.testsStarted ?? 0,
        timeTyping: row?.timeTyping ?? 0,
      },
    };
  },
};
