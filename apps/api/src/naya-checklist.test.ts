/**
 * Naya's hybrid flow: the checklist gate on cards the AI hands over, Tugas Saya and the WhatsApp
 * handoff and reminder messages.
 */
import { describe, expect, test } from "bun:test";
import { nayaChecklistDecisionSchema } from "@repo/shared";
import { cardOutcome, handoffNote, inboxEntries, seedItems, STALE_MS } from "./modules/naya/checklist.js";
import { noticeText, planNotices } from "./modules/naya/notify.js";

const HOUR = 60 * 60 * 1000;

describe("checklist gate", () => {
  test("the card waits while anyone is still checking", () => {
    expect(cardOutcome([])).toBe("wait");
    expect(cardOutcome(["done", "in_progress"])).toBe("wait");
    expect(cardOutcome(["feedback", "in_progress"])).toBe("wait");
  });

  test("all Selesai completes it; a rejection outweighs feedback", () => {
    expect(cardOutcome(["done", "done"])).toBe("approve");
    expect(cardOutcome(["done", "feedback"])).toBe("changes");
    expect(cardOutcome(["feedback", "rejected", "done"])).toBe("reject");
  });

  test("the agent gets every item that needs work, with its version and the note", () => {
    const note = handoffNote([
      { title: "Riset pasar", status: "done", note: null, version: 1 },
      { title: "Draf PRD", status: "feedback", note: "Tambah acceptance criteria", version: 2 },
      { title: "Daftar layar", status: "rejected", note: "Bukan untuk klien ini", version: 1 },
    ]);
    expect(note).toBe("- Feedback · Draf PRD (v2): Tambah acceptance criteria\n- Ditolak · Daftar layar (v1): Bukan untuk klien ini");
  });

  test("one item per subtask result, then the card's own result", () => {
    expect(seedItems({ title: "PRD aplikasi kasir" }, [])).toEqual([{ title: "PRD aplikasi kasir", sourceTaskId: null }]);
    expect(seedItems({ title: "PRD" }, [{ id: "t1", title: "Riset" }, { id: "t2" }])).toEqual([
      { title: "Riset", sourceTaskId: "t1" },
      { title: "t2", sourceTaskId: "t2" },
      { title: "Hasil akhir: PRD", sourceTaskId: null },
    ]);
  });

  test("feedback and rejections need a note; Selesai does not", () => {
    expect(nayaChecklistDecisionSchema.safeParse({ status: "done" }).success).toBe(true);
    expect(nayaChecklistDecisionSchema.safeParse({ status: "feedback" }).success).toBe(false);
    expect(nayaChecklistDecisionSchema.safeParse({ status: "rejected", note: "  " }).success).toBe(false);
    expect(nayaChecklistDecisionSchema.safeParse({ status: "rejected", note: "Salah klien" }).success).toBe(true);
  });
});

describe("tugas saya", () => {
  const now = Date.UTC(2026, 10, 25, 12);
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR);
  const tasks = [
    { id: "a", title: "PRD kasir", status: "review", board: "default" },
    { id: "b", title: "Wireframe", status: "review", board: "default" },
    { id: "c", title: "Baru diserahkan", status: "review", board: "default" },
  ];
  const item = (taskId: string, picUserId: string | null, status: string, hoursAgo: number) => ({ board: "default", taskId, picUserId, status, handedAt: at(hoursAgo), updatedAt: at(hoursAgo) });

  test("lists my items still being checked, overdue first", () => {
    const entries = inboxEntries(
      tasks,
      [{ board: "default", taskId: "c", picUserId: "me", updatedAt: at(1) }],
      [item("a", "me", "in_progress", 2), item("a", "me", "done", 3), item("b", "me", "in_progress", 50), item("b", "other", "in_progress", 50)],
      "me",
      false,
      now,
    );
    expect(entries.map((entry) => [entry.id, entry.pending, entry.total, entry.stale])).toEqual([
      ["b", 1, 2, true],
      ["c", 0, 0, false],
      ["a", 1, 2, false],
    ]);
  });

  test("items without a PIC wait on reviewers only", () => {
    const items = [item("a", null, "in_progress", 1)];
    expect(inboxEntries(tasks.slice(0, 1), [], items, "me", false, now)).toEqual([]);
    expect(inboxEntries(tasks.slice(0, 1), [], items, "me", true, now)).toHaveLength(1);
  });

  test("a card whose items are all decided by me drops out", () => {
    expect(inboxEntries(tasks.slice(0, 1), [], [item("a", "me", "done", 1)], "me", true, now)).toEqual([]);
  });
});

describe("whatsapp handoff", () => {
  const now = Date.UTC(2026, 10, 25, 12);
  const row = (id: string, taskId: string, pic: string | null, handedHoursAgo: number | null, remindedHoursAgo: number | null = null, version = 1) => ({
    id,
    board: "default",
    taskId,
    picUserId: pic,
    version,
    handedAt: handedHoursAgo === null ? null : new Date(now - handedHoursAgo * HOUR),
    remindedAt: remindedHoursAgo === null ? null : new Date(now - remindedHoursAgo * HOUR),
  });
  const titles = new Map([["default:a", "PRD kasir"], ["default:b", "Wireframe"]]);

  test("new handoffs are grouped per person and card; overdue ones are nudged once a day", () => {
    const plan = planNotices(
      [
        row("1", "a", "budi", null),
        row("2", "a", "budi", null, null, 2),
        row("3", "b", "budi", 50),
        row("4", "b", "sari", 50, 2),
        row("5", "b", "sari", 10),
        row("6", "a", null, null),
      ],
      titles,
      now,
    );
    expect(plan.handoff).toEqual([{ pic: "budi", ids: ["1", "2"], cards: [{ board: "default", taskId: "a", title: "PRD kasir", items: 2, version: 2 }] }]);
    expect(plan.reminder).toEqual([{ pic: "budi", ids: ["3"], cards: [{ board: "default", taskId: "b", title: "Wireframe", items: 1, version: 1 }] }]);
    expect(STALE_MS).toBe(48 * HOUR);
  });

  test("the message links straight to the card", () => {
    const previous = process.env.NAYA_WEB_URL;
    process.env.NAYA_WEB_URL = "https://naya.digdaya.co/";
    try {
      const text = noticeText("handoff", [{ board: "default", taskId: "t_9", title: "PRD kasir", items: 2, version: 2 }]);
      expect(text).toContain("1 kartu selesai dikerjakan AI");
      expect(text).toContain("• PRD kasir (2 item · v2)\n  https://naya.digdaya.co/#/my-tasks/default/t_9");
      expect(noticeText("reminder", [{ board: "default", taskId: "t_9", title: "PRD", items: 1, version: 1 }])).toContain("lebih dari 48 jam");
    } finally {
      process.env.NAYA_WEB_URL = previous;
    }
  });
});
