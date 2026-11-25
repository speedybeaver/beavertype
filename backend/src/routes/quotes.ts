import { and, eq, sql } from "drizzle-orm";
import type { quotesContract } from "@monkeytype/contracts/quotes";
import type { Handlers } from "../contract";
import { CONFIGURATION } from "../configuration";
import * as t from "../db/schema";
import { getUser } from "./users";

// quote submissions, approval and reports are cut
export const quotes: Handlers<typeof quotesContract> = {
  async isSubmissionEnabled() {
    const isEnabled = CONFIGURATION.quotes.submissionsEnabled;
    return {
      message: `Quote submission ${isEnabled ? "enabled" : "disabled"}`,
      data: { isEnabled },
    };
  },

  async getRating({ query }, c) {
    const row = await c.var.db.query.quoteRatings.findFirst({
      where: and(
        eq(t.quoteRatings.language, query.language),
        eq(t.quoteRatings.quoteId, query.quoteId),
      ),
    });
    return {
      message: "Rating retrieved",
      data:
        row === undefined
          ? null
          : {
              _id: `${row.language}_${row.quoteId}`,
              language: query.language,
              quoteId: row.quoteId,
              ratings: row.ratings,
              totalRating: row.totalRating,
              average: Math.round((row.totalRating / row.ratings) * 10) / 10,
            },
    };
  },

  async addRating({ body }, c) {
    const { quoteId, language, rating } = body;
    const user = await getUser(c, c.var.token.uid);
    const userRatings = user.quoteRatings ?? {};
    const previous = userRatings[language]?.[quoteId] ?? 0;
    (userRatings[language] ??= {})[quoteId] = rating;

    await c.var.db.batch([
      c.var.db
        .insert(t.quoteRatings)
        .values({ language, quoteId, ratings: 1, totalRating: rating })
        .onConflictDoUpdate({
          target: [t.quoteRatings.language, t.quoteRatings.quoteId],
          set: {
            ratings: sql`${t.quoteRatings.ratings} + ${previous === 0 ? 1 : 0}`,
            totalRating: sql`${t.quoteRatings.totalRating} + ${rating - previous}`,
          },
        }),
      c.var.db
        .update(t.users)
        .set({ quoteRatings: userRatings })
        .where(eq(t.users.uid, user.uid)),
    ]);
    return {
      message: `Rating ${previous === 0 ? "submitted" : "updated"}`,
      data: null,
    };
  },
};
