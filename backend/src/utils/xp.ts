import type { Configuration } from "@monkeytype/schemas/configuration";
import type { CompletedEvent, XpBreakdown } from "@monkeytype/schemas/results";
import { isSafeNumber, mapRange } from "@monkeytype/util/numbers";
import {
  getCurrentDayTimestamp,
  getStartOfDayTimestamp,
} from "@monkeytype/util/date-and-time";

export type XpResult = {
  xp: number;
  dailyBonus: boolean;
  breakdown: XpBreakdown;
};

/** Port of upstream's calculateXp (funbox bonus dropped, funbox is cut). */
export function calculateXp(
  result: CompletedEvent,
  config: Configuration["users"]["xp"],
  lastResultTimestamp: number | undefined,
  currentTotalXp: number,
  streak: number,
): XpResult {
  const { mode, acc, testDuration, incompleteTestSeconds, incompleteTests } =
    result;
  if (mode === "zen" || !config.enabled) {
    return { xp: 0, dailyBonus: false, breakdown: {} };
  }

  const breakdown: XpBreakdown = {};
  const baseXp = Math.round((testDuration - result.afkDuration) * 2);
  breakdown.base = baseXp;
  let modifier = 1;

  const correctedEverything = result.charStats.slice(1).every((it) => it === 0);
  if (acc === 100) {
    modifier += 0.5;
    breakdown.fullAccuracy = Math.round(baseXp * 0.5);
  } else if (correctedEverything) {
    modifier += 0.25;
    breakdown.corrected = Math.round(baseXp * 0.25);
  }

  if (mode === "quote") {
    modifier += 0.5;
    breakdown.quote = Math.round(baseXp * 0.5);
  } else {
    if (result.punctuation) {
      modifier += 0.4;
      breakdown.punctuation = Math.round(baseXp * 0.4);
    }
    if (result.numbers) {
      modifier += 0.1;
      breakdown.numbers = Math.round(baseXp * 0.1);
    }
  }

  if (config.streak.enabled) {
    const streakModifier = parseFloat(
      mapRange(
        streak,
        0,
        config.streak.maxStreakDays,
        0,
        config.streak.maxStreakMultiplier,
        true,
      ).toFixed(1),
    );
    if (streakModifier > 0) {
      modifier += streakModifier;
      breakdown.streak = Math.round(baseXp * streakModifier);
    }
  }

  let incompleteXp = 0;
  if (incompleteTests.length > 0) {
    for (const it of incompleteTests) {
      incompleteXp += Math.round(it.seconds * Math.max((it.acc - 50) / 50, 0));
    }
    breakdown.incomplete = incompleteXp;
  } else if (incompleteTestSeconds > 0) {
    incompleteXp = Math.round(incompleteTestSeconds);
    breakdown.incomplete = incompleteXp;
  }

  let dailyBonus = 0;
  if (
    isSafeNumber(lastResultTimestamp) &&
    getStartOfDayTimestamp(lastResultTimestamp) !== getCurrentDayTimestamp()
  ) {
    dailyBonus = Math.max(
      Math.min(config.maxDailyBonus, Math.round(currentTotalXp * 0.05)),
      config.minDailyBonus,
    );
    breakdown.daily = dailyBonus;
  }

  const xpWithModifiers = Math.round(baseXp * modifier);
  const xpAfterAccuracy = Math.round(xpWithModifiers * ((acc - 50) / 50));
  breakdown.accPenalty = xpWithModifiers - xpAfterAccuracy;
  if (config.gainMultiplier !== 1) {
    breakdown.configMultiplier = config.gainMultiplier;
  }

  return {
    xp:
      Math.round((xpAfterAccuracy + incompleteXp) * config.gainMultiplier) +
      dailyBonus,
    dailyBonus: dailyBonus > 0,
    breakdown,
  };
}
