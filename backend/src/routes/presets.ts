import { and, count, eq } from "drizzle-orm";
import type { presetsContract } from "@monkeytype/contracts/presets";
import type { Handlers } from "../contract";
import * as t from "../db/schema";
import { MonkeyError } from "../error";
import { newId } from "../utils/misc";

const MAX_PRESETS = 10;

export const presets: Handlers<typeof presetsContract> = {
  async get(_req, c) {
    const rows = await c.var.db.query.presets.findMany({
      where: eq(t.presets.uid, c.var.token.uid),
    });
    return {
      message: "Presets retrieved",
      data: rows.map(({ id, name, config, settingGroups }) => ({
        _id: id,
        name,
        config,
        ...(settingGroups !== null && { settingGroups }),
      })),
    };
  },

  async add({ body }, c) {
    const { uid } = c.var.token;
    const existing = await c.var.db
      .select({ count: count() })
      .from(t.presets)
      .where(eq(t.presets.uid, uid))
      .get();
    if ((existing?.count ?? 0) >= MAX_PRESETS) {
      throw new MonkeyError(409, "Too many presets");
    }
    const id = newId();
    await c.var.db.insert(t.presets).values({
      id,
      uid,
      name: body.name,
      config: body.config,
      settingGroups: body.settingGroups ?? null,
    });
    return { message: "Preset created", data: { presetId: id } };
  },

  async save({ body }, c) {
    const { _id, name, config, settingGroups } = body;
    await c.var.db
      .update(t.presets)
      .set({
        name,
        ...(config !== undefined &&
          Object.keys(config).length > 0 && { config }),
        ...(settingGroups !== undefined && { settingGroups }),
      })
      .where(and(eq(t.presets.id, _id), eq(t.presets.uid, c.var.token.uid)));
    return { message: "Preset updated", data: null };
  },

  async delete({ params }, c) {
    const deleted = await c.var.db
      .delete(t.presets)
      .where(
        and(
          eq(t.presets.id, params.presetId),
          eq(t.presets.uid, c.var.token.uid),
        ),
      )
      .returning({ id: t.presets.id });
    if (deleted.length === 0) throw new MonkeyError(404, "Preset not found");
    return { message: "Preset deleted", data: null };
  },
};
