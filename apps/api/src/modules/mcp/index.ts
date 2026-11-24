import { Hono } from "hono";
import { requireToken } from "../auth/tokens.js";
import { getWorkspaceId } from "../../lib/tenant.js";
import { handleRpc } from "./protocol.js";
import { MCP_TOOLS } from "./tools.js";

// MCP for Hermes agents: `https://<api>/mcp` with `Authorization: Bearer ta_agent_…`.

export const mcpApi = new Hono();

const INSTRUCTIONS =
  "Read-only data from daily.digdaya.co (PT Digdaya Inovasi Gemilang): projects, team, standups, reports, idle members and briefing leads. Dates are YYYY-MM-DD.";
const MAX_BATCH = 20;

mcpApi.post("/", requireToken("mcp:read"), async (c) => {
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  const ctx = { workspaceId: getWorkspaceId(c) };
  if (Array.isArray(body)) {
    const replies = await Promise.all(body.slice(0, MAX_BATCH).map((m) => handleRpc(m, MCP_TOOLS, ctx, INSTRUCTIONS)));
    const out = replies.filter(Boolean);
    return out.length ? c.json(out) : c.body(null, 202);
  }
  const reply = await handleRpc(body, MCP_TOOLS, ctx, INSTRUCTIONS);
  return reply ? c.json(reply) : c.body(null, 202);
});

// Stateless server: no server-initiated stream and no sessions to end.
mcpApi.get("/", (c) => c.body(null, 405, { Allow: "POST" }));
mcpApi.delete("/", (c) => c.body(null, 405, { Allow: "POST" }));
