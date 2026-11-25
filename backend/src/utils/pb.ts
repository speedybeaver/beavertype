import type { PersonalBest, PersonalBests } from "@monkeytype/schemas/shared";
import type { CompletedEvent } from "@monkeytype/schemas/results";

export type PbResult = Pick<
  CompletedEvent,
  | "mode"
  | "mode2"
  | "wpm"
  | "rawWpm"
  | "acc"
  | "consistency"
  | "difficulty"
  | "language"
  | "punctuation"
  | "numbers"
  | "lazyMode"
>;

export const emptyPersonalBests = (): PersonalBests => ({
  time: {},
  words: {},
  quote: {},
  zen: {},
  custom: {},
});

/**
 * Update `pbs` in place with the result. Returns true if it is a new PB for
 * its mode/mode2/language/difficulty/punctuation/numbers/lazyMode combination.
 */
export function updatePersonalBests(
  pbs: PersonalBests,
  result: PbResult,
): boolean {
  const byMode2 = pbs[result.mode] as Record<string, PersonalBest[]>;
  const list = (byMode2[result.mode2] ??= []);
  const existing = list.find(
    (pb) =>
      (pb.lazyMode ?? false) === result.lazyMode &&
      (pb.punctuation ?? false) === result.punctuation &&
      (pb.numbers ?? false) === result.numbers &&
      pb.difficulty === result.difficulty &&
      pb.language === result.language,
  );
  if (existing !== undefined && existing.wpm >= result.wpm) return false;

  const pb: PersonalBest = {
    acc: result.acc,
    consistency: result.consistency,
    difficulty: result.difficulty,
    lazyMode: result.lazyMode,
    language: result.language,
    punctuation: result.punctuation,
    numbers: result.numbers,
    raw: result.rawWpm,
    wpm: result.wpm,
    timestamp: Date.now(),
  };
  if (existing === undefined) list.push(pb);
  else Object.assign(existing, pb);
  return true;
}

/** Leaderboards exist for english time 15 and 60, see `routes/leaderboards.ts`. */
export function isLeaderboardMode(r: {
  mode: string;
  mode2: string;
  lazyMode?: boolean;
}): boolean {
  return (
    r.mode === "time" &&
    (r.mode2 === "15" || r.mode2 === "60") &&
    r.lazyMode !== true
  );
}
