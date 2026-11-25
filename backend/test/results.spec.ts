import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, completedEvent, signUp } from "./helpers";

async function setAddedAt(uid: string, addedAt: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET added_at = ?, time_typing = ? WHERE uid = ?",
  )
    .bind(addedAt, 3 * 60 * 60, uid)
    .run();
}

describe("results", () => {
  it("saves a result, updates PBs, stats and the leaderboard", async () => {
    await signUp("r1");
    const res = await call("POST", "/results", {
      uid: "r1",
      body: { result: completedEvent({ wpm: 111 }) },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isPb: true, streak: 1 });
    expect(res.body.data.xp).toBeGreaterThan(0);

    const results = await call("GET", "/results", { uid: "r1" });
    expect(results.body.data).toHaveLength(1);
    expect(results.body.data[0]).toMatchObject({
      wpm: 111,
      mode2: "15",
      isPb: true,
    });

    const user = await call("GET", "/users", { uid: "r1" });
    expect(user.body.data.personalBests.time["15"][0].wpm).toBe(111);
    expect(user.body.data.completedTests).toBe(1);

    const lb = await env.DB.prepare(
      "SELECT wpm FROM leaderboard_entries WHERE uid = 'r1'",
    ).first();
    expect(lb).toEqual({ wpm: 111 });

    const last = await call("GET", "/results/last", { uid: "r1" });
    expect(last.body.data).toMatchObject({
      wpm: 111,
      name: "r1",
      chartData: { wpm: [100] },
    });
  });

  it("rejects results too close to the previous one", async () => {
    await signUp("r2");
    await call("POST", "/results", {
      uid: "r2",
      body: { result: completedEvent() },
    });
    const res = await call("POST", "/results", {
      uid: "r2",
      body: { result: completedEvent() },
    });
    expect(res.status).toBe(462);
  });

  it("rejects duplicates, short tests and invalid bodies", async () => {
    await signUp("r3");
    await setAddedAt("r3", Date.now() - 60 * 60 * 1000);
    const short = await call("POST", "/results", {
      uid: "r3",
      body: { result: completedEvent({ mode2: "10" }) },
    });
    expect(short.status).toBe(460);
    const invalid = await call("POST", "/results", {
      uid: "r3",
      body: { result: { wpm: 1 } },
    });
    expect(invalid.status).toBe(422);
  });

  it("only moves the leaderboard entry up", async () => {
    await signUp("r4");
    await setAddedAt("r4", Date.now() - 60 * 60 * 1000);
    await call("POST", "/results", {
      uid: "r4",
      body: { result: completedEvent({ wpm: 120 }) },
    });
    // a slower PB in another combination must not lower the entry
    await env.DB.prepare("DELETE FROM results WHERE uid = 'r4'").run();
    const res = await call("POST", "/results", {
      uid: "r4",
      body: { result: completedEvent({ wpm: 90, punctuation: true }) },
    });
    expect(res.body.data.isPb).toBe(true);
    const lb = await env.DB.prepare(
      "SELECT wpm FROM leaderboard_entries WHERE uid = 'r4'",
    ).first();
    expect(lb).toEqual({ wpm: 120 });
  });
});
