import { Hono } from "hono";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const app = new Hono();

app.get("/", (c) => c.json({ message: "Hello from Hono!" }));

app.get("/health", (c) => {
  logger.info("health check");
  return c.json({ status: "ok" });
});

app.get("/ready", (c) => {
  // Readiness: extend with DB/Redis checks when wired.
  return c.json({ status: "ready" });
});

export default app;

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4000);
  logger.info({ port }, "Server running");
  Bun.serve({ fetch: app.fetch, port });
}