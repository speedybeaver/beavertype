import { eq } from "drizzle-orm";
import type { configsContract } from "@monkeytype/contracts/configs";
import type { Handlers } from "../contract";
import * as t from "../db/schema";

export const configs: Handlers<typeof configsContract> = {
  async get(_req, c) {
    const row = await c.var.db.query.configs.findFirst({
      where: eq(t.configs.uid, c.var.token.uid),
    });
    return { message: "Configuration retrieved", data: row?.config ?? null };
  },

  async save({ body }, c) {
    const { uid } = c.var.token;
    const row = await c.var.db.query.configs.findFirst({
      where: eq(t.configs.uid, uid),
    });
    const config = { ...row?.config, ...body };
    await c.var.db
      .insert(t.configs)
      .values({ uid, config })
      .onConflictDoUpdate({ target: t.configs.uid, set: { config } });
    return { message: "Config updated", data: null };
  },

  async delete(_req, c) {
    await c.var.db.delete(t.configs).where(eq(t.configs.uid, c.var.token.uid));
    return { message: "Config deleted", data: null };
  },
};
