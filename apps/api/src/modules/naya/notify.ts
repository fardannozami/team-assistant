import { createDbClient, employees, nayaCards, nayaChecklistItems } from "@repo/database";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { normalizePhoneNumber, sendText } from "../whatsapp/service.js";
import { appUrl, createLoginLink, HANDOVER_LINK_TTL_MS } from "../auth/login-links.js";
import { ensureEmployeeAccount, employeeRef } from "./accounts.js";
import { boardOf, boardSnapshot, seedChecklist, STALE_MS } from "./checklist.js";
import { memberPools } from "./members.js";

// WhatsApp for the hybrid flow (run by the worker every 10 minutes): when the AI hands a card
// over, its PIC gets a message with a link straight to the card; work left waiting longer than
// 48 hours is nudged once a day. Each link signs its PIC in on the way (a one-time code, made for
// them, good for 12 hours), so a tap opens the card; their daily account is made on first use.
// A card given to a whole team reaches everyone in it.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;

/** The card's page in Naya's Tugas Saya. */
export const cardPath = (board: string, taskId: string) => `/my-tasks/${encodeURIComponent(board)}/${encodeURIComponent(taskId)}`;

/** The card in Naya's Tugas Saya, without signing in; null while Naya is off (no NAYA_WEB_URL). */
export function cardLink(board: string, taskId: string): string | null {
  const base = appUrl("naya");
  return base ? `${base}/#${cardPath(board, taskId)}` : null;
}

/** `link`: the card's sign-in link for this person, when one could be made. */
export interface CardNotice { board: string; taskId: string; title: string; items: number; version: number; link?: string | null }

/** One message per person: every card handed to them (or overdue) in this run, each with its link. */
export function noticeText(kind: "handoff" | "reminder", cards: CardNotice[]): string {
  const head = kind === "handoff"
    ? `Naya: ${cards.length === 1 ? "1 kartu" : `${cards.length} kartu`} selesai dikerjakan AI dan menunggu keputusan Anda.`
    : `Naya: ${cards.length === 1 ? "1 kartu" : `${cards.length} kartu`} sudah menunggu keputusan Anda lebih dari 48 jam.`;
  const lines = cards.map((card) => {
    const link = card.link ?? cardLink(card.board, card.taskId);
    const version = card.version > 1 ? ` · v${card.version}` : "";
    return `• ${card.title} (${card.items} item${version})${link ? `\n  ${link}` : ""}`;
  });
  const signIn = cards.some((card) => card.link)
    ? ["Ketuk link untuk langsung masuk ke kartunya. Link hanya untuk Anda, sekali pakai, berlaku 12 jam; setelah itu ketik NAYA untuk link baru."]
    : [];
  return [head, "", ...lines, "", "Tandai tiap item: Selesai, Feedback (dengan catatan), atau Ditolak (dengan alasan).", ...signIn].join("\n");
}

type Waiting = { id: string; board: string; taskId: string; picEmployeeId: string | null; version: number; handedAt: Date | null; remindedAt: Date | null };

/** Splits the items waiting on people into new handoffs and overdue reminders, per person. */
export function planNotices(items: Waiting[], titles: Map<string, string>, now: number) {
  const handoff = new Map<string, Waiting[]>();
  const reminder = new Map<string, Waiting[]>();
  for (const item of items) {
    if (!item.picEmployeeId) continue;
    const add = (into: Map<string, Waiting[]>) => into.set(item.picEmployeeId!, [...(into.get(item.picEmployeeId!) ?? []), item]);
    if (!item.handedAt) add(handoff);
    else if (now - item.handedAt.getTime() > STALE_MS && (!item.remindedAt || now - item.remindedAt.getTime() > REMIND_EVERY_MS)) add(reminder);
  }
  const cards = (list: Waiting[]): CardNotice[] => {
    const byCard = new Map<string, CardNotice>();
    for (const item of list) {
      const key = `${item.board}:${item.taskId}`;
      const card = byCard.get(key) ?? { board: item.board, taskId: item.taskId, title: titles.get(key) ?? item.taskId, items: 0, version: 1 };
      card.items += 1;
      card.version = Math.max(card.version, item.version);
      byCard.set(key, card);
    }
    return [...byCard.values()];
  };
  return {
    handoff: [...handoff].map(([pic, list]) => ({ pic, ids: list.map((item) => item.id), cards: cards(list) })),
    reminder: [...reminder].map(([pic, list]) => ({ pic, ids: list.map((item) => item.id), cards: cards(list) })),
  };
}

