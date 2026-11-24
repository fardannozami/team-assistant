import { Hono, type Context } from "hono";
import {
  createApiTokenSchema,
  nayaAgentSchema,
  nayaCan,
  nayaChatSchema,
  nayaInstructionSchema,
  nayaReviewSchema,
  OWNER_ONLY_SCOPES,
  type NayaAction,
} from "@repo/shared";
import { createDbClient, users } from "@repo/database";
import { eq } from "drizzle-orm";
import { audit, requireRole } from "../auth/index.js";
import { createApiToken, listApiTokens, revokeApiToken } from "../auth/tokens.js";
import { parseWith } from "../../lib/validate.js";
import { HttpError } from "../../lib/http-error.js";
import { getActorId, getActorRole, getWorkspaceId } from "../../lib/tenant.js";
import { bridge, hermesConfigured, type Actor } from "./bridge.js";
import { chatKey, deleteNayaAgent, listNayaAgents, nayaPermissions, saveNayaAgent } from "./agents.js";
import { proxyChat } from "./chat.js";

// Naya (naya.digdaya.co): the AI team's office. Reads and Kanban writes go to hermes-bridge,
// chat to Hermes' API server; roles come from daily and every write is in audit_logs.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export const nayaApi = new Hono();

const anyone = requireRole();
const canManage = requireRole("Owner", "Admin");
/** How long an agent replying in Naya's chat shows as in the meeting room. */
const CHAT_PRESENCE_MS = 90_000;

async function actorOf(c: Context): Promise<Actor & { email: string }> {
  const id = getActorId(c)!;
  const [row] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw new HttpError(401, "Unauthorized");
  return { id, name: row.name, email: row.email, role: getActorRole(c) };
}

function allow(c: Context, action: NayaAction) {
  if (!nayaCan(getActorRole(c), action)) throw new HttpError(403, "Peran Anda tidak diizinkan melakukan ini.");
}

const fresh = (c: Context) => c.req.query("fresh") === "1";

/* ---------- Who am I, and what may I do ---------- */

nayaApi.get("/me", anyone, async (c) => {
  const actor = await actorOf(c);
  const agents = await listNayaAgents(getWorkspaceId(c));
  return c.json({ user: actor, can: nayaPermissions(actor.role, agents), agents, hermes: hermesConfigured() });
});

/* ---------- Reads from Hermes ---------- */

nayaApi.get("/runtime", anyone, async (c) => c.json(await bridge.runtime(fresh(c))));
nayaApi.get("/office", anyone, async (c) => c.json(await bridge.office(fresh(c))));
nayaApi.get("/tasks", anyone, async (c) => c.json(await bridge.tasks(fresh(c))));
nayaApi.get("/tasks/:id", anyone, async (c) => c.json(await bridge.task(c.req.param("id"), c.req.query("board") || undefined)));
nayaApi.get("/usage", anyone, async (c) => c.json(await bridge.usage(Number(c.req.query("days")) || 7)));
nayaApi.get("/calendar", anyone, async (c) => c.json(await bridge.calendar()));
nayaApi.get("/dashboard", anyone, async (c) => c.json(await bridge.dashboard(fresh(c))));
nayaApi.get("/activity", anyone, async (c) => c.json(await bridge.activity(fresh(c))));
nayaApi.get("/channels", anyone, async (c) => c.json(await bridge.channels(fresh(c))));

/* ---------- Instructions and reviews on the Hermes Kanban ---------- */

nayaApi.post("/tasks", anyone, async (c) => {
  allow(c, "instruct");
  const input = parseWith(nayaInstructionSchema, await c.req.json());
  const actor = await actorOf(c);
  const created = await bridge.instruct(input, actor);
  await audit(getWorkspaceId(c), actor.id, "naya.instruct", "kanban_task", created.id, {
    title: input.title,
    board: input.board,
    assignee: input.assignee,
  });
  return c.json(created, 201);
});

for (const action of ["approve", "changes", "reject", "comment", "retry"] as const) {
  nayaApi.post(`/tasks/:id/${action}`, anyone, async (c) => {
    allow(c, action === "comment" ? "comment" : "review");
    const input = parseWith(nayaReviewSchema, await c.req.json().catch(() => ({})));
    const actor = await actorOf(c);
    const id = c.req.param("id");
    const result = await bridge.review(id, action, input, actor);
    // The note itself stays in Hermes (the task's comments); the log records who did what.
    await audit(getWorkspaceId(c), actor.id, `naya.${action}`, "kanban_task", id, {
      board: input.board,
      assignee: result.assignee,
      from: result.status,
    });
    return c.json({ ok: true });
  });
}

/* ---------- Chat with an agent (SSE) ---------- */

nayaApi.post("/agents/:profile/chat", anyone, async (c) => {
  const profile = c.req.param("profile");
  const { messages } = parseWith(nayaChatSchema, await c.req.json());
  const last = messages[messages.length - 1];
  if (last?.role !== "user" || !last.content.trim()) throw new HttpError(400, "Pesan terakhir harus dari Anda.");
  const actor = await actorOf(c);
  const key = await chatKey(getWorkspaceId(c), profile, actor.role);
  void bridge.presence(profile, CHAT_PRESENCE_MS);
  await audit(getWorkspaceId(c), actor.id, "naya.chat", "naya_agent", profile);
  return proxyChat(profile, key, actor, messages.slice(-20), c.req.raw.signal);
});

/* ---------- Agent registry (Owner/Admin) ---------- */

nayaApi.get("/agents", anyone, async (c) => c.json(await listNayaAgents(getWorkspaceId(c))));

nayaApi.put("/agents/:profile", canManage, async (c) => {
  const input = parseWith(nayaAgentSchema, await c.req.json());
  const workspaceId = getWorkspaceId(c);
  const agent = await saveNayaAgent(workspaceId, c.req.param("profile"), input, getActorId(c));
  await audit(workspaceId, getActorId(c), "naya.agent.save", "naya_agent", agent.profile, {
    chatRoles: agent.chatRoles,
    isLead: agent.isLead,
    keyChanged: Boolean(input.apiKey),
  });
  return c.json(agent);
});

nayaApi.delete("/agents/:profile", canManage, async (c) => {
  const workspaceId = getWorkspaceId(c);
  const profile = c.req.param("profile");
  if (!(await deleteNayaAgent(workspaceId, profile))) return c.json({ error: "Not found" }, 404);
  await audit(workspaceId, getActorId(c), "naya.agent.delete", "naya_agent", profile);
  return c.json({ ok: true });
});

/* ---------- MCP tokens for Hermes agents (Owner/Admin; ops scopes Owner only) ---------- */

nayaApi.get("/tokens", canManage, async (c) => c.json(await listApiTokens(getWorkspaceId(c))));

nayaApi.post("/tokens", canManage, async (c) => {
  const { name, scopes } = parseWith(createApiTokenSchema, await c.req.json());
  if (scopes.some((scope) => (OWNER_ONLY_SCOPES as readonly string[]).includes(scope)) && getActorRole(c) !== "Owner") {
    throw new HttpError(403, "Hanya Owner yang bisa memberi akses ops ke agent.");
  }
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
