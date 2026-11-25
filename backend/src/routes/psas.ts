import type { psasContract } from "@monkeytype/contracts/psas";
import type { Handlers } from "../contract";
import * as t from "../db/schema";

export const psas: Handlers<typeof psasContract> = {
  async get(_req, c) {
    const rows = await c.var.db.select().from(t.announcements);
    return {
      message: "PSAs retrieved",
      data: rows.map(({ id, message, date, level, sticky }) => ({
        _id: id,
        message,
        ...(date !== null && { date }),
        ...(level !== null && { level }),
        ...(sticky !== null && { sticky }),
      })),
    };
  },
};
