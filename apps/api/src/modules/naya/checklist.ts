import { createDbClient, nayaCards, nayaChecklistItems, nayaLearnedRules, roles, users } from "@repo/database";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { ChecklistStatus } from "@repo/shared";
import { HttpError } from "../../lib/http-error.js";
import { bridge, type Actor } from "./bridge.js";

// The human half of a card (blueprint v3): the AI drafts until Hermes puts the card in review,
// then Naya hands it to people as a checklist (one item per subtask result, plus the card's own
// result). Each item is In Progress, Selesai, Feedback (with what to fix) or Ditolak (with why).
// The card only moves once nobody is still checking: all Selesai completes it in Hermes, any
// Ditolak blocks it, otherwise the Feedback notes reopen it for the agent. Items that were not
// Selesai come back as the next version when the agent hands the card over again.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

/** Feedback or work left waiting this long shows up as overdue in Tugas Saya. */
export const STALE_MS = 48 * 60 * 60 * 1000;

export interface BoardTask { id?: string; title: string; status: string; assignee?: string; board?: string }
interface BoardSnapshot { tasks: { availability: string; data: BoardTask[] }; boards?: { slug: string; current: boolean }[] }

export type CardOutcome = "wait" | "approve" | "changes" | "reject";

/** What the card does next, given its items: nothing while anyone is still checking. */
export function cardOutcome(statuses: ChecklistStatus[]): CardOutcome {
  if (statuses.length === 0 || statuses.includes("in_progress")) return "wait";
  if (statuses.includes("rejected")) return "reject";
  if (statuses.includes("feedback")) return "changes";
  return "approve";
}

/** The note the agent reads in Hermes: every item that needs work, with its version and the person's words. */
export function handoffNote(items: { title: string; status: ChecklistStatus; note: string | null; version: number }[]): string {
  return items
    .filter((item) => item.status === "feedback" || item.status === "rejected")
    .map((item) => `- ${item.status === "rejected" ? "Ditolak" : "Feedback"} · ${item.title} (v${item.version}): ${item.note ?? ""}`.trim())
    .join("\n");
}

/** The items for a card handed over by the AI: each subtask's result, then the card's own. */
export function seedItems(task: { title: string }, children: { id: string; title?: string }[]): { title: string; sourceTaskId: string | null }[] {
  return [
    ...children.map((child) => ({ title: child.title || child.id, sourceTaskId: child.id })),
    { title: children.length ? `Hasil akhir: ${task.title}` : task.title, sourceTaskId: null },
  ];
}

export const boardOf = (board: string | undefined) => board || "default";

export async function boardSnapshot(fresh = false): Promise<BoardSnapshot> {
  return (await bridge.tasks(fresh)) as unknown as BoardSnapshot;
}

/** The board a new instruction lands on when none is named: Hermes' current board. */
export async function currentBoard(): Promise<string> {
  const snapshot = await boardSnapshot().catch(() => undefined);
  return snapshot?.boards?.find((board) => board.current)?.slug ?? "default";
}

async function findTask(board: string, taskId: string, fresh = false): Promise<BoardTask> {
  const snapshot = await boardSnapshot(fresh);
  const task = snapshot.tasks.data.find((item) => item.id === taskId && boardOf(item.board) === board);
  if (!task) throw new HttpError(404, "Task tidak dikenal.");
  return task;
}

async function ensureCard(workspaceId: string, board: string, taskId: string) {
  await db.insert(nayaCards).values({ workspaceId, board, taskId }).onConflictDoNothing();
}

