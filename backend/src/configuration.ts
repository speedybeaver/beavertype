import type { Configuration } from "@monkeytype/schemas/configuration";

/**
 * Server configuration served to the frontend. Lives in code: change it with a PR.
 * Cut features (ape keys, daily/weekly xp leaderboards, inbox, profiles,
 * discord, connections, quote submissions/reports, premium) stay disabled.
 */
export const CONFIGURATION: Configuration = {
  maintenance: false,
  dev: { responseSlowdownMs: 0 },
  results: {
    savingEnabled: true,
    objectHashCheckEnabled: false,
    filterPresets: { enabled: true, maxPresetsPerUser: 10 },
    limits: { regularUser: 1000, premiumUser: 1000 },
    maxBatchSize: 1000,
  },
  quotes: {
    reporting: { enabled: false, maxReports: 0, contentReportLimit: 0 },
    submissionsEnabled: false,
    maxFavorites: 100,
  },
  admin: { endpointsEnabled: false },
  apeKeys: {
    endpointsEnabled: false,
    acceptKeys: false,
    maxKeysPerUser: 0,
    apeKeyBytes: 24,
    apeKeySaltRounds: 5,
  },
  users: {
    signUp: true,
    lastHashesCheck: { enabled: true, maxHashes: 10 },
    discordIntegration: { enabled: false },
    autoBan: { enabled: false, maxCount: 5, maxHours: 1 },
    profiles: { enabled: false },
    xp: {
      enabled: true,
      funboxBonus: 0,
      gainMultiplier: 1,
      maxDailyBonus: 100,
      minDailyBonus: 10,
      streak: { enabled: true, maxStreakDays: 30, maxStreakMultiplier: 0.5 },
    },
    inbox: { enabled: false, maxMail: 0 },
    premium: { enabled: false },
  },
  rateLimiting: {
    badAuthentication: { enabled: false, penalty: 0, flaggedStatusCodes: [] },
  },
  dailyLeaderboards: {
    enabled: false,
    maxResults: 0,
    leaderboardExpirationTimeInDays: 0,
    validModeRules: [],
    scheduleRewardsModeRules: [],
    topResultsToAnnounce: 1,
    xpRewardBrackets: [],
  },
  leaderboards: {
    // seconds typed before a user shows up on leaderboards (ignored in dev)
    minTimeTyping: 2 * 60 * 60,
    weeklyXp: { enabled: false, expirationTimeInDays: 0, xpRewardBrackets: [] },
  },
  connections: { enabled: false, maxPerUser: 0 },
};
