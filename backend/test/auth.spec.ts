import { describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyIdToken } from "../src/auth";
import { call, emulatorToken } from "./helpers";

const projectId = "beavertype";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({
  keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }],
});
const now = Math.floor(Date.now() / 1000);

async function sign(
  claims: Record<string, unknown> = {},
  key = privateKey,
  exp = now + 3600,
): Promise<string> {
  return new SignJWT({ auth_time: now, email: "a@b.c", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://securetoken.google.com/${projectId}`)
    .setAudience(projectId)
    .setSubject("uid1")
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);
}

describe("verifyIdToken (Google signed)", () => {
  const env = { FIREBASE_PROJECT_ID: projectId };

  it("accepts a valid token", async () => {
    const payload = await verifyIdToken(await sign(), env, keys);
    expect(payload.sub).toBe("uid1");
  });

  it("rejects a token signed by another key", async () => {
    const other = (await generateKeyPair("RS256")).privateKey;
    await expect(
      verifyIdToken(await sign({}, other), env, keys),
    ).rejects.toThrow("Invalid token");
  });

  it("rejects another project's token", async () => {
    const token = await sign();
    await expect(
      verifyIdToken(token, { FIREBASE_PROJECT_ID: "other" }, keys),
    ).rejects.toThrow("Invalid token");
  });

  it("rejects an expired token", async () => {
    await expect(
      verifyIdToken(await sign({}, privateKey, now - 10), env, keys),
    ).rejects.toThrow("Invalid token");
  });

  it("rejects unsigned tokens outside the emulator", async () => {
    const unsigned = emulatorToken("uid1", {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
    });
    await expect(verifyIdToken(unsigned, env, keys)).rejects.toThrow(
      "Invalid token",
    );
  });
});

describe("authenticate middleware", () => {
  it("rejects requests without a token", async () => {
    const res = await call("GET", "/users");
    expect(res.status).toBe(401);
  });

  it("rejects malformed tokens", async () => {
    const { app } = await import("../src/index");
    const { env } = await import("cloudflare:workers");
    const res = await app.request(
      "/users",
      { headers: { Authorization: "Bearer nope" } },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("lets public endpoints through", async () => {
    const res = await call("GET", "/psas");
    expect(res.status).toBe(200);
  });

  it("passes the uid to handlers", async () => {
    const res = await call("GET", "/users", { uid: "nobody" });
    expect(res.status).toBe(404); // authenticated, but never signed up
  });
});
