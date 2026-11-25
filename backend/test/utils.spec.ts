import { describe, expect, it } from "vitest";
import { emptyPersonalBests, updatePersonalBests } from "../src/utils/pb";
import {
  generateCurrentTestActivity,
  incrementTestActivity,
} from "../src/utils/test-activity";
import { completedEvent } from "./helpers";

describe("updatePersonalBests", () => {
  it("tracks one PB per settings combination", () => {
    const pbs = emptyPersonalBests();
    expect(updatePersonalBests(pbs, completedEvent({ wpm: 100 }))).toBe(true);
    expect(updatePersonalBests(pbs, completedEvent({ wpm: 90 }))).toBe(false);
    expect(
      updatePersonalBests(pbs, completedEvent({ wpm: 90, punctuation: true })),
    ).toBe(true);
    expect(updatePersonalBests(pbs, completedEvent({ wpm: 101 }))).toBe(true);
    expect(pbs.time["15"]?.map((it) => it.wpm)).toEqual([101, 90]);
  });
});

describe("test activity", () => {
  it("counts tests per UTC day and builds the graph window", () => {
    const activity = {};
    const jan2 = Date.UTC(2026, 0, 2, 12);
    incrementTestActivity(activity, jan2);
    incrementTestActivity(activity, jan2);
    expect(activity).toEqual({ 2026: [null, 2] });
    const current = generateCurrentTestActivity(activity, jan2);
    expect(current?.testsByDays).toHaveLength(365 + 2);
    expect(current?.testsByDays.at(-1)).toBe(2);
    expect(current?.lastDay).toBe(Date.UTC(2026, 0, 2));
  });
});
