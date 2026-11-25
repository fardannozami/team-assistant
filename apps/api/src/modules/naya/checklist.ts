import { createDbClient, nayaCards, nayaChecklistItems, nayaLearnedRules } from "@repo/database";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { NAYA_POOLS, type ChecklistStatus, type NayaPool } from "@repo/shared";
import { HttpError } from "../../lib/http-error.js";
import { bridge, type Actor } from "./bridge.js";
import { assertMember, memberNames, pickAvailable } from "./members.js";

// The human half of a card (blueprint v3): the AI drafts until Hermes puts the card in review,
// then Naya hands it to people as a checklist (one item per subtask result, plus the card's own
// result). Each item is In Progress, Selesai, Feedback (with what to fix) or Ditolak (with why).
// The card only moves once nobody is still checking: all Selesai completes it in Hermes, any
// Ditolak blocks it, otherwise the Feedback notes reopen it for the agent. Items that were not
// Selesai come back as the next version when the agent hands the card over again.
// PICs are team members (employees). A card left on "auto" gets the most available member of its
// pool when the AI hands it over: sales/PM to review, then design or development once a reviewed
// card is continued to them.

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

const cardWhere = (workspaceId: string, board: string, taskId: string) => and(eq(nayaCards.workspaceId, workspaceId), eq(nayaCards.board, board), eq(nayaCards.taskId, taskId));

/**
 * Sets who is in charge of a card (and of its items still being checked by the previous PIC).
 * `pool` leaves the choice to handover time: the most available member of that pool.
 */
export async function setCardPic(
  workspaceId: string,
  board: string | undefined,
  taskId: string,
  pic: string | null,
  options: { createdBy?: string; pool?: NayaPool | null; continuesFrom?: string } = {},
) {
  const key = boardOf(board);
  if (pic) await assertMember(workspaceId, pic);
  const [before] = await db.select({ pic: nayaCards.picEmployeeId }).from(nayaCards).where(cardWhere(workspaceId, key, taskId)).limit(1);
  const pool = options.pool === undefined ? {} : { picPool: options.pool };
  await db
    .insert(nayaCards)
    .values({ workspaceId, board: key, taskId, picEmployeeId: pic, createdBy: options.createdBy, continuesFrom: options.continuesFrom, ...pool })
    .onConflictDoUpdate({ target: [nayaCards.workspaceId, nayaCards.board, nayaCards.taskId], set: { picEmployeeId: pic, ...pool, updatedAt: new Date() } });
  // Items the previous PIC had not decided yet move along; the new PIC is notified for them.
  const previous = before?.pic ? eq(nayaChecklistItems.picEmployeeId, before.pic) : isNull(nayaChecklistItems.picEmployeeId);
  await db
    .update(nayaChecklistItems)
    .set({ picEmployeeId: pic, handedAt: null, remindedAt: null, updatedAt: new Date() })
    .where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, key), eq(nayaChecklistItems.taskId, taskId), eq(nayaChecklistItems.status, "in_progress"), previous));
}

export async function setItemPic(workspaceId: string, board: string | undefined, taskId: string, itemId: string, pic: string | null) {
  if (pic) await assertMember(workspaceId, pic);
  const [row] = await db
    .update(nayaChecklistItems)
    .set({ picEmployeeId: pic, handedAt: null, remindedAt: null, updatedAt: new Date() })
    .where(and(eq(nayaChecklistItems.id, itemId), eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, boardOf(board)), eq(nayaChecklistItems.taskId, taskId)))
    .returning({ id: nayaChecklistItems.id });
  if (!row) throw new HttpError(404, "Item checklist tidak dikenal.");
}

