// Seeds the local dev database: a test user with ~3 months of results (on the
// leaderboards) and a welcome announcement. Needs `pnpm dev` running.
// usage: pnpm seed
import { execFileSync } from "node:child_process";

const backend = "http://localhost:5005";

const res = await fetch(`${backend}/dev/generateData`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "test", createUser: true }),
});
const body = (await res.json()) as { message: string };
if (!res.ok) {
  console.error(`generateData failed (${res.status}): ${body.message}`);
  process.exit(1);
}

execFileSync(
  "wrangler",
  [
    "d1",
    "execute",
    "DB",
    "--local",
    "--command",
    `INSERT OR IGNORE INTO announcements (id, message, level) VALUES ('welcome', 'Welcome to your local BeaverType! This announcement comes from the seed script.', 1)`,
  ],
  { stdio: "inherit" },
);

console.log("Seeded. Sign in with test@example.com / password (user 'test').");
