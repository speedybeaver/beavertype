import { eq, sql } from "drizzle-orm";
import type { usersContract } from "@monkeytype/contracts/users";
import type { User } from "@monkeytype/schemas/users";
import { MILLISECONDS_IN_DAY } from "@monkeytype/util/date-and-time";
import type { Handlers } from "../contract";
import { CONFIGURATION } from "../configuration";
import * as t from "../db/schema";
import type { AppContext } from "../env";
import { MonkeyError } from "../error";
import { identityToolkit, verifyCaptcha } from "../firebase";
import { newId } from "../utils/misc";
import { emptyPersonalBests } from "../utils/pb";
import { generateCurrentTestActivity } from "../utils/test-activity";
import { getRank } from "./leaderboards";

export type DBUser = typeof t.users.$inferSelect;

export async function getUser(c: AppContext, uid: string): Promise<DBUser> {
  const user = await c.var.db.query.users.findFirst({
    where: eq(t.users.uid, uid),
  });
  if (user === undefined) throw new MonkeyError(404, "User not found");
  return user;
}

async function updateUser(
  c: AppContext,
  values: Partial<DBUser>,
): Promise<void> {
  await c.var.db
    .update(t.users)
    .set(values)
    .where(eq(t.users.uid, c.var.token.uid));
}

async function isNameAvailable(
  c: AppContext,
  name: string,
  uid: string,
): Promise<boolean> {
  const taken = await c.var.db
    .select({ uid: t.users.uid })
    .from(t.users)
    .where(sql`lower(${t.users.name}) = lower(${name})`)
    .get();
  return taken === undefined || taken.uid === uid;
}

/** Delete everything a user owns except the user row (results, lbs, presets, config). */
async function deleteUserData(c: AppContext, uid: string): Promise<void> {
  const { db } = c.var;
  await db.batch([
    db.delete(t.results).where(eq(t.results.uid, uid)),
    db.delete(t.leaderboardEntries).where(eq(t.leaderboardEntries.uid, uid)),
    db.delete(t.presets).where(eq(t.presets.uid, uid)),
    db.delete(t.configs).where(eq(t.configs.uid, uid)),
  ]);
}

async function toApiUser(c: AppContext, user: DBUser): Promise<User> {
  const lbs = { time: { "15": {}, "60": {} } } as User["allTimeLbs"];
  for (const mode2 of ["15", "60"] as const) {
    const rank = await getRank(c, "time", mode2, "english", user.uid);
    if (rank !== null) {
      lbs.time[mode2] = { english: { rank: rank.rank, count: rank.count } };
    }
  }
  return {
    uid: user.uid,
    name: user.name,
    email: user.email,
    addedAt: user.addedAt,
    personalBests: user.personalBests,
    completedTests: user.completedTests,
    startedTests: user.startedTests,
    timeTyping: user.timeTyping,
    xp: user.xp,
    streak: user.streak ?? undefined,
    tags: user.tags,
    customThemes: user.customThemes,
    resultFilterPresets: user.resultFilterPresets,
    favoriteQuotes: user.favoriteQuotes ?? undefined,
    quoteRatings: user.quoteRatings ?? undefined,
    lbMemory: user.lbMemory ?? undefined,
    profileDetails: user.profileDetails ?? undefined,
    banned: user.banned || undefined,
    lbOptOut: user.lbOptOut || undefined,
    verified: user.verified || undefined,
    needsToChangeName: user.needsToChangeName || undefined,
    allTimeLbs: lbs,
    testActivity: generateCurrentTestActivity(user.testActivity),
  };
}

const uid = (c: AppContext): string => c.var.token.uid;
const ok = <T>(message: string, data: T): { message: string; data: T } => ({
  message,
  data,
});

