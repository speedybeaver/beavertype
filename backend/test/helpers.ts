import { env } from "cloudflare:workers";
import type { CompletedEvent } from "@monkeytype/schemas/results";
import { app } from "../src/index";

/** An unsigned token, as the Auth Emulator issues them. */
export function emulatorToken(
  uid: string,
  claims: Record<string, unknown> = {},
): string {
  const b64 = (o: object): string =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    aud: env.FIREBASE_PROJECT_ID,
    sub: uid,
    email: `${uid}@example.com`,
    iat: now,
    auth_time: now,
    exp: now + 3600,
    ...claims,
  })}.`;
}

export async function call(
  method: string,
  path: string,
  { uid, body }: { uid?: string; body?: unknown } = {},
): Promise<{ status: number; body: { message: string; data: any } }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (uid !== undefined) {
    headers["Authorization"] = `Bearer ${emulatorToken(uid)}`;
  }
  const res = await app.request(
    path,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, body: (await res.json()) as any };
}

export async function signUp(uid: string, name = uid): Promise<void> {
  const res = await call("POST", "/users/signup", {
    uid,
    body: { name, captcha: "x" },
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
}

export function completedEvent(
  overrides: Partial<CompletedEvent> = {},
): CompletedEvent {
  return {
    wpm: 100,
    rawWpm: 102,
    charStats: [100, 2, 0, 0],
    acc: 98,
    mode: "time",
    mode2: "15",
    timestamp: 0,
    testDuration: 15,
    consistency: 80,
    keyConsistency: 60,
    chartData: { wpm: [100], burst: [100], err: [0] },
    uid: "x",
    restartCount: 0,
    incompleteTestSeconds: 0,
    afkDuration: 0,
    tags: [],
    bailedOut: false,
    blindMode: false,
    lazyMode: false,
    funbox: [],
    language: "english",
    difficulty: "normal",
    numbers: false,
    punctuation: false,
    charTotal: 102,
    hash: `h${Math.random().toString().slice(2)}`,
    keyDuration: [100, 110],
    keySpacing: [120, 130],
    keyOverlap: 5,
    lastKeyToEnd: 10,
    startToFirstKey: 10,
    wpmConsistency: 80,
    stopOnLetter: false,
    incompleteTests: [],
    ...overrides,
  };
}
