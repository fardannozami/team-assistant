import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createDbClient, loginLinks, users, workspaces } from "@repo/database";
import { and, eq, gt, isNull, lt } from "drizzle-orm";

// One-time sign-in links for daily's two web apps: the dashboard (daily.digdaya.co) and Naya
// (naya.digdaya.co). Both use the same API and JWT; a link carries a signed-in person across
// origins ("Buka Naya" in the dashboard) or onto a phone ("NAYA" over WhatsApp).

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export const LOGIN_APPS = ["web", "naya"] as const;
export type LoginApp = (typeof LOGIN_APPS)[number];
/** From a button in the dashboard: used right away. */
export const LINK_TTL_MS = 60_000;
/** Sent over WhatsApp: the person may tap it a little later. */
export const CHAT_LINK_TTL_MS = 10 * 60_000;

const trim = (url: string | undefined) => (url ?? "").replace(/\/+$/, "") || null;

/** Where each app lives; Naya is off until NAYA_WEB_URL is set. */
export function appUrl(app: LoginApp): string | null {
  return app === "naya" ? trim(process.env.NAYA_WEB_URL) : (trim(process.env.WEB_URL) ?? "http://localhost:3000");
}

export function isLoginApp(value: unknown): value is LoginApp {
  return typeof value === "string" && (LOGIN_APPS as readonly string[]).includes(value) && appUrl(value as LoginApp) !== null;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A random secret like `ta_login_…`, url-safe. */
export function newSecret(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `<app>/#login=<code>`: the app redeems the code for a session (POST /auth/link/redeem). */
export async function createLoginLink(userId: string, app: LoginApp, ttlMs = LINK_TTL_MS): Promise<string> {
  await db.delete(loginLinks).where(lt(loginLinks.expiresAt, new Date(Date.now() - 60 * 60_000)));
  const code = newSecret("ta_login");
  await db.insert(loginLinks).values({ codeHash: sha256Hex(code), userId, app, expiresAt: new Date(Date.now() + ttlMs) });
  return `${appUrl(app)}/#login=${encodeURIComponent(code)}`;
}

/** Uses up a code for the given app: valid once, before it expires, for an active user. */
export async function redeemLoginLink(code: string, app: LoginApp) {
  if (!code.startsWith("ta_login_")) return null;
  const [used] = await db
    .update(loginLinks)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(loginLinks.codeHash, sha256Hex(code)),
        eq(loginLinks.app, app),
        isNull(loginLinks.usedAt),
        gt(loginLinks.expiresAt, new Date()),
      ),
    )
    .returning({ userId: loginLinks.userId });
  if (!used) return null;
  const [user] = await db
    .select({ id: users.id, roleId: users.roleId, workspaceId: users.workspaceId })
    .from(users)
    .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
    .where(and(eq(users.id, used.userId), eq(users.isActive, true), eq(workspaces.isActive, true)))
    .limit(1);
  return user ?? null;
}