/** Sets who is in charge of a card (and of its items still being checked by the previous PIC). */
export async function setCardPic(workspaceId: string, board: string | undefined, taskId: string, pic: string | null, createdBy?: string) {
  const key = boardOf(board);
  if (pic) await assertPerson(workspaceId, pic);
  const where = and(eq(nayaCards.workspaceId, workspaceId), eq(nayaCards.board, key), eq(nayaCards.taskId, taskId));
  const [before] = await db.select({ pic: nayaCards.picUserId }).from(nayaCards).where(where).limit(1);
  await db
    .insert(nayaCards)
    .values({ workspaceId, board: key, taskId, picUserId: pic, createdBy })
    .onConflictDoUpdate({ target: [nayaCards.workspaceId, nayaCards.board, nayaCards.taskId], set: { picUserId: pic, updatedAt: new Date() } });
  // Items the previous PIC had not decided yet move along; the new PIC is notified for them.
  const previous = before?.pic ? eq(nayaChecklistItems.picUserId, before.pic) : isNull(nayaChecklistItems.picUserId);
  await db
    .update(nayaChecklistItems)
    .set({ picUserId: pic, handedAt: null, remindedAt: null, updatedAt: new Date() })
    .where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, key), eq(nayaChecklistItems.taskId, taskId), eq(nayaChecklistItems.status, "in_progress"), previous));
}

export async function setItemPic(workspaceId: string, board: string | undefined, taskId: string, itemId: string, pic: string | null) {
  if (pic) await assertPerson(workspaceId, pic);
  const [row] = await db
    .update(nayaChecklistItems)
    .set({ picUserId: pic, handedAt: null, remindedAt: null, updatedAt: new Date() })
    .where(and(eq(nayaChecklistItems.id, itemId), eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, boardOf(board)), eq(nayaChecklistItems.taskId, taskId)))
    .returning({ id: nayaChecklistItems.id });
  if (!row) throw new HttpError(404, "Item checklist tidak dikenal.");
}

async function assertPerson(workspaceId: string, userId: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.workspaceId, workspaceId), eq(users.isActive, true))).limit(1);
  if (!row) throw new HttpError(400, "Anggota tim tidak dikenal.");
}

/** Everyone on the team who can be a PIC. */
export async function listPeople(workspaceId: string) {
  return db
    .select({ id: users.id, name: users.name, role: roles.name })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.workspaceId, workspaceId), eq(users.isActive, true)))
    .orderBy(asc(users.name));
}

const itemColumns = {
  id: nayaChecklistItems.id,
  title: nayaChecklistItems.title,
  sourceTaskId: nayaChecklistItems.sourceTaskId,
  picUserId: nayaChecklistItems.picUserId,
  status: nayaChecklistItems.status,
  note: nayaChecklistItems.note,
  version: nayaChecklistItems.version,
  decidedAt: nayaChecklistItems.decidedAt,
  handedAt: nayaChecklistItems.handedAt,
  updatedAt: nayaChecklistItems.updatedAt,
};

/**
 * The card's PIC and checklist. A card waiting for review gets its items the first time anyone
 * looks (Hermes does not tell Naya when it hands a card over), all with the card's PIC.
 */
export async function getChecklist(workspaceId: string, board: string | undefined, taskId: string) {
  const key = boardOf(board);
  const task = await findTask(key, taskId);
  await ensureCard(workspaceId, key, taskId);
  if (task.status === "review") await seedChecklist(workspaceId, key, task);
  const [card] = await db.select().from(nayaCards).where(and(eq(nayaCards.workspaceId, workspaceId), eq(nayaCards.board, key), eq(nayaCards.taskId, taskId))).limit(1);
  const items = await db
    .select(itemColumns)
    .from(nayaChecklistItems)
    .where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, key), eq(nayaChecklistItems.taskId, taskId)))
    .orderBy(asc(nayaChecklistItems.createdAt), asc(nayaChecklistItems.sourceTaskId));
  // Which agent made each item: the subtask's assignee, or the card's for its own result.
  const tasks = (await boardSnapshot()).tasks.data.filter((item) => boardOf(item.board) === key);
  const agentOf = (id: string | null) => (id ? tasks.find((item) => item.id === id)?.assignee : task.assignee) ?? null;
  return { status: task.status, pic: card?.picUserId ?? null, items: items.map((item) => ({ ...item, agent: agentOf(item.sourceTaskId) })) };
}

