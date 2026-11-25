import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, signUp } from "./helpers";

async function entry(
  uid: string,
  wpm: number,
  acc = 95,
  timestamp = 1,
): Promise<void> {
  await signUp(uid);
  await env.DB.prepare("UPDATE users SET time_typing = ? WHERE uid = ?")
    .bind(3 * 60 * 60, uid)
    .run();
  await env.DB.prepare(
    "INSERT INTO leaderboard_entries VALUES ('time', '60', 'english', ?, ?, ?, ?, 80, ?)",
  )
    .bind(uid, wpm, acc, wpm, timestamp)
    .run();
}

const query = "language=english&mode=time&mode2=%2260%22";

describe("leaderboards", () => {
  it("ranks by wpm, then acc, then time and paginates", async () => {
    await entry("a", 100);
    await entry("b", 120);
    await entry("c", 100, 99);
    await entry("d", 100, 95, 0);

    const page0 = await call(
      "GET",
      `/leaderboards?${query}&page=0&pageSize=10`,
    );
    expect(page0.status).toBe(200);
    expect(page0.body.data.count).toBe(4);
    expect(
      page0.body.data.entries.map(
        (it: { uid: string; rank: number }) => `${it.rank}${it.uid}`,
      ),
    ).toEqual(["1b", "2c", "3d", "4a"]);

    const page1 = await call(
      "GET",
      `/leaderboards?${query}&page=1&pageSize=10`,
    );
    expect(page1.body.data.entries).toEqual([]);

    const rank = await call("GET", `/leaderboards/rank?${query}`, { uid: "a" });
    expect(rank.body.data).toMatchObject({ uid: "a", rank: 4, name: "a" });
  });

  it("hides banned, opted out and new users", async () => {
    await entry("banned", 200);
    await env.DB.prepare(
      "UPDATE users SET banned = 1 WHERE uid = 'banned'",
    ).run();
    await entry("optout", 200);
    expect(
      (await call("POST", "/users/optOutOfLeaderboards", { uid: "optout" }))
        .status,
    ).toBe(200);
    await entry("newbie", 200);
    await env.DB.prepare(
      "UPDATE users SET time_typing = 0 WHERE uid = 'newbie'",
    ).run();

    const res = await call("GET", `/leaderboards?${query}&page=0`);
    const uids = res.body.data.entries.map((it: { uid: string }) => it.uid);
    expect(uids).not.toContain("banned");
    expect(uids).not.toContain("optout");
    expect(uids).not.toContain("newbie");
    const rank = await call("GET", `/leaderboards/rank?${query}`, {
      uid: "newbie",
    });
    expect(rank.body.data).toBeNull();
  });

  it("only serves english time 15/60", async () => {
    const res = await call(
      "GET",
      "/leaderboards?language=english&mode=words&mode2=%2210%22&page=0",
    );
    expect(res.status).toBe(404);
  });
});
