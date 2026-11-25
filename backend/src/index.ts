import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/d1";
import {
  contract,
  COMPATIBILITY_CHECK,
  COMPATIBILITY_CHECK_HEADER,
} from "@monkeytype/contracts";
import * as schema from "./db/schema";
import type { AppEnv, Bindings } from "./env";
import { MonkeyError } from "./error";
import { ValidationError, mount } from "./contract";
import { users } from "./routes/users";
import { results } from "./routes/results";
import { configs } from "./routes/configs";
import { presets } from "./routes/presets";
import { leaderboards } from "./routes/leaderboards";
import { psas } from "./routes/psas";
import { quotes } from "./routes/quotes";
import { publicStats } from "./routes/public";
import { configuration } from "./routes/configuration";
import { dev } from "./routes/dev";

export const app = new Hono<AppEnv>();

app.use(
  cors({
    origin: (origin, c) =>
      (c.env as Bindings).CORS_ORIGINS.split(",").includes(origin)
        ? origin
        : null,
    exposeHeaders: [COMPATIBILITY_CHECK_HEADER],
    maxAge: 86400,
  }),
);
app.use(async (c, next) => {
  c.set("db", drizzle(c.env.DB, { schema }));
  await next();
  c.header(COMPATIBILITY_CHECK_HEADER, COMPATIBILITY_CHECK.toString());
});

app.get("/", (c) => c.json({ message: "ok", data: null }));

mount(app, contract.users, users);
mount(app, contract.results, results);
mount(app, contract.configs, configs);
mount(app, contract.presets, presets);
mount(app, contract.leaderboards, leaderboards);
mount(app, contract.psas, psas);
mount(app, contract.quotes, quotes);
mount(app, contract.public, publicStats);
mount(app, contract.configuration, configuration);
mount(app, contract.dev, dev);

app.notFound((c) =>
  c.json({ message: "Unknown request URL", data: null }, 404),
);

app.onError((error, c) => {
  if (error instanceof ValidationError) {
    return c.json(
      { message: error.message, validationErrors: error.validationErrors },
      422,
    );
  }
  if (error instanceof MonkeyError) {
    c.status(error.status as 400);
    return c.json({ message: error.message, data: null });
  }
  const errorId = crypto.randomUUID();
  console.error(errorId, error);
  return c.json(
    {
      message: `Something went wrong. Please try again later. - ${errorId}`,
      data: { errorId, uid: c.get("token")?.uid },
    },
    500,
  );
});

export default { fetch: app.fetch } satisfies ExportedHandler<
  AppEnv["Bindings"]
>;
