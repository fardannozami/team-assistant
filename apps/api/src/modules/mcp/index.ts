import { Hono } from "hono";
import { requireToken } from "../auth/tokens.js";
import { getWorkspaceId } from "../../lib/tenant.js";
import { handleRpc } from "./protocol.js";
import { READ_TOOLS, type McpContext } from "./tools.js";
import { OPS_TOOLS } from "./ops-tools.js";

// MCP for Hermes agents: `https://<api>/mcp` with `Authorization: Bearer ta_agent_…`.

export const mcpApi = new Hono();

const INSTRUCTIONS =
  "Data from daily.digdaya.co (PT Digdaya Inovasi Gemilang): projects, team, standups, reports, idle members and briefing leads (read-only); with an ops token also the status, logs and restarts of the app's services. Dates are YYYY-MM-DD.";

export const MCP_TOOLS = [...READ_TOOLS, ...OPS_TOOLS];
const MAX_BATCH = 20;

mcpApi.post("/", requireToken(), async (c) => {
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  const caller = c.get("user" as never) as { tokenId: string; scopes: string[] };
  const ctx: McpContext = { workspaceId: getWorkspaceId(c), tokenId: caller.tokenId, scopes: caller.scopes };
  // A token sees (and can call) only the tools of its scopes.
  const tools = MCP_TOOLS.filter((tool) => ctx.scopes.includes(tool.scope));
  if (Array.isArray(body)) {
    const replies = await Promise.all(body.slice(0, MAX_BATCH).map((m) => handleRpc(m, tools, ctx, INSTRUCTIONS)));
    const out = replies.filter(Boolean);
    return out.length ? c.json(out) : c.body(null, 202);
  }
  const reply = await handleRpc(body, tools, ctx, INSTRUCTIONS);
  return reply ? c.json(reply) : c.body(null, 202);
});

// Stateless server: no server-initiated stream and no sessions to end.
mcpApi.get("/", (c) => c.body(null, 405, { Allow: "POST" }));
mcpApi.delete("/", (c) => c.body(null, 405, { Allow: "POST" }));
