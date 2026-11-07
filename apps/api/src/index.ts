import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.json({ message: "Hello from Hono!" }));
app.get("/health", (c) => c.json({ status: "ok" }));

export default app;

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4000);
  console.log(`Server running on http://localhost:${port}`);
  Bun.serve({ fetch: app.fetch, port });
}
