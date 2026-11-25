import {
  isAppRoute,
  isAppRouteMutation,
  isZodType,
  parseJsonQueryObject,
  type AppRoute,
  type AppRouter,
  type ServerInferRequest,
  type ServerInferResponseBody,
} from "@ts-rest/core";
import type { Hono } from "hono";
import type { EndpointMetadata } from "@monkeytype/contracts/util/api";
import type { RequireConfiguration } from "@monkeytype/contracts/require-configuration/index";
import { authenticate } from "./auth";
import { CONFIGURATION } from "./configuration";
import type { AppContext, AppEnv } from "./env";
import { MonkeyError } from "./error";

type Handler<R extends AppRoute> = (
  req: Omit<ServerInferRequest<R>, "headers">,
  c: AppContext,
) => Promise<ServerInferResponseBody<R, 200>>;

export type Handlers<T extends AppRouter> = {
  [K in keyof T]?: T[K] extends AppRoute ? Handler<T[K]> : never;
};

/**
 * Register the implemented routes of a ts-rest contract on a Hono app.
 * Routes without a handler are not registered (404).
 */
export function mount<T extends AppRouter>(
  app: Hono<AppEnv>,
  router: T,
  handlers: Handlers<T>,
): void {
  for (const [name, route] of Object.entries(router)) {
    const handler = handlers[name] as Handler<AppRoute> | undefined;
    if (handler === undefined || !isAppRoute(route)) continue;
    const meta = (route.metadata ?? {}) as EndpointMetadata;
    if (meta.requirePermission !== undefined) {
      // ponytail: no permission system yet, add one with the first admin endpoint
      throw new Error(`${route.path} needs permissions, not implemented`);
    }
    const required = [meta.requireConfiguration ?? []].flat();

    app.on(
      route.method,
      route.path,
      authenticate(meta.authenticationOptions),
      async (c) => {
        for (const { path, invalidMessage } of required) {
          if (!getFlag(path)) {
            throw new MonkeyError(
              503,
              invalidMessage ?? "This endpoint is currently unavailable.",
            );
          }
        }
        const bodySchema = isAppRouteMutation(route) ? route.body : undefined;
        const req = {
          params: validate("path parameter", route.pathParams, c.req.param()),
          query: validate(
            "query",
            route.query,
            parseJsonQueryObject(c.req.query()),
          ),
          body: isZodType(bodySchema)
            ? validate(
                "request data",
                bodySchema,
                await c.req.json().catch(() => {
                  throw new MonkeyError(400, "Invalid JSON body");
                }),
              )
            : undefined,
        } as Omit<ServerInferRequest<AppRoute>, "headers">;
        return c.json(await handler(req, c));
      },
    );
  }
}

function validate(what: string, schema: unknown, value: unknown): unknown {
  if (!isZodType(schema)) return value;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ValidationError(
    `Invalid ${what} schema`,
    result.error.errors.map(
      (it) =>
        `${it.path.length > 0 ? `"${it.path.join(".")}" ` : ""}${it.message}`,
    ),
  );
}

export class ValidationError extends MonkeyError {
  validationErrors: string[];
  constructor(message: string, validationErrors: string[]) {
    super(422, message);
    this.validationErrors = validationErrors;
  }
}

function getFlag(path: RequireConfiguration["path"]): boolean {
  let value: unknown = CONFIGURATION;
  for (const key of (path as string).split(".")) {
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value !== "boolean") throw new Error(`bad config path ${path}`);
  return value;
}
