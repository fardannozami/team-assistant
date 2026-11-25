import { Hono, type Context } from "hono";
import {
  createApiTokenSchema,
  nayaAgentSchema,
  nayaCan,
  nayaChatSchema,
  nayaChecklistDecisionSchema,
  nayaContinueSchema,
  nayaInstructionSchema,
  nayaPicSchema,
  nayaReviewSchema,
  OWNER_ONLY_SCOPES,
  type NayaAction,
} from "@repo/shared";
import { createDbClient, users } from "@repo/database";
import { eq } from "drizzle-orm";
import { audit, requireInternalOrRole, requireRole } from "../auth/index.js";
import { createApiToken, listApiTokens, revokeApiToken } from "../auth/tokens.js";
import { parseWith } from "../../lib/validate.js";
import { HttpError } from "../../lib/http-error.js";
import { getActorId, getActorRole, getWorkspaceId } from "../../lib/tenant.js";
import { bridge, hermesConfigured, type Actor } from "./bridge.js";
import { chatKey, deleteNayaAgent, listNayaAgents, nayaPermissions, saveNayaAgent } from "./agents.js";
import { proxyChat } from "./chat.js";
import { teamToday } from "./team.js";
import { cardSummaries, continueCard, currentBoard, decideItem, getChecklist, inbox, setCardPic, setItemPic } from "./checklist.js";
import { employeeOf, listMembers } from "./members.js";
import { notifyHandoffs } from "./notify.js";

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
  // Linked to an employee record, the person is a team member who can be a card's PIC.
  const employeeId = await employeeOf(getWorkspaceId(c), actor.id);
  return c.json({ user: { ...actor, employeeId }, can: nayaPermissions(actor.role, agents), agents, hermes: hermesConfigured() });
});

/* ---------- Reads from Hermes ---------- */