export async function seedChecklist(workspaceId: string, board: string, task: BoardTask) {
  const taskId = task.id!;
  const existing = await db.select({ id: nayaChecklistItems.id }).from(nayaChecklistItems).where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, board), eq(nayaChecklistItems.taskId, taskId))).limit(1);
  if (existing.length) return;
  // Hermes links a split card to its subtasks as its parents: the card waits on them.
  const detail = (await bridge.task(taskId, board)) as { task?: { availability: string; data: { parents?: string[] } | null } };
  const childIds = detail.task?.availability === "available" ? (detail.task.data?.parents ?? []) : [];
  const snapshot = await boardSnapshot();
  const children = childIds.map((id) => ({ id, title: snapshot.tasks.data.find((item) => item.id === id && boardOf(item.board) === board)?.title }));
  await db.transaction(async (tx) => {
    // The card row serialises two people opening the same card at once.
    const [card] = await tx.select().from(nayaCards).where(and(eq(nayaCards.workspaceId, workspaceId), eq(nayaCards.board, board), eq(nayaCards.taskId, taskId))).for("update");
    const again = await tx.select({ id: nayaChecklistItems.id }).from(nayaChecklistItems).where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, board), eq(nayaChecklistItems.taskId, taskId))).limit(1);
    if (again.length) return;
    await tx.insert(nayaChecklistItems).values(seedItems(task, children).map((item) => ({ workspaceId, board, taskId, ...item, picUserId: card?.picUserId ?? null })));
  });
}

/**
 * One person's decision on one item. When it was the last item being checked, the card moves in
 * Hermes in the same transaction: if Hermes refuses, the decision is not saved either.
 */
export async function decideItem(
  workspaceId: string,
  board: string | undefined,
  taskId: string,
  itemId: string,
  decision: { status: ChecklistStatus; note?: string },
  actor: Actor,
  canReview: boolean,
): Promise<{ outcome: CardOutcome }> {
  const key = boardOf(board);
  const task = await findTask(key, taskId, true);
  if (task.status !== "review") throw new HttpError(409, "Checklist hanya bisa diputuskan saat kartu menunggu review.");
  return db.transaction(async (tx) => {
    await tx.select({ id: nayaCards.id }).from(nayaCards).where(and(eq(nayaCards.workspaceId, workspaceId), eq(nayaCards.board, key), eq(nayaCards.taskId, taskId))).for("update");
    const items = await tx
      .select({ ...itemColumns })
      .from(nayaChecklistItems)
      .where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, key), eq(nayaChecklistItems.taskId, taskId)));
    const item = items.find((row) => row.id === itemId);
    if (!item) throw new HttpError(404, "Item checklist tidak dikenal.");
    if (item.picUserId !== actor.id && !canReview) throw new HttpError(403, "Item ini milik PIC lain.");
    const note = decision.status === "feedback" || decision.status === "rejected" ? decision.note!.trim() : decision.note?.trim() || null;
    const now = new Date();
    const decided = decision.status === "in_progress" ? null : now;
    await tx
      .update(nayaChecklistItems)
      .set({ status: decision.status, note, decidedBy: decided ? actor.id : null, decidedAt: decided, updatedAt: now })
      .where(eq(nayaChecklistItems.id, itemId));
    const after = items.map((row) => (row.id === itemId ? { ...row, status: decision.status, note } : { ...row, status: row.status as ChecklistStatus }));
    const outcome = cardOutcome(after.map((row) => row.status));
    if (outcome === "wait") return { outcome };

    const sendBack = after.filter((row) => row.status !== "done");
    if (outcome !== "approve") {
      // Feedback and rejections become candidate rules for the agent; a person activates them.
      await tx.insert(nayaLearnedRules).values(
        sendBack.filter((row) => row.note).map((row) => ({ workspaceId, agent: task.assignee ?? null, ruleText: row.note!, sourceItemId: row.id, createdBy: actor.id })),
      );
      // The agent redoes these; they come back to their PIC as the next version.
      for (const row of sendBack) {
        await tx
          .update(nayaChecklistItems)
          .set({ status: "in_progress", decidedBy: null, decidedAt: null, handedAt: null, remindedAt: null, updatedAt: now, version: row.version + 1 })
          .where(eq(nayaChecklistItems.id, row.id));
      }
    }
    // Last: if Hermes refuses, the transaction (and the decision) rolls back.
    const hermesNote = outcome === "approve" ? `Semua ${after.length} item checklist Selesai.` : handoffNote(after);
    await bridge.review(taskId, outcome, { note: hermesNote, board: key }, actor);
    return { outcome };
  });
}