/** Items without a PIC on a whole-team card, once for each member of that team. */
export function expandTeams(items: Waiting[], groups: Map<string, string>, pools: Map<string, string | null>): Waiting[] {
  return items.flatMap((item) => {
    const group = item.picEmployeeId ? undefined : groups.get(`${item.board}:${item.taskId}`);
    if (!group) return [item];
    return [...pools].filter(([, pool]) => pool === group).map(([id]) => ({ ...item, picEmployeeId: id }));
  });
}

async function withTeams(workspaceId: string, items: Waiting[]): Promise<Waiting[]> {
  const taskIds = [...new Set(items.filter((item) => !item.picEmployeeId).map((item) => item.taskId))];
  if (!taskIds.length) return items;
  const cards = await db
    .select({ board: nayaCards.board, taskId: nayaCards.taskId, group: nayaCards.picGroup })
    .from(nayaCards)
    .where(and(eq(nayaCards.workspaceId, workspaceId), inArray(nayaCards.taskId, taskIds)));
  const groups = new Map(cards.filter((card) => card.group).map((card) => [`${card.board}:${card.taskId}`, card.group!]));
  return groups.size ? expandTeams(items, groups, await memberPools(workspaceId)) : items;
}

export async function notifyHandoffs(workspaceId: string, now = Date.now()) {
  const snapshot = await boardSnapshot(true);
  const inReview = snapshot.tasks.data.filter((task) => task.status === "review" && task.id);
  for (const task of inReview) await seedChecklist(workspaceId, boardOf(task.board), task).catch(() => undefined);
  if (!inReview.length) return { handoffs: 0, reminders: 0, unreachable: 0 };

  const titles = new Map(inReview.map((task) => [`${boardOf(task.board)}:${task.id}`, task.title]));
  const rows = await db
    .select({
      id: nayaChecklistItems.id,
      board: nayaChecklistItems.board,
      taskId: nayaChecklistItems.taskId,
      picEmployeeId: nayaChecklistItems.picEmployeeId,
      version: nayaChecklistItems.version,
      handedAt: nayaChecklistItems.handedAt,
      remindedAt: nayaChecklistItems.remindedAt,
    })
    .from(nayaChecklistItems)
    .where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.status, "in_progress"), inArray(nayaChecklistItems.taskId, [...new Set(inReview.map((task) => task.id!))])));
  const waiting = rows.filter((row) => titles.has(`${row.board}:${row.taskId}`));
  const plan = planNotices(await withTeams(workspaceId, waiting), titles, now);

  const pics = [...new Set([...plan.handoff, ...plan.reminder].map((entry) => entry.pic))];
  const phones = pics.length
    ? await db.select({ id: employees.id, phone: employees.phone }).from(employees).where(and(eq(employees.workspaceId, workspaceId), eq(employees.isActive, true), inArray(employees.id, pics)))
    : [];
  const jidOf = (pic: string) => {
    const phone = phones.find((row) => row.id === pic)?.phone;
    try {
      return phone ? `${normalizePhoneNumber(phone)}@s.whatsapp.net` : null;
    } catch {
      return null;
    }
  };

  let unreachable = 0;
  const at = new Date(now);
  // Each card's link signs the PIC in (their account is made on first use), opening that card.
  const withLinks = async (pic: string, cards: CardNotice[]): Promise<CardNotice[]> => {
    if (!appUrl("naya")) return cards;
    const employee = await employeeRef(workspaceId, pic);
    const userId = employee ? await ensureEmployeeAccount(employee).catch(() => null) : null;
    if (!userId) return cards;
    return Promise.all(cards.map(async (card) => ({ ...card, link: await createLoginLink(userId, "naya", HANDOVER_LINK_TTL_MS, cardPath(card.board, card.taskId)) })));
  };
  for (const entry of plan.handoff) {
    const jid = jidOf(entry.pic);
    // Handed over either way: Tugas Saya counts the wait from now, and a failed send is not retried.
    if (jid) await sendText(workspaceId, jid, noticeText("handoff", await withLinks(entry.pic, entry.cards))).catch(() => { unreachable += 1; });
    else unreachable += 1;
    await db.update(nayaChecklistItems).set({ handedAt: at }).where(and(inArray(nayaChecklistItems.id, entry.ids), isNull(nayaChecklistItems.handedAt)));
  }
  for (const entry of plan.reminder) {
    const jid = jidOf(entry.pic);
    if (!jid) continue;
    await sendText(workspaceId, jid, noticeText("reminder", await withLinks(entry.pic, entry.cards))).catch(() => undefined);
    await db.update(nayaChecklistItems).set({ remindedAt: at }).where(inArray(nayaChecklistItems.id, entry.ids));
  }
  return { handoffs: plan.handoff.length, reminders: plan.reminder.length, unreachable };
}