export const users: Handlers<typeof usersContract> = {
  async get(_req, c) {
    const user = await getUser(c, uid(c));
    return ok("User data retrieved", {
      ...(await toApiUser(c, user)),
      inboxUnreadSize: 0,
    });
  },

  async create({ body }, c) {
    const { email } = c.var.token;
    await verifyCaptcha(c.env, body.captcha);
    if (!(await isNameAvailable(c, body.name, uid(c)))) {
      throw new MonkeyError(409, "Username unavailable");
    }
    const inserted = await c.var.db
      .insert(t.users)
      .values({
        uid: uid(c),
        name: body.name,
        email,
        addedAt: Date.now(),
        personalBests: emptyPersonalBests(),
      })
      .onConflictDoNothing()
      .returning({ uid: t.users.uid });
    if (inserted.length === 0) {
      throw new MonkeyError(409, "User document already exists");
    }
    return ok("User created", null);
  },

  async getNameAvailability({ params }, c) {
    return ok("Check username", {
      available: await isNameAvailable(c, params.name, uid(c)),
    });
  },

  async delete(_req, c) {
    await c.var.db.delete(t.users).where(eq(t.users.uid, uid(c)));
    await identityToolkit(c.env, "delete", { idToken: c.var.idToken });
    return ok("User deleted", null);
  },

  async reset(_req, c) {
    const user = await getUser(c, uid(c));
    if (user.banned) {
      throw new MonkeyError(403, "Banned users cannot reset their account");
    }
    await deleteUserData(c, user.uid);
    await updateUser(c, {
      personalBests: emptyPersonalBests(),
      completedTests: 0,
      startedTests: 0,
      timeTyping: 0,
      xp: 0,
      lbMemory: null,
      favoriteQuotes: null,
      profileDetails: null,
      customThemes: [],
      tags: [],
      streak: null,
      testActivity: {},
      lbOptOut: false,
    });
    return ok("User reset", null);
  },

  async updateName({ body }, c) {
    const user = await getUser(c, uid(c));
    if (user.banned) {
      throw new MonkeyError(403, "Banned users cannot change their name");
    }
    if (
      !user.needsToChangeName &&
      Date.now() - (user.lastNameChange ?? 0) < MILLISECONDS_IN_DAY * 30
    ) {
      throw new MonkeyError(409, "You can change your name once every 30 days");
    }
    if (!(await isNameAvailable(c, body.name, user.uid))) {
      throw new MonkeyError(409, "Username already taken");
    }
    await updateUser(c, {
      name: body.name,
      lastNameChange: Date.now(),
      needsToChangeName: false,
    });
    return ok("User's name updated", null);
  },

  async updateLeaderboardMemory({ body }, c) {
    const user = await getUser(c, uid(c));
    const memory = (user.lbMemory ?? {}) as Record<
      string,
      Record<string, Record<string, number>>
    >;
    ((memory[body.mode] ??= {})[body.mode2] ??= {})[body.language] = body.rank;
    await updateUser(c, { lbMemory: memory });
    return ok("Leaderboard memory updated", null);
  },

  async updateEmail({ body }, c) {
    const email = body.newEmail.toLowerCase();
    await identityToolkit(c.env, "update", { idToken: c.var.idToken, email });
    await updateUser(c, { email });
    return ok("Email updated", null);
  },

  async updatePassword({ body }, c) {
    await identityToolkit(c.env, "update", {
      idToken: c.var.idToken,
      password: body.newPassword,
    });
    return ok("Password updated", null);
  },

  async verificationEmail(_req, c) {
    await identityToolkit(c.env, "sendOobCode", {
      requestType: "VERIFY_EMAIL",
      idToken: c.var.idToken,
    });
    return ok("Email sent", null);
  },

  async forgotPasswordEmail({ body }, c) {
    await verifyCaptcha(c.env, body.captcha);
    await identityToolkit(c.env, "sendOobCode", {
      requestType: "PASSWORD_RESET",
      email: body.email,
    });
    return ok(
      "Password reset request received. If the email is valid, you will receive an email shortly.",
      null,
    );
  },

  async getPersonalBests({ query }, c) {
    const user = await getUser(c, uid(c));
    const byMode = user.personalBests[query.mode] as Record<string, unknown>;
    const data = query.mode2 === undefined ? byMode : byMode[query.mode2];
    // oxlint-disable-next-line no-explicit-any -- contract types this loosely
    return ok("Personal bests retrieved", (data ?? null) as any);
  },

  async deletePersonalBests(_req, c) {
    await updateUser(c, { personalBests: emptyPersonalBests() });
    await c.var.db
      .delete(t.leaderboardEntries)
      .where(eq(t.leaderboardEntries.uid, uid(c)));
    return ok("User's PB cleared", null);
  },

  async optOutOfLeaderboards(_req, c) {
    await updateUser(c, { lbOptOut: true });
    await c.var.db
      .delete(t.leaderboardEntries)
      .where(eq(t.leaderboardEntries.uid, uid(c)));
    return ok("User opted out of leaderboards", null);
  },

  async addResultFilterPreset({ body }, c) {
    const user = await getUser(c, uid(c));
    const max = CONFIGURATION.results.filterPresets.maxPresetsPerUser;
    if (user.resultFilterPresets.length >= max) {
      throw new MonkeyError(409, "Maximum number of filter presets reached");
    }
    const _id = newId();
    await updateUser(c, {
      resultFilterPresets: [...user.resultFilterPresets, { ...body, _id }],
    });
    return ok("Result filter preset created", _id);
  },

  async removeResultFilterPreset({ params }, c) {
    const user = await getUser(c, uid(c));
    const presets = user.resultFilterPresets.filter(
      (it) => it._id !== params.presetId,
    );
    if (presets.length === user.resultFilterPresets.length) {
      throw new MonkeyError(404, "Custom filter not found");
    }
    await updateUser(c, { resultFilterPresets: presets });
    return ok("Result filter preset deleted", null);
  },

  async getTags(_req, c) {
    return ok("Tags retrieved", (await getUser(c, uid(c))).tags);
  },

  async createTag({ body }, c) {
    const user = await getUser(c, uid(c));
    if (user.tags.length >= 15) {
      throw new MonkeyError(400, "You can only have up to 15 tags");
    }
    const tag = {
      _id: newId(),
      name: body.tagName,
      personalBests: emptyPersonalBests(),
    };
    await updateUser(c, { tags: [...user.tags, tag] });
    return ok("Tag updated", tag);
  },

  async editTag({ body }, c) {
    const user = await getUser(c, uid(c));
    const tag = user.tags.find((it) => it._id === body.tagId);
    if (tag === undefined) throw new MonkeyError(404, "Tag not found");
    tag.name = body.newName;
    await updateUser(c, { tags: user.tags });
    return ok("Tag updated", null);
  },

  async deleteTag({ params }, c) {
    const user = await getUser(c, uid(c));
    const tags = user.tags.filter((it) => it._id !== params.tagId);
    if (tags.length === user.tags.length) {
      throw new MonkeyError(404, "Tag not found");
    }
    await updateUser(c, { tags });
    return ok("Tag deleted", null);
  },

  async deleteTagPersonalBest({ params }, c) {
    const user = await getUser(c, uid(c));
    const tag = user.tags.find((it) => it._id === params.tagId);
    if (tag === undefined) throw new MonkeyError(404, "Tag not found");
    tag.personalBests = emptyPersonalBests();
    await updateUser(c, { tags: user.tags });
    return ok("Tag PB cleared", null);
  },

  async getCustomThemes(_req, c) {
    return ok(
      "Custom themes retrieved",
      (await getUser(c, uid(c))).customThemes,
    );
  },

  async addCustomTheme({ body }, c) {
    const user = await getUser(c, uid(c));
    if (user.customThemes.length >= 20) {
      throw new MonkeyError(409, "Too many custom themes");
    }
    const theme = { _id: newId(), name: body.name, colors: body.colors };
    await updateUser(c, { customThemes: [...user.customThemes, theme] });
    return ok("Custom theme added", { _id: theme._id, name: theme.name });
  },

  async deleteCustomTheme({ body }, c) {
    const user = await getUser(c, uid(c));
    const themes = user.customThemes.filter((it) => it._id !== body.themeId);
    if (themes.length === user.customThemes.length) {
      throw new MonkeyError(404, "Custom theme not found");
    }
    await updateUser(c, { customThemes: themes });
    return ok("Custom theme removed", null);
  },

  async editCustomTheme({ body }, c) {
    const user = await getUser(c, uid(c));
    const theme = user.customThemes.find((it) => it._id === body.themeId);
    if (theme === undefined) {
      throw new MonkeyError(404, "Custom theme not found");
    }
    Object.assign(theme, body.theme);
    await updateUser(c, { customThemes: user.customThemes });
    return ok("Custom theme updated", null);
  },

  async getStats(_req, c) {
    const user = await getUser(c, uid(c));
    return ok("Personal stats retrieved", {
      completedTests: user.completedTests,
      startedTests: user.startedTests,
      timeTyping: user.timeTyping,
    });
  },

  async setStreakHourOffset({ body }, c) {
    const user = await getUser(c, uid(c));
    if (user.streak?.hourOffset !== undefined) {
      throw new MonkeyError(403, "Streak hour offset already set");
    }
    await updateUser(c, {
      streak: {
        length: 0,
        maxLength: 0,
        ...user.streak,
        hourOffset: body.hourOffset,
        lastResultTimestamp: Date.now(),
      },
    });
    return ok("Streak hour offset set", null);
  },

  async getFavoriteQuotes(_req, c) {
    return ok(
      "Favorite quotes retrieved",
      (await getUser(c, uid(c))).favoriteQuotes ?? {},
    );
  },

  async addQuoteToFavorites({ body }, c) {
    const user = await getUser(c, uid(c));
    const favorites = user.favoriteQuotes ?? {};
    const count = Object.values(favorites).flat().length;
    if (count >= CONFIGURATION.quotes.maxFavorites) {
      throw new MonkeyError(409, "Maximum number of favorite quotes reached");
    }
    const list = (favorites[body.language] ??= []);
    if (!list.includes(body.quoteId)) list.push(body.quoteId);
    await updateUser(c, { favoriteQuotes: favorites });
    return ok("Quote added to favorites", null);
  },

  async removeQuoteFromFavorites({ body }, c) {
    const user = await getUser(c, uid(c));
    const favorites = user.favoriteQuotes ?? {};
    favorites[body.language] = (favorites[body.language] ?? []).filter(
      (it) => it !== body.quoteId,
    );
    await updateUser(c, { favoriteQuotes: favorites });
    return ok("Quote removed from favorites", null);
  },

  async getCurrentTestActivity(_req, c) {
    const user = await getUser(c, uid(c));
    return ok(
      "Current test activity data retrieved",
      generateCurrentTestActivity(user.testActivity) ?? null,
    );
  },

  async getStreak(_req, c) {
    return ok(
      "Streak data retrieved",
      (await getUser(c, uid(c))).streak ?? null,
    );
  },
};
