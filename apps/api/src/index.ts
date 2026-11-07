import { Hono } from "hono";
import pino from "pino";
import { auth } from "./modules/auth/index.js";
import { employeesApi } from "./modules/employees/index.js";
import { rolesApi } from "./modules/roles/index.js";
import { schedulesApi } from "./modules/schedules/index.js";
import { standupsApi } from "./modules/standups/index.js";
import { teamsApi } from "./modules/teams/index.js";
import { whatsapp } from "./modules/whatsapp/index.js";
import { startWhatsApp } from "./modules/whatsapp/service.js";
import { HttpError } from "./lib/http-error.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status);
  }
  logger.error(err, "Unhandled request error");
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/", (c) => c.json({ message: "Hello from Hono!" }));

app.get("/health", (c) => {
  logger.info("health check");
  return c.json({ status: "ok" });
});

app.get("/ready", (c) => {
  return c.json({ status: "ready" });
});

app.route("/auth", auth);
app.route("/employees", employeesApi);
app.route("/teams", teamsApi);
app.route("/roles", rolesApi);
app.route("/schedules", schedulesApi);
app.route("/standups", standupsApi);
app.route("/whatsapp", whatsapp);

export { app };

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4000);
  logger.info({ port }, "Server running");
  startWhatsApp().catch((e) => logger.error(e));
  Bun.serve({ fetch: app.fetch, port });
}