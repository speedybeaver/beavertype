import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import type { MiddlewareHandler } from "hono";
import type { RequestAuthenticationOptions } from "@monkeytype/contracts/util/api";
import type { AppEnv, Bindings, DecodedToken } from "./env";
import { MonkeyError } from "./error";

const googleKeys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

/** Verify a Firebase ID token (https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library). */
export async function verifyIdToken(
  token: string,
  env: Pick<Bindings, "FIREBASE_PROJECT_ID" | "FIREBASE_AUTH_EMULATOR_HOST">,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<JWTPayload> {
  const projectId = env.FIREBASE_PROJECT_ID;
  const issuer = `https://securetoken.google.com/${projectId}`;
  let payload: JWTPayload;
  try {
    if (env.FIREBASE_AUTH_EMULATOR_HOST !== undefined) {
      // the emulator signs nothing (alg "none"): only check the claims
      payload = decodeJwt(token);
      if (payload.iss !== issuer || payload.aud !== projectId) {
        throw new Error("wrong project");
      }
    } else {
      ({ payload } = await jwtVerify(token, keys, {
        issuer,
        audience: projectId,
        algorithms: ["RS256"],
      }));
    }
  } catch {
    throw new MonkeyError(401, "Invalid token");
  }
  const authTime = payload["auth_time"];
  if (
    typeof payload.sub !== "string" ||
    payload.sub === "" ||
    typeof authTime !== "number" ||
    authTime * 1000 > Date.now() + 60_000
  ) {
    throw new MonkeyError(401, "Invalid token");
  }
  return payload;
}

export function authenticate(
  options: RequestAuthenticationOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    const isPublic =
      options.isPublic === true ||
      (options.isPublicOnDev === true && c.env.MODE === "dev");
    let token: DecodedToken;

    if (header !== undefined && header !== "") {
      const [scheme, value] = header.split(" ");
      if (scheme !== "Bearer" || value === undefined) {
        throw new MonkeyError(401, "Unknown authentication scheme");
      }
      const payload = await verifyIdToken(value, c.env);
      if (
        options.requireFreshToken === true &&
        Date.now() - (payload.iat ?? 0) * 1000 > 60_000
      ) {
        throw new MonkeyError(401, "This endpoint requires a fresh token");
      }
      c.set("idToken", value);
      const email = payload["email"];
      token = {
        type: "Bearer",
        uid: payload.sub as string,
        email: typeof email === "string" ? email : "",
      };
    } else if (isPublic) {
      token = { type: "None", uid: "", email: "" };
    } else {
      throw new MonkeyError(401, "Unauthorized");
    }

    c.set("token", token);
    await next();
  };
}
