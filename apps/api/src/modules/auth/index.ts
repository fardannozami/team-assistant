import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createDbClient, createWorkspace } from "@repo/database";
import { users, roles, employees, auditLogs, workspaces } from "@repo/database";
import { and, eq, inArray, sql } from "drizzle-orm";

const db = createDbClient(process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant");
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

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
  return c.json({ token: await issueToken(user) });
});

async function issueToken(user: { id: string; roleId: string | null; workspaceId: string }) {
  const role = await getRoleName(user.roleId);
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return sign({ sub: user.id, role, workspaceId: user.workspaceId, exp }, JWT_SECRET);
}

auth.get("/me", requireRole(), async (c) => {
  const { sub } = c.get("user" as never) as { sub: string };
  const [row] = await db
    .select({
      name: users.name,
      email: users.email,
      roleId: users.roleId,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(users)
    .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
    .where(eq(users.id, sub))
    .limit(1);
  if (!row) return c.json({ error: "Unauthorized" }, 401);
  return c.json({
    user: { name: row.name, email: row.email, role: await getRoleName(row.roleId) },
    workspace: { id: row.workspaceId, name: row.workspaceName },
  });
});

/* ---------- Google OAuth ---------- */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/auth/google/callback";
const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
// Unknown Google accounts get their own new workspace as its Owner.
// Set to "false" to allow only existing users.
const GOOGLE_SIGNUP_ENABLED = process.env.GOOGLE_SIGNUP_ENABLED !== "false";
const OAUTH_STATE_COOKIE = "ta_oauth_state";
const googleEnabled = () => Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

auth.get("/providers", (c) => c.json({ google: googleEnabled() }));

auth.get("/google", (c) => {
  if (!googleEnabled()) return c.json({ error: "Google login is not configured" }, 404);
  const state = crypto.randomUUID();
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "Lax",
    secure: GOOGLE_REDIRECT_URI.startsWith("https://"),
    path: "/auth/google",
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get("/google/callback", async (c) => {
  const fail = (reason: string) => c.redirect(`${WEB_URL}/#auth_error=${reason}`);
  const expectedState = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/auth/google" });

  const { code, state, error } = c.req.query();
  if (error) return fail("cancelled");
  if (!googleEnabled() || !code || !state || state !== expectedState) return fail("invalid_state");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail("google_error");
  const { access_token } = (await tokenRes.json()) as { access_token?: string };

  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) return fail("google_error");
  const profile = (await profileRes.json()) as { email?: string; email_verified?: boolean; name?: string };
  if (!profile.email || !profile.email_verified) return fail("unverified_email");

  const email = profile.email.toLowerCase();
  let [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!user) {
    if (!GOOGLE_SIGNUP_ENABLED) return fail("not_registered");
    const [owner] = await db.select().from(roles).where(eq(roles.name, "Owner")).limit(1);
    if (!owner) return fail("google_error");
    const name = profile.name || email.split("@")[0]!;
    user = await db
      .transaction(async (tx) => {
        const workspace = await createWorkspace(tx, { name: `Workspace ${name}` });
        const [created] = await tx
          .insert(users)
          .values({ workspaceId: workspace.id, email, name, roleId: owner.id })
          .returning();
        await tx.update(workspaces).set({ ownerUserId: created!.id }).where(eq(workspaces.id, workspace.id));
        return created;
      })
      // A concurrent sign-in with the same email won the race; use its user.
      .catch(async () => (await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0]);
    if (!user) return fail("google_error");
    await audit(user.workspaceId, user.id, "auth.register", "users", user.id, { provider: "google" });
  }
  if (!user.isActive) return fail("not_registered");

  await audit(user.workspaceId, user.id, "auth.login", "users", user.id, { provider: "google" });
  return c.redirect(`${WEB_URL}/#token=${encodeURIComponent(await issueToken(user))}`);
});

export async function verifyToken(token: string) {
  return verify(token, JWT_SECRET);
}

/**
 * Verifies the JWT, then re-reads the user so role changes, deactivation and
 * workspace moves apply immediately (and tokens issued before workspaces
 * existed keep working). Sets `user` and `workspaceId` on the context.
 */
export function requireRole(...allowed: string[]) {
  return async (c: any, next: any) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.replace(/^Bearer\s+/i, "");
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    let payload: Record<string, unknown>;
    try {
      payload = await verify(token, JWT_SECRET);
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (typeof payload.sub !== "string") return c.json({ error: "Unauthorized" }, 401);
    const [user] = await db
      .select({ id: users.id, roleId: users.roleId, workspaceId: users.workspaceId })
      .from(users)
      .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
      .where(and(eq(users.id, payload.sub), eq(users.isActive, true), eq(workspaces.isActive, true)))
      .limit(1);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const role = await getRoleName(user.roleId);
    if (allowed.length && (!role || !allowed.includes(role))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    c.set("user", { sub: user.id, role, workspaceId: user.workspaceId });
    c.set("workspaceId", user.workspaceId);
    await next();
  };
}

const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN ?? "dev-internal-token";

/**
 * Internal service callers (the scheduler worker) authenticate with
 * x-internal-token and name the workspace they act on with x-workspace-id.
 */
async function internalWorkspace(c: any): Promise<string | null | undefined> {
  const internalToken = c.req.header("x-internal-token");
  if (!internalToken || internalToken !== INTERNAL_API_TOKEN) return undefined;
  const workspaceId = c.req.header("x-workspace-id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return null;
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.isActive, true)))
    .limit(1);
  return ws?.id ?? null;
}

/** Allows internal service callers (e.g. the scheduler worker) in addition to JWT roles. */
export function requireInternalOrRole(...allowed: string[]) {
  return async (c: any, next: any) => {
    const workspaceId = await internalWorkspace(c);
    if (workspaceId === undefined) return requireRole(...allowed)(c, next);
    if (!workspaceId) return c.json({ error: "Unknown workspace" }, 400);
    c.set("user", { sub: null, role: "internal", workspaceId });
    c.set("workspaceId", workspaceId);
    await next();
  };
}

function phoneVariants(input: string): string[] {
  const digits = ((input ?? "").split(":")[0] ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  // WhatsApp JIDs use the international form without a leading zero/plus.
  if (digits.startsWith("0")) variants.add(`62${digits.slice(1)}`);
  if (digits.startsWith("62")) variants.add(`0${digits.slice(2)}`);
  if (digits.startsWith("8")) variants.add(`62${digits}`);
  return [...variants];
}

export async function getEmployeeByPhone(workspaceId: string, phone: string) {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return null;
  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workspaceId, workspaceId), inArray(employees.phone, variants)))
    .limit(1);
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

export async function audit(
  workspaceId: string | null,
  actorId: string | null,
  action: string,
  resource?: string,
  resourceId?: string,
  metadata?: unknown,
) {
  await db.insert(auditLogs).values({ workspaceId, actorId: actorId ?? undefined, action, resource, resourceId, metadata: metadata as any });
}
