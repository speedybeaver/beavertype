# Backend

Hono on Cloudflare Workers, implementing the ts-rest contracts in `packages/contracts`. Data in D1 (Drizzle), auth via Firebase ID tokens. Schema: [docs/schema.md](../docs/schema.md).

- `src/index.ts`: app, CORS, error handling, which contracts are mounted
- `src/contract.ts`: registers a contract's implemented routes on Hono (auth, validation, `requireConfiguration`). Routes without a handler are 404.
- `src/auth.ts`: Firebase ID token check (Google JWKs via jose; unsigned emulator tokens when `FIREBASE_AUTH_EMULATOR_HOST` is set)
- `src/firebase.ts`: account actions (email/password change, delete, emails) via the Firebase Auth REST API with the user's own token, no admin SDK
- `src/configuration.ts`: server configuration (feature flags), in code
- `src/routes/*`: one file per contract

## Commands

- `pnpm dev` (from the repo root): see the root README
- `pnpm test`: vitest in the Workers runtime (`@cloudflare/vitest-plugin`), against a fresh local D1
- `pnpm db:generate`: after editing `src/db/schema.ts`, generate a migration in `migrations/`
- `pnpm build`: bundle check (`wrangler deploy --dry-run`)

## Deploy

1. `wrangler d1 create beavertype`, put the id in `wrangler.jsonc`; `wrangler r2 bucket create beavertype-blobs`
2. In `wrangler.jsonc` vars: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` (public web key), `CORS_ORIGINS`
3. `wrangler secret put RECAPTCHA_SECRET`
4. `pnpm deploy` (applies migrations, then deploys)

Announcements: `wrangler d1 execute DB --remote --command "INSERT INTO announcements (id, message, level) VALUES ('id', 'text', 1)"`.
