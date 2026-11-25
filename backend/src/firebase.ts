import type { Bindings } from "./env";
import { MonkeyError } from "./error";

/**
 * Call the Firebase Auth REST API (https://firebase.google.com/docs/reference/rest/auth)
 * acting as the user (their ID token), so no admin credentials are needed.
 */
export async function identityToolkit(
  env: Bindings,
  method: "update" | "delete" | "sendOobCode",
  body: Record<string, unknown>,
): Promise<void> {
  const base =
    env.FIREBASE_AUTH_EMULATOR_HOST !== undefined
      ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
      : "https://identitytoolkit.googleapis.com";
  const res = await fetch(
    `${base}/v1/accounts:${method}?key=${env.FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (res.ok) return;
  const { error } = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  const code = error?.message ?? "";
  if (code.startsWith("EMAIL_EXISTS")) {
    throw new MonkeyError(409, "The email address is already in use");
  }
  if (code.startsWith("INVALID_EMAIL")) {
    throw new MonkeyError(400, "Invalid email address");
  }
  if (code.startsWith("TOO_MANY_ATTEMPTS")) {
    throw new MonkeyError(429, "Too many requests. Please try again later");
  }
  if (code.startsWith("INVALID_ID_TOKEN") || code.startsWith("TOKEN_EXPIRED")) {
    throw new MonkeyError(401, "Please sign in again");
  }
  if (code.startsWith("WEAK_PASSWORD")) {
    throw new MonkeyError(400, "Password is too weak");
  }
  throw new MonkeyError(500, `Auth request failed: ${code || res.status}`);
}

export async function verifyCaptcha(
  env: Bindings,
  captcha: string,
): Promise<void> {
  // dev uses Google's test site key, which always passes
  if (env.MODE !== "production") return;
  if (env.RECAPTCHA_SECRET === undefined) {
    throw new Error("RECAPTCHA_SECRET is not set");
  }
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    body: new URLSearchParams({
      secret: env.RECAPTCHA_SECRET,
      response: captcha,
    }),
  });
  const { success } = (await res.json()) as { success?: boolean };
  if (success !== true) throw new MonkeyError(422, "Captcha challenge failed");
}
