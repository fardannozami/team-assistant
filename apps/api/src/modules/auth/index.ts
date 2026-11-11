import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createDbClient } from "@repo/database";
import { users, roles, employees, auditLogs } from "@repo/database";
import { eq, inArray, sql } from "drizzle-orm";

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
  return c.json({ token: await issueToken(user) });
});

async function issueToken(user: { id: string; roleId: string | null }) {
  const [role] = user.roleId ? await db.select().from(roles).where(eq(roles.id, user.roleId)).limit(1) : [];
  return sign({ sub: user.id, role: role?.name ?? null }, JWT_SECRET);
}

/* ---------- Google OAuth ---------- */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/auth/google/callback";
const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
// Role given to Google accounts that sign in without an existing user.
// Empty disables auto-registration (only existing users may sign in).
const GOOGLE_AUTO_REGISTER_ROLE = process.env.GOOGLE_AUTO_REGISTER_ROLE ?? "Admin";
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
    if (!GOOGLE_AUTO_REGISTER_ROLE) return fail("not_registered");
    const [role] = await db.select().from(roles).where(eq(roles.name, GOOGLE_AUTO_REGISTER_ROLE)).limit(1);
    if (!role) return fail("not_registered");
    [user] = await db
      .insert(users)
      .values({ email, name: profile.name || email.split("@")[0]!, roleId: role.id })
      .onConflictDoNothing()
      .returning();
    if (!user) [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (!user) return fail("google_error");
    await audit(user.id, "auth.register", "users", user.id, { provider: "google", role: role.name });
  }
  if (!user.isActive) return fail("not_registered");

  await audit(user.id, "auth.login", "users", user.id, { provider: "google" });
  return c.redirect(`${WEB_URL}/#token=${encodeURIComponent(await issueToken(user))}`);
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

export async function getEmployeeByPhone(phone: string) {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return null;
  const [emp] = await db
    .select()
    .from(employees)
    .where(inArray(employees.phone, variants))
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

export async function audit(actorId: string | null, action: string, resource?: string, resourceId?: string, metadata?: unknown) {
  await db.insert(auditLogs).values({ actorId: actorId ?? undefined, action, resource, resourceId, metadata: metadata as any });
}
