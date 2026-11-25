import { createDbClient, employees, nayaChecklistItems } from "@repo/database";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { normalizePhoneNumber, sendText } from "../whatsapp/service.js";
import { appUrl } from "../auth/login-links.js";
import { boardOf, boardSnapshot, seedChecklist, STALE_MS } from "./checklist.js";

// WhatsApp for the hybrid flow (run by the worker every 10 minutes): when the AI hands a card
// over, its PIC gets a message with a link straight to the card; work left waiting longer than
// 48 hours is nudged once a day. People without a phone on their employee record only see it in
// Tugas Saya.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;

/** The card in Naya's Tugas Saya; null while Naya is off (no NAYA_WEB_URL). */
export function cardLink(board: string, taskId: string): string | null {
  const base = appUrl("naya");
  return base ? `${base}/#/my-tasks/${encodeURIComponent(board)}/${encodeURIComponent(taskId)}` : null;
}

export interface CardNotice { board: string; taskId: string; title: string; items: number; version: number }

/** One message per person: every card handed to them (or overdue) in this run, each with its link. */
export function noticeText(kind: "handoff" | "reminder", cards: CardNotice[]): string {
  const head = kind === "handoff"
    ? `Naya: ${cards.length === 1 ? "1 kartu" : `${cards.length} kartu`} selesai dikerjakan AI dan menunggu keputusan Anda.`
    : `Naya: ${cards.length === 1 ? "1 kartu" : `${cards.length} kartu`} sudah menunggu keputusan Anda lebih dari 48 jam.`;
  const lines = cards.map((card) => {
    const link = cardLink(card.board, card.taskId);
    const version = card.version > 1 ? ` · v${card.version}` : "";
    return `• ${card.title} (${card.items} item${version})${link ? `\n  ${link}` : ""}`;
  });
  return [head, "", ...lines, "", "Tandai tiap item: Selesai, Feedback (dengan catatan), atau Ditolak (dengan alasan)."].join("\n");
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
  const plan = planNotices(waiting, titles, now);

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
  for (const entry of plan.handoff) {
    const jid = jidOf(entry.pic);
    // Handed over either way: Tugas Saya counts the wait from now, and a failed send is not retried.
    if (jid) await sendText(workspaceId, jid, noticeText("handoff", entry.cards)).catch(() => { unreachable += 1; });
    else unreachable += 1;
    await db.update(nayaChecklistItems).set({ handedAt: at }).where(and(inArray(nayaChecklistItems.id, entry.ids), isNull(nayaChecklistItems.handedAt)));
  }
  for (const entry of plan.reminder) {
    const jid = jidOf(entry.pic);
    if (!jid) continue;
    await sendText(workspaceId, jid, noticeText("reminder", entry.cards)).catch(() => undefined);
    await db.update(nayaChecklistItems).set({ remindedAt: at }).where(inArray(nayaChecklistItems.id, entry.ids));
  }
  return { handoffs: plan.handoff.length, reminders: plan.reminder.length, unreachable };
}
