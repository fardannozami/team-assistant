import { Hono } from "hono";
import { createApiTokenSchema } from "@repo/shared";
import { audit, requireRole } from "../auth/index.js";
import { createApiToken, listApiTokens, revokeApiToken } from "../auth/tokens.js";
import { parseWith } from "../../lib/validate.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";

// Naya (Hermes mission control): agent tokens for the /mcp endpoint.

export const nayaApi = new Hono();

const canManage = requireRole("Owner", "Admin");

nayaApi.get("/tokens", canManage, async (c) => c.json(await listApiTokens(getWorkspaceId(c))));

nayaApi.post("/tokens", canManage, async (c) => {
  const { name, scopes } = parseWith(createApiTokenSchema, await c.req.json());
  const workspaceId = getWorkspaceId(c);
  const actorId = getActorId(c);
  const { id, token } = await createApiToken(workspaceId, name, scopes, actorId);
  await audit(workspaceId, actorId, "naya.token.create", "api_token", id, { name, scopes });
  return c.json({ id, token }, 201);
});

nayaApi.delete("/tokens/:id", canManage, async (c) => {
  const id = c.req.param("id");
  const workspaceId = getWorkspaceId(c);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await revokeApiToken(workspaceId, id))) {
    return c.json({ error: "Not found" }, 404);
  }
  await audit(workspaceId, getActorId(c), "naya.token.revoke", "api_token", id);
  return c.json({ ok: true });
});