nayaApi.get("/runtime", anyone, async (c) => c.json(await bridge.runtime(fresh(c))));
nayaApi.get("/office", anyone, async (c) => c.json(await bridge.office(fresh(c))));
nayaApi.get("/tasks", anyone, async (c) => c.json(await bridge.tasks(fresh(c))));
nayaApi.get("/tasks/:id", anyone, async (c) => c.json(await bridge.task(c.req.param("id"), c.req.query("board") || undefined)));
nayaApi.get("/tasks/:id/attachments", anyone, async (c) => c.json(await bridge.attachments(c.req.param("id"), c.req.query("board") || undefined)));
nayaApi.get("/tasks/:id/attachments/:attachment", anyone, async (c) => {
  const file = await bridge.attachment(c.req.param("id"), c.req.param("attachment"), c.req.query("board") || undefined);
  return new Response(file.body, {
    headers: {
      "content-type": file.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": file.headers.get("content-disposition") ?? "attachment",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
nayaApi.get("/usage", anyone, async (c) => c.json(await bridge.usage(Number(c.req.query("days")) || 7)));
nayaApi.get("/calendar", anyone, async (c) => c.json(await bridge.calendar()));
nayaApi.get("/dashboard", anyone, async (c) => c.json(await bridge.dashboard(fresh(c))));
nayaApi.get("/activity", anyone, async (c) => c.json(await bridge.activity(fresh(c))));
nayaApi.get("/channels", anyone, async (c) => c.json(await bridge.channels(fresh(c))));

/* ---------- The human team: avatars follow today's standup ---------- */

nayaApi.get("/team", anyone, async (c) => c.json(await teamToday(getWorkspaceId(c))));

/* ---------- Instructions and reviews on the Hermes Kanban ---------- */

nayaApi.post("/tasks", anyone, async (c) => {
  allow(c, "instruct");
  const input = parseWith(nayaInstructionSchema, await c.req.json());
  const actor = await actorOf(c);
  const { pic, ...instruction } = input;
  const created = await bridge.instruct(instruction, actor);
  // Who reviews the result: a chosen member, or "auto": the most available sales/PM member when
  // the AI hands it over.
  const board = created.board ?? input.board ?? (await currentBoard());
  await setCardPic(getWorkspaceId(c), board, created.id, pic === "auto" ? null : pic, { createdBy: actor.id, pool: pic === "auto" ? "review" : null });
  await audit(getWorkspaceId(c), actor.id, "naya.instruct", "kanban_task", created.id, {
    title: input.title,
    board,
    assignee: input.assignee,
    pic,
  });
  return c.json({ ...created, board }, 201);
});

// Approving and asking for changes go through the checklist (below), so a card only completes
// once every item is Selesai. Rejecting the whole card, retrying and commenting stay card-wide.
for (const action of ["reject", "comment", "retry"] as const) {
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

/* ---------- The human half: PIC, checklist, Tugas Saya ---------- */

nayaApi.get("/people", anyone, async (c) => c.json(await listMembers(getWorkspaceId(c))));
nayaApi.get("/cards", anyone, async (c) => c.json(await cardSummaries(getWorkspaceId(c))));
nayaApi.get("/inbox", anyone, async (c) => {
  const actor = await actorOf(c);
  return c.json(await inbox(getWorkspaceId(c), await employeeOf(getWorkspaceId(c), actor.id), nayaCan(actor.role, "review")));
});

nayaApi.get("/tasks/:id/checklist", anyone, async (c) =>
  c.json(await getChecklist(getWorkspaceId(c), c.req.query("board") || undefined, c.req.param("id"))),
);

nayaApi.post("/tasks/:id/checklist/:item", anyone, async (c) => {
  const input = parseWith(nayaChecklistDecisionSchema, await c.req.json());
  const actor = await actorOf(c);
  const id = c.req.param("id");
  const result = await decideItem(getWorkspaceId(c), input.board, id, c.req.param("item"), input, actor, {
    employeeId: await employeeOf(getWorkspaceId(c), actor.id),
    canReview: nayaCan(actor.role, "review"),
  });
  await audit(getWorkspaceId(c), actor.id, `naya.checklist.${input.status}`, "kanban_task", id, {
    board: input.board,
    item: c.req.param("item"),
    outcome: result.outcome,
  });
  return c.json(result);
});

const canAssign = (c: Context) => {
  const role = getActorRole(c);
  if (!nayaCan(role, "review") && !nayaCan(role, "instruct")) throw new HttpError(403, "Peran Anda tidak diizinkan mengganti PIC.");
};

nayaApi.post("/tasks/:id/pic", anyone, async (c) => {
  canAssign(c);
  const input = parseWith(nayaPicSchema, await c.req.json());
  const id = c.req.param("id");
  await setCardPic(getWorkspaceId(c), input.board, id, input.pic);
  await audit(getWorkspaceId(c), getActorId(c), "naya.pic", "kanban_task", id, { board: input.board, pic: input.pic });
  return c.json({ ok: true });
});

nayaApi.post("/tasks/:id/checklist/:item/pic", anyone, async (c) => {
  canAssign(c);
  const input = parseWith(nayaPicSchema, await c.req.json());
  const id = c.req.param("id");
  await setItemPic(getWorkspaceId(c), input.board, id, c.req.param("item"), input.pic);
  await audit(getWorkspaceId(c), getActorId(c), "naya.pic", "kanban_task", id, { board: input.board, item: c.req.param("item"), pic: input.pic });
  return c.json({ ok: true });
});

/** A reviewed card goes on to design or development: an AI agent drafts the requirement, then the most available designer or developer gets it. */
nayaApi.post("/tasks/:id/continue", anyone, async (c) => {
  canAssign(c);
  const input = parseWith(nayaContinueSchema, await c.req.json());
  const actor = await actorOf(c);
  const id = c.req.param("id");
  const created = await continueCard(getWorkspaceId(c), input.board, id, input.step, input.note, actor);
  await audit(getWorkspaceId(c), actor.id, "naya.continue", "kanban_task", id, { board: input.board, step: input.step, to: created.id });
  return c.json(created, 201);
});

/** The worker, every 10 minutes: hand reviewed cards to their PIC over WhatsApp, nudge overdue ones. */
nayaApi.post("/notify", requireInternalOrRole("Owner", "Admin"), async (c) => c.json(await notifyHandoffs(getWorkspaceId(c))));

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
