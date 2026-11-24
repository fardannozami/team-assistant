import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createDbClient, roles, ssoCodes, users, workspaces } from "@repo/database";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { secretEnv } from "../../lib/env.js";

// Single sign-on for Naya (naya.digdaya.co): a signed-in daily user gets a
// one-time code, Naya's server swaps it (with NAYA_SSO_SECRET) for who the
// user is and their role. Naya has no accounts of its own.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export const SSO_CLIENT = "naya";
export const SSO_CODE_TTL_MS = 60_000;

export const nayaUrl = () => (process.env.NAYA_URL ?? "").replace(/\/+$/, "") || null;
const ssoSecret = () => secretEnv("NAYA_SSO_SECRET", "dev-naya-sso-secret");

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A random secret like `ta_sso_…`, url-safe. */
export function newSecret(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** True when the caller is Naya's server. */
export function isNayaServer(secretHeader: string | undefined): boolean {
  return Boolean(nayaUrl() && secretHeader && safeEqual(secretHeader, ssoSecret()));
}

/** Where Naya receives the code. */
export function callbackUrl(code: string): string {
  return `${nayaUrl()}/auth/callback?code=${encodeURIComponent(code)}`;
}

export async function createSsoCode(userId: string): Promise<string> {
  await db.delete(ssoCodes).where(lt(ssoCodes.expiresAt, new Date(Date.now() - 60 * 60_000)));
  const code = newSecret("ta_sso");
  await db.insert(ssoCodes).values({
    codeHash: sha256Hex(code),
    userId,
    client: SSO_CLIENT,
    expiresAt: new Date(Date.now() + SSO_CODE_TTL_MS),
  });
  return code;
}

export type SsoIdentity = {
  user: { id: string; name: string; email: string };
  role: string | null;
  workspace: { id: string; name: string };
};

/** The active user, with their workspace and current role, or null. */
export async function ssoIdentity(userId: string): Promise<SsoIdentity | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: roles.name,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(users)
    .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, userId), eq(users.isActive, true), eq(workspaces.isActive, true)))
    .limit(1);
  if (!row) return null;
  return {
    user: { id: row.id, name: row.name, email: row.email },
    role: row.role ?? null,
    workspace: { id: row.workspaceId, name: row.workspaceName },
  };
}

/** Uses up a code: valid once, within its minute. */
export async function exchangeSsoCode(code: string): Promise<SsoIdentity | null> {
  if (!code.startsWith("ta_sso_")) return null;
  const [used] = await db
    .update(ssoCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(ssoCodes.codeHash, sha256Hex(code)), isNull(ssoCodes.usedAt), gt(ssoCodes.expiresAt, new Date())))
    .returning({ userId: ssoCodes.userId });
  return used ? ssoIdentity(used.userId) : null;
}