const itemColumns = {
  id: nayaChecklistItems.id,
  title: nayaChecklistItems.title,
  sourceTaskId: nayaChecklistItems.sourceTaskId,
  picEmployeeId: nayaChecklistItems.picEmployeeId,
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
  const [card] = await db.select().from(nayaCards).where(cardWhere(workspaceId, key, taskId)).limit(1);
  const items = await db
    .select(itemColumns)
    .from(nayaChecklistItems)
    .where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, key), eq(nayaChecklistItems.taskId, taskId)))
    .orderBy(asc(nayaChecklistItems.createdAt), asc(nayaChecklistItems.sourceTaskId));
  // Which agent made each item: the subtask's assignee, or the card's for its own result.
  const tasks = (await boardSnapshot()).tasks.data.filter((item) => boardOf(item.board) === key);
  const agentOf = (id: string | null) => (id ? tasks.find((item) => item.id === id)?.assignee : task.assignee) ?? null;
  return {
    status: task.status,
    pic: card?.picEmployeeId ?? null,
    pool: (card?.picPool as NayaPool | null) ?? null,
    continuesFrom: card?.continuesFrom ?? null,
    continuedTo: card?.continuedTo ?? null,
    continuedStep: (card?.continuedStep as NayaPool | null) ?? null,
    items: items.map((item) => ({ ...item, agent: agentOf(item.sourceTaskId) })),
  };
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
  // "Auto": the most available member of the card's pool, chosen now that the work is ready.
  const [current] = await db.select({ pic: nayaCards.picEmployeeId, pool: nayaCards.picPool }).from(nayaCards).where(cardWhere(workspaceId, board, taskId)).limit(1);
  const picked = !current?.pic && current?.pool ? await pickAvailable(workspaceId, current.pool as NayaPool) : null;
  await db.transaction(async (tx) => {
    // The card row serialises two people opening the same card at once.
    const [card] = await tx.select().from(nayaCards).where(cardWhere(workspaceId, board, taskId)).for("update");
    const again = await tx.select({ id: nayaChecklistItems.id }).from(nayaChecklistItems).where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, board), eq(nayaChecklistItems.taskId, taskId))).limit(1);
    if (again.length) return;
    const pic = card?.picEmployeeId ?? picked;
    if (card && !card.picEmployeeId && pic) await tx.update(nayaCards).set({ picEmployeeId: pic, updatedAt: new Date() }).where(eq(nayaCards.id, card.id));
    await tx.insert(nayaChecklistItems).values(seedItems(task, children).map((item) => ({ workspaceId, board, taskId, ...item, picEmployeeId: pic })));
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
  me: { employeeId: string | null; canReview: boolean },
): Promise<{ outcome: CardOutcome }> {
  const key = boardOf(board);
  const task = await findTask(key, taskId, true);
  if (task.status !== "review") throw new HttpError(409, "Checklist hanya bisa diputuskan saat kartu menunggu review.");
  return db.transaction(async (tx) => {
    await tx.select({ id: nayaCards.id }).from(nayaCards).where(cardWhere(workspaceId, key, taskId)).for("update");
    const items = await tx
      .select({ ...itemColumns })
      .from(nayaChecklistItems)
      .where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.board, key), eq(nayaChecklistItems.taskId, taskId)));
    const item = items.find((row) => row.id === itemId);
    if (!item) throw new HttpError(404, "Item checklist tidak dikenal.");
    if ((!me.employeeId || item.picEmployeeId !== me.employeeId) && !me.canReview) throw new HttpError(403, "Item ini milik PIC lain.");
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
 * who may review. The oldest and overdue come first.
 */
