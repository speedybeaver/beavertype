import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig, type UserWorkspaceConfig } from "vitest/config";

export const projects: UserWorkspaceConfig[] = [
  {
    plugins: [
      cloudflareTest(async () => ({
        wrangler: {
          configPath: path.join(import.meta.dirname, "wrangler.jsonc"),
        },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: await readD1Migrations(
              path.join(import.meta.dirname, "migrations"),
            ),
            MODE: "test",
            FIREBASE_PROJECT_ID: "demo-test",
            // unsigned emulator tokens; the RS256 path is tested in auth.spec.ts
            FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:1",
          },
        },
      })),
    ],
    test: {
      name: { label: "unit", color: "blue" },
      include: ["test/**/*.spec.ts"],
      setupFiles: ["test/setup.ts"],
    },
  },
];

export default defineConfig({ test: { projects } });
