import { Hono } from "hono";
import pino from "pino";
import { auth } from "./modules/auth/index.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const app = new Hono();

app.get("/", (c) => c.json({ message: "Hello from Hono!" }));

app.get("/health", (c) => {
  logger.info("health check");
  return c.json({ status: "ok" });
});

app.get("/ready", (c) => {
  return c.json({ status: "ready" });
});

app.route("/auth", auth);

export default app;

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4000);
  logger.info({ port }, "Server running");
  Bun.serve({ fetch: app.fetch, port });
}