import { apiTokens, createDbClient, workspaces } from "@repo/database";
import type { ApiTokenScope } from "@repo/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { newSecret, sha256Hex } from "./login-links.js";

// Bearer tokens for Hermes agents (Naya's AI team) reading daily data over MCP.
// Each token belongs to one workspace, carries scopes and can be revoked.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export const TOKEN_PREFIX = "ta_agent";

const LAST_USED_EVERY_MS = 60_000;

export async function createApiToken(workspaceId: string, name: string, scopes: ApiTokenScope[], createdBy: string | null) {
  const token = newSecret(TOKEN_PREFIX);
  const [row] = await db
    .insert(apiTokens)
    .values({ workspaceId, name, scopes, createdBy, tokenHash: sha256Hex(token), tokenHint: token.slice(-4) })
    .returning({ id: apiTokens.id });
  return { id: row!.id, token };
}

export async function listApiTokens(workspaceId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenHint: apiTokens.tokenHint,
      scopes: apiTokens.scopes,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.workspaceId, workspaceId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(workspaceId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.workspaceId, workspaceId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return rows.length > 0;
}

/** The live token's id, workspace and scopes, or null. */
export async function resolveApiToken(token: string) {
  if (!token.startsWith(`${TOKEN_PREFIX}_`)) return null;
  const [row] = await db
    .select({
      id: apiTokens.id,
      workspaceId: apiTokens.workspaceId,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .innerJoin(workspaces, eq(workspaces.id, apiTokens.workspaceId))
    .where(and(eq(apiTokens.tokenHash, sha256Hex(token)), isNull(apiTokens.revokedAt), eq(workspaces.isActive, true)))
    .limit(1);
  if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  }
  return row;
}

/**
 * Agent callers: `Authorization: Bearer ta_agent_…` with every scope listed.
 * Sets the same `user`/`workspaceId` context as requireRole, with role "agent".
 */
export function requireToken(...scopes: ApiTokenScope[]) {
  return async (c: any, next: any) => {
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const row = token ? await resolveApiToken(token) : null;
    if (!row) return c.json({ error: "Unauthorized" }, 401);
    if (!scopes.every((scope) => row.scopes.includes(scope))) return c.json({ error: "Forbidden" }, 403);
    c.set("user", { sub: null, role: "agent", workspaceId: row.workspaceId, tokenId: row.id, scopes: row.scopes });
    c.set("workspaceId", row.workspaceId);
    await next();
  };
}