export async function inbox(workspaceId: string, me: string | null, canReview: boolean, now = Date.now()): Promise<InboxEntry[]> {
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

type CardRow = { board: string; taskId: string; picEmployeeId: string | null; updatedAt: Date };
type ItemRow = { board: string; taskId: string; picEmployeeId: string | null; status: string; handedAt: Date | null; updatedAt: Date };

/** `me` is the signed-in person's employee id (null when their account is not linked to one). */
export function inboxEntries(tasks: BoardTask[], cards: CardRow[], items: ItemRow[], me: string | null, canReview: boolean, now: number): InboxEntry[] {
  const mine = (pic: string | null) => (!!me && pic === me) || (!pic && canReview);
  const entries: InboxEntry[] = [];
  for (const task of tasks) {
    const board = boardOf(task.board);
    const card = cards.find((row) => row.board === board && row.taskId === task.id);
    const own = items.filter((row) => row.board === board && row.taskId === task.id);
    const waiting = own.length ? own.filter((row) => row.status === "in_progress" && mine(row.picEmployeeId)) : mine(card?.picEmployeeId ?? null) ? [] : null;
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
  const [cards, items] = await Promise.all([
    db.select({ board: nayaCards.board, taskId: nayaCards.taskId, pic: nayaCards.picEmployeeId, pool: nayaCards.picPool }).from(nayaCards).where(eq(nayaCards.workspaceId, workspaceId)),
    db.select({ board: nayaChecklistItems.board, taskId: nayaChecklistItems.taskId, status: nayaChecklistItems.status }).from(nayaChecklistItems).where(eq(nayaChecklistItems.workspaceId, workspaceId)),
  ]);
  const names = await memberNames(workspaceId, [...new Set(cards.map((card) => card.pic).filter((pic): pic is string => !!pic))]);
  const summary = new Map<string, { board: string; taskId: string; pic: string | null; picName: string | null; pool: string | null; done: number; total: number }>();
  for (const card of cards) {
    summary.set(`${card.board}:${card.taskId}`, { board: card.board, taskId: card.taskId, pic: card.pic, picName: card.pic ? (names.get(card.pic) ?? null) : null, pool: card.pool, done: 0, total: 0 });
  }
  for (const item of items) {
    const entry = summary.get(`${item.board}:${item.taskId}`);
    if (!entry) continue;
    entry.total += 1;
    if (item.status === "done") entry.done += 1;
  }
  return [...summary.values()];
}

/** What the AI agent is asked to make when a reviewed card continues to design or development. */
export function continuation(step: Exclude<NayaPool, "review">, title: string, note?: string): { title: string; body: string; assignee: string } {
  const extra = note ? `\n\nCatatan dari reviewer: ${note}` : "";
  if (step === "design") {
    return {
      title: `Design requirement: ${title}`.slice(0, 200),
      assignee: "naya-3a",
      body: `Lanjutan dari hasil yang sudah direview dan disetujui Sales/PM (lihat hasil lengkapnya di tugas induk). Susun design requirement untuk desainer: tujuan, siapa penggunanya, user flow, daftar layar beserta state wajibnya (kosong, memuat, error, sukses), microcopy siap pakai, referensi gaya bila ada, dan kriteria selesai. Desain visual high-fidelity tetap dikerjakan desainer di Figma.${extra}`,
    };
  }
  return {
    title: `PRD & spesifikasi: ${title}`.slice(0, 200),
    assignee: "naya-2b",
    body: `Lanjutan dari hasil yang sudah direview dan disetujui Sales/PM (lihat hasil lengkapnya di tugas induk). Susun PRD untuk developer: latar belakang dan tujuan, fitur urut prioritas, user story dengan acceptance criteria, data yang disimpan, usulan endpoint API, bagian rawan, pertanyaan terbuka, dan backlog. Logika bisnis inti, code review final, dan merge tetap dikerjakan developer.${extra}`,
  };
}

/**
 * Continues a reviewed card to design or development: a new card for the AI agent (2B PRD or 3A
 * design requirement) that waits on this one, so it reads its full approved result, and goes to
 * the most available designer or developer once the agent is done. Once per card.
 */
export async function continueCard(workspaceId: string, board: string | undefined, taskId: string, step: Exclude<NayaPool, "review">, note: string | undefined, actor: Actor) {
  const key = boardOf(board);
  const task = await findTask(key, taskId, true);
  if (task.status !== "done") throw new HttpError(409, "Kartu bisa dilanjutkan setelah semua item checklist Selesai.");
  await ensureCard(workspaceId, key, taskId);
  return db.transaction(async (tx) => {
    const [card] = await tx.select().from(nayaCards).where(cardWhere(workspaceId, key, taskId)).for("update");
    if (card?.continuedTo) throw new HttpError(409, `Kartu ini sudah dilanjutkan ke ${NAYA_POOLS[card.continuedStep as NayaPool]?.label ?? card.continuedStep} (#${card.continuedTo}).`);
    const next = continuation(step, task.title, note);
    const created = await bridge.instruct({ ...next, board: key, parent: taskId, idempotencyKey: `naya-continue-${taskId}-${step}` }, actor);
    await tx.update(nayaCards).set({ continuedTo: created.id, continuedStep: step, updatedAt: new Date() }).where(cardWhere(workspaceId, key, taskId));
    await tx
      .insert(nayaCards)
      .values({ workspaceId, board: key, taskId: created.id, picPool: step, continuesFrom: taskId, createdBy: actor.id })
      .onConflictDoNothing();
    return { id: created.id, board: key, step };
  });
}
