import { Hono } from "hono";
import { createDbClient, roles } from "@repo/database";
import { requireRole } from "../auth/index.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export const rolesApi = new Hono();

rolesApi.get("/", requireRole(), async (c) => {
  const rows = await db
    .select({ id: roles.id, name: roles.name, description: roles.description })
    .from(roles)
    .orderBy(roles.name);
  return c.json({ roles: rows });
});
