/**
 * Naya's hybrid flow: the checklist gate on cards the AI hands over, Tugas Saya and the WhatsApp
 * handoff and reminder messages.
 */
import { describe, expect, test } from "bun:test";
import { HERMES_PROFILE, NAYA_ROSTER, nayaSees, ROSTER_FALLBACK, nayaChecklistDecisionSchema, nayaInstructionSchema, nayaPoolOf, rosterAgent } from "@repo/shared";
import { cardOutcome, continuation, handoffNote, inboxEntries, seedItems, STALE_MS } from "./modules/naya/checklist.js";
import { mostAvailable, type Member } from "./modules/naya/members.js";
import { cardPath, noticeText, planNotices } from "./modules/naya/notify.js";
import { whatsappEmail } from "./modules/naya/accounts.js";
import { NEXT_PATH } from "./modules/auth/login-links.js";

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
  const item = (taskId: string, picEmployeeId: string | null, status: string, hoursAgo: number) => ({ board: "default", taskId, picEmployeeId, status, handedAt: at(hoursAgo), updatedAt: at(hoursAgo) });

  test("lists my items still being checked, overdue first", () => {
    const entries = inboxEntries(
      tasks,
      [{ board: "default", taskId: "c", picEmployeeId: "me", updatedAt: at(1) }],
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
    picEmployeeId: pic,
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

describe("agent roster", () => {
  test("every code is a usable Hermes assignee, once", () => {
    const codes = NAYA_ROSTER.map((agent) => agent.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(HERMES_PROFILE);
  });

  test("agents the splitter may pick have a contract; the others say why they are off", () => {
    for (const agent of NAYA_ROSTER) {
      if (agent.available) expect(agent.prompt.length).toBeGreaterThan(40);
      else expect(agent.reason).toBeTruthy();
      expect(agent.pic).toBeTruthy();
    }
    expect(rosterAgent(ROSTER_FALLBACK)?.available).toBe(true);
    expect(rosterAgent("naya-2b")?.label).toBe("2B");
  });
});

describe("who picks up a card", () => {
  const member = (name: string, lead: string | null, presence: Member["presence"], load = 0, team: string | null = null): Member =>
    ({ id: name.toLowerCase(), name, team, lead, pool: nayaPoolOf(lead, team), presence, userId: null, load });

  test("a member's position decides the pool; the team's name only when there is none", () => {
    expect(nayaPoolOf("pm_sales")).toBe("review");
    expect(nayaPoolOf("designer")).toBe("design");
    expect(nayaPoolOf("design")).toBe("design");
    expect(nayaPoolOf("developer", "Sales")).toBe("development");
    expect(nayaPoolOf(null, "UI/UX")).toBe("design");
    expect(nayaPoolOf(null, "Backend")).toBe("development");
    expect(nayaPoolOf(null, "Finance")).toBeNull();
    expect(nayaPoolOf(null, null)).toBeNull();
  });

  test("santai first, then working, then not in yet; never someone who checked out", () => {
    const team = [
      member("Andi", "pm_sales", "working"),
      member("Bela", "pm_sales", "standby", 3),
      member("Caca", "pm_sales", "resting"),
      member("Dina", "designer", "standby"),
    ];
    expect(mostAvailable(team, "review")?.name).toBe("Bela");
    expect(mostAvailable(team.filter((m) => m.name !== "Bela"), "review")?.name).toBe("Andi");
    expect(mostAvailable([member("Caca", "pm_sales", "resting")], "review")).toBeUndefined();
    expect(mostAvailable(team, "development")).toBeUndefined();
  });

  test("between equally available members, the one with less waiting on them", () => {
    const team = [member("Eko", "developer", "working", 4), member("Fani", "developer", "working", 1), member("Gita", "developer", "absent", 0)];
    expect(mostAvailable(team, "development")?.name).toBe("Fani");
  });

  test("instructions default to an automatic sales/PM reviewer", () => {
    expect(nayaInstructionSchema.parse({ title: "Cari prospek" }).pic).toBe("auto");
    expect(nayaInstructionSchema.safeParse({ title: "x", pic: "budi" }).success).toBe(false);
  });

  test("a reviewed card continues to the design or PRD agent, with the reviewer's note", () => {
    const design = continuation("design", "Aplikasi kasir", "Fokus mobile");
    expect(design.assignee).toBe("naya-3a");
    expect(design.title).toBe("Design requirement: Aplikasi kasir");
    expect(design.body).toContain("Catatan dari reviewer: Fokus mobile");
    const dev = continuation("development", "Aplikasi kasir");
    expect(dev.assignee).toBe("naya-2b");
    expect(dev.body).toContain("acceptance criteria");
    expect(rosterAgent(design.assignee)?.available && rosterAgent(dev.assignee)?.available).toBe(true);
  });
});

describe("signing in from WhatsApp", () => {
  test("an account made from a number has a placeholder email, distinct per workspace", () => {
    const a = whatsappEmail("0812-3456-7890", "9864c638-5d06-4768-9f6d-4a18880ee152");
    expect(a).toBe("wa.081234567890.9864c6385d06@naya.invalid");
    expect(whatsappEmail("0812-3456-7890", "3eab9caf-e9fb-4679-b32f-ed754784b2d3")).not.toBe(a);
  });

  test("a link opens only a page of Naya", () => {
    expect(NEXT_PATH.test(cardPath("default", "t_9"))).toBe(true);
    for (const bad of ["//evil.example", "https://evil.example", "/x?y=1", "/a b", "my-tasks"]) expect(NEXT_PATH.test(bad)).toBe(false);
  });

  test("the handover message carries each card's own sign-in link and says how long it lasts", () => {
    const text = noticeText("handoff", [{ board: "default", taskId: "t_9", title: "PRD kasir", items: 1, version: 1, link: "https://naya.digdaya.co/#login=ta_login_x&next=%2Fmy-tasks%2Fdefault%2Ft_9" }]);
    expect(text).toContain("#login=ta_login_x&next=");
    expect(text).toContain("berlaku 12 jam");
    expect(noticeText("handoff", [{ board: "default", taskId: "t_9", title: "PRD", items: 1, version: 1 }])).not.toContain("berlaku 12 jam");
  });
});

describe("what each role sees (blueprint access matrix)", () => {
  test("those who run the team see every page and every card; employees only the office, their tasks and settings", () => {
    for (const role of ["Owner", "Admin", "Manager", "PM"]) {
      for (const view of ["allTasks", "agents", "calendar", "usage"] as const) expect(nayaSees(role, view)).toBe(true);
    }
    for (const view of ["allTasks", "agents", "calendar", "usage"] as const) {
      expect(nayaSees("Employee", view)).toBe(false);
      expect(nayaSees(null, view)).toBe(false);
    }
  });
});
