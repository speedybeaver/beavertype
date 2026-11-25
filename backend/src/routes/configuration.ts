import type { configurationContract } from "@monkeytype/contracts/configuration";
import type { Handlers } from "../contract";
import { CONFIGURATION } from "../configuration";

// update/getSchema are cut: the configuration lives in code
export const configuration: Handlers<typeof configurationContract> = {
  async get() {
    return { message: "Configuration retrieved", data: CONFIGURATION };
  },
};
