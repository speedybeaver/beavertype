import type { Context } from "hono";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./db/schema";

export type Bindings = {
  DB: D1Database;
  BLOBS: R2Bucket;
  MODE: string;
  FIREBASE_PROJECT_ID: string;
  /** public web API key, for the Firebase Auth REST API */
  FIREBASE_API_KEY: string;
  /** host:port of the Firebase Auth Emulator, dev only */
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  CORS_ORIGINS: string;
  RECAPTCHA_SECRET?: string;
};

export type DecodedToken = {
  type: "Bearer" | "None";
  uid: string;
  email: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    token: DecodedToken;
    /** raw Firebase ID token of the request, if any */
    idToken: string;
    db: DrizzleD1Database<typeof schema>;
  };
};

export type AppContext = Context<AppEnv>;

export const isDev = (c: AppContext): boolean => c.env.MODE === "dev";
