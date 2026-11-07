import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { createDbClient } from "@repo/database";
import { users, roles, employees, auditLogs } from "@repo/database";
import { eq } from "drizzle-orm";

const db = createDbClient(process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant");
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

export const auth = new Hono();

auth.post("/login", async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.passwordHash) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const ok = await Bun.password.verify(password, user.passwordHash);
  if (!ok) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const [role] = user.roleId ? await db.select().from(roles).where(eq(roles.id, user.roleId)).limit(1) : [];
  const token = await sign({ sub: user.id, role: role?.name ?? null }, JWT_SECRET);
  return c.json({ token });
});

export async function verifyToken(token: string) {
  return verify(token, JWT_SECRET);
}

export function requireRole(...allowed: string[]) {
  return async (c: any, next: any) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.replace(/^Bearer\s+/i, "");
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    try {
      const payload = await verify(token, JWT_SECRET);
      if (allowed.length && (!payload.role || !allowed.includes(payload.role as string))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      c.set("user", payload);
      await next();
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
  };
}

const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN ?? "dev-internal-token";

/** Allows internal service callers (e.g. the scheduler worker) in addition to JWT roles. */
export function requireInternalOrRole(...allowed: string[]) {
  return async (c: any, next: any) => {
    const internalToken = c.req.header("x-internal-token");
    if (internalToken && internalToken === INTERNAL_API_TOKEN) {
      c.set("user", { sub: null, role: "internal" });
      await next();
      return;
    }
    return requireRole(...allowed)(c, next);
  };
}

export async function getEmployeeByPhone(phone: string) {
  const [emp] = await db.select().from(employees).where(eq(employees.phone, phone)).limit(1);
  return emp ?? null;
}

export async function getRoleName(roleId: string | null) {
  if (!roleId) return null;
  const [role] = await db
    .select({ name: roles.name })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  return role?.name ?? null;
}

export async function audit(actorId: string | null, action: string, resource?: string, resourceId?: string, metadata?: unknown) {
  await db.insert(auditLogs).values({ actorId: actorId ?? undefined, action, resource, resourceId, metadata: metadata as any });
}
