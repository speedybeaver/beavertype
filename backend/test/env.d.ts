import type { D1Migration } from "cloudflare:test";
import type { Bindings } from "../src/env";

declare global {
  namespace Cloudflare {
    // oxlint-disable-next-line consistent-type-definitions -- declaration merging
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