export interface InboxEntry {
  id: string;
  board: string;
  title: string;
  assignee: string | null;
  /** Items waiting for this person; 0 when the card has no checklist yet (opening it creates one). */
  pending: number;
  total: number;
  waitingSince: string | null;
  stale: boolean;
}

/**
 * Tugas Saya: cards in review that wait on this person, either as the PIC of an item still being
 * checked, or as the card's PIC before its checklist exists. Items with no PIC wait on everyone
 * who may review. The oldest and overdue come first; "Lanjut" opens the first.
 */
export async function inbox(workspaceId: string, me: string, canReview: boolean, now = Date.now()): Promise<InboxEntry[]> {
  const snapshot = await boardSnapshot();
  const inReview = snapshot.tasks.data.filter((task) => task.status === "review" && task.id);
  if (!inReview.length) return [];
  const ids = [...new Set(inReview.map((task) => task.id!))];
  const [cards, items] = await Promise.all([
    db.select().from(nayaCards).where(and(eq(nayaCards.workspaceId, workspaceId), inArray(nayaCards.taskId, ids))),
    db.select().from(nayaChecklistItems).where(and(eq(nayaChecklistItems.workspaceId, workspaceId), inArray(nayaChecklistItems.taskId, ids))),
  ]);
  return inboxEntries(inReview, cards, items, me, canReview, now);
}

type CardRow = { board: string; taskId: string; picUserId: string | null; updatedAt: Date };
type ItemRow = { board: string; taskId: string; picUserId: string | null; status: string; handedAt: Date | null; updatedAt: Date };

export function inboxEntries(tasks: BoardTask[], cards: CardRow[], items: ItemRow[], me: string, canReview: boolean, now: number): InboxEntry[] {
  const mine = (pic: string | null) => pic === me || (!pic && canReview);
  const entries: InboxEntry[] = [];
  for (const task of tasks) {
    const board = boardOf(task.board);
    const card = cards.find((row) => row.board === board && row.taskId === task.id);
    const own = items.filter((row) => row.board === board && row.taskId === task.id);
    const waiting = own.length ? own.filter((row) => row.status === "in_progress" && mine(row.picUserId)) : mine(card?.picUserId ?? null) ? [] : null;
    if (waiting === null || (own.length && !waiting.length)) continue;
    const since = waiting.length ? Math.min(...waiting.map((row) => (row.handedAt ?? row.updatedAt).getTime())) : null;
    entries.push({
      id: task.id!,
      board,
      title: task.title,
      assignee: task.assignee ?? null,
      pending: waiting.length,
      total: own.length,
      waitingSince: since === null ? null : new Date(since).toISOString(),
      stale: since !== null && now - since > STALE_MS,
    });
  }
  return entries.sort((a, b) => Number(b.stale) - Number(a.stale) || (a.waitingSince ?? "").localeCompare(b.waitingSince ?? ""));
}

/** PIC and checklist progress per card, for the board's cards. */
export async function cardSummaries(workspaceId: string) {
  const [cards, items, people] = await Promise.all([
    db.select({ board: nayaCards.board, taskId: nayaCards.taskId, picUserId: nayaCards.picUserId }).from(nayaCards).where(eq(nayaCards.workspaceId, workspaceId)),
    db.select({ board: nayaChecklistItems.board, taskId: nayaChecklistItems.taskId, status: nayaChecklistItems.status }).from(nayaChecklistItems).where(eq(nayaChecklistItems.workspaceId, workspaceId)),
    listPeople(workspaceId),
  ]);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const summary = new Map<string, { board: string; taskId: string; pic: string | null; picName: string | null; done: number; total: number }>();
  for (const card of cards) {
    summary.set(`${card.board}:${card.taskId}`, { board: card.board, taskId: card.taskId, pic: card.picUserId, picName: card.picUserId ? (names.get(card.picUserId) ?? null) : null, done: 0, total: 0 });
  }
  for (const item of items) {
    const entry = summary.get(`${item.board}:${item.taskId}`);
    if (!entry) continue;
    entry.total += 1;
    if (item.status === "done") entry.done += 1;
  }
  return [...summary.values()];
}
