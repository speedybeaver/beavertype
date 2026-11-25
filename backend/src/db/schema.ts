import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { PersonalBests } from "@monkeytype/schemas/shared";
import type {
  CountByYearAndDay,
  CustomTheme,
  FavoriteQuotes,
  ResultFilters,
  UserLbMemory,
  UserProfileDetails,
  UserQuoteRatings,
  UserStreak,
  UserTag,
} from "@monkeytype/schemas/users";
import type { PartialConfig } from "@monkeytype/schemas/configs";
import type { ChartData, KeyStats } from "@monkeytype/schemas/results";
import type { Preset } from "@monkeytype/schemas/presets";

// oxlint-disable-next-line explicit-function-return-type -- drizzle builder types
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
// oxlint-disable-next-line explicit-function-return-type -- drizzle builder types
const bool = (name: string) =>
  integer(name, { mode: "boolean" }).notNull().default(false);

export const users = sqliteTable(
  "users",
  {
    uid: text("uid").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    addedAt: integer("added_at").notNull(),
    banned: bool("banned"),
    lbOptOut: bool("lb_opt_out"),
    verified: bool("verified"),
    needsToChangeName: bool("needs_to_change_name"),
    lastNameChange: integer("last_name_change"),
    xp: integer("xp").notNull().default(0),
    startedTests: integer("started_tests").notNull().default(0),
    completedTests: integer("completed_tests").notNull().default(0),
    timeTyping: real("time_typing").notNull().default(0),
    personalBests: json<PersonalBests>("personal_bests").notNull(),
    tags: json<UserTag[]>("tags").notNull().default([]),
    customThemes: json<CustomTheme[]>("custom_themes").notNull().default([]),
    resultFilterPresets: json<ResultFilters[]>("result_filter_presets")
      .notNull()
      .default([]),
    streak: json<UserStreak>("streak"),
    testActivity: json<CountByYearAndDay>("test_activity")
      .notNull()
      .default({}),
    lbMemory: json<UserLbMemory>("lb_memory"),
    favoriteQuotes: json<FavoriteQuotes>("favorite_quotes"),
    quoteRatings: json<UserQuoteRatings>("quote_ratings"),
    profileDetails: json<UserProfileDetails>("profile_details"),
    lastResultHashes: json<string[]>("last_result_hashes")
      .notNull()
      .default([]),
  },
  (t) => [uniqueIndex("users_name_lower").on(sql`lower(${t.name})`)],
);

export const results = sqliteTable(
  "results",
  {
    id: text("id").primaryKey(),
    uid: text("uid")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    timestamp: integer("timestamp").notNull(),
    mode: text("mode").notNull(),
    mode2: text("mode2").notNull(),
    language: text("language").notNull(),
    wpm: real("wpm").notNull(),
    acc: real("acc").notNull(),
    isPb: bool("is_pb"),
    // the rest of ResultMinified (charStats, rawWpm, consistency, tags, ...)
    data: json<Record<string, unknown>>("data").notNull(),
    // only read by single result endpoints
    chartData: json<ChartData | "toolong">("chart_data"),
    keySpacingStats: json<KeyStats>("key_spacing_stats"),
    keyDurationStats: json<KeyStats>("key_duration_stats"),
  },
  (t) => [index("results_uid_timestamp").on(t.uid, t.timestamp)],
);

// best result per user for each leaderboard (time 15/60, per language)
export const leaderboardEntries = sqliteTable(
  "leaderboard_entries",
  {
    mode: text("mode").notNull(),
    mode2: text("mode2").notNull(),
    language: text("language").notNull(),
    uid: text("uid")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    wpm: real("wpm").notNull(),
    acc: real("acc").notNull(),
    raw: real("raw").notNull(),
    consistency: real("consistency").notNull(),
    timestamp: integer("timestamp").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.mode, t.mode2, t.language, t.uid] }),
    index("leaderboard_rank").on(
      t.mode,
      t.mode2,
      t.language,
      sql`${t.wpm} desc`,
      sql`${t.acc} desc`,
      t.timestamp,
    ),
  ],
);

export const configs = sqliteTable("configs", {
  uid: text("uid")
    .primaryKey()
    .references(() => users.uid, { onDelete: "cascade" }),
  config: json<PartialConfig>("config").notNull(),
});

export const presets = sqliteTable(
  "presets",
  {
    id: text("id").primaryKey(),
    uid: text("uid")
      .notNull()
      .references(() => users.uid, { onDelete: "cascade" }),
    name: text("name").notNull(),
    settingGroups: json<Preset["settingGroups"]>("setting_groups"),
    config: json<Preset["config"]>("config").notNull(),
  },
  (t) => [index("presets_uid").on(t.uid)],
);

// upstream "PSAs"
export const announcements = sqliteTable("announcements", {
  id: text("id").primaryKey(),
  message: text("message").notNull(),
  date: integer("date"),
  level: integer("level"),
  sticky: integer("sticky", { mode: "boolean" }),
});

export const quoteRatings = sqliteTable(
  "quote_ratings",
  {
    language: text("language").notNull(),
    quoteId: integer("quote_id").notNull(),
    ratings: integer("ratings").notNull(),
    totalRating: integer("total_rating").notNull(),
  },
  (t) => [primaryKey({ columns: [t.language, t.quoteId] })],
);

// single row (id = 1) of site wide counters
export const publicStats = sqliteTable("public_stats", {
  id: integer("id").primaryKey(),
  testsCompleted: integer("tests_completed").notNull().default(0),
  testsStarted: integer("tests_started").notNull().default(0),
  timeTyping: real("time_typing").notNull().default(0),
});
