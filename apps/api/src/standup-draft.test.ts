/** "Kemarin" drafted from GitHub activity by the workspace's AI. */
import { afterAll, describe, expect, test } from "bun:test";
import { activityLines, activityList, draftYesterday, TODAY_DONE_QUESTION } from "./modules/standups/draft.js";
import { checkoutPromptText, morningPromptText, parseStandupText } from "./modules/standups/engine.js";
import { appendWork } from "./modules/standups/engine/checkout.js";

const activity = {
  counts: { commit: 2, pr_merged: 1 },
  items: [
    { type: "pr_merged", title: "Invoice export", url: null, repository: "acme/api", occurredAt: new Date("2026-11-10T08:00:00Z") },
    { type: "commit", title: "fix: login redirect", url: null, repository: "acme/web", occurredAt: new Date("2026-11-10T03:00:00Z") },
    { type: "commit", title: null, url: null, repository: "acme/web", occurredAt: new Date("2026-11-10T04:00:00Z") },
  ],
};

// A stand-in OpenAI-compatible provider that records what it was sent.
let received: { messages: { role: string; content: string }[] } | null = null;
let reply = "Kemarin saya memperbaiki redirect login dan merge PR export invoice.";
const provider = Bun.serve({
  port: 0,
  async fetch(req) {
    received = (await req.json()) as typeof received;
    if (!reply) return new Response("boom", { status: 500 });
    return Response.json({ choices: [{ message: { role: "assistant", content: `  ${reply}\n` } }] });
  },
});
const config = { baseUrl: `http://localhost:${provider.port}`, apiKey: "test", model: "test-model" };
afterAll(() => provider.stop(true));

describe("standup draft from GitHub", () => {
  test("activity is listed oldest first, untitled events left out", () => {
    expect(activityLines(activity)).toBe("- [commit] fix: login redirect (acme/web)\n- [pr_merged] Invoice export (acme/api)");
  });

  test("the AI writes kemarin from the activity", async () => {
    expect(await draftYesterday(config, activity, "2026-11-10")).toBe(reply);
    expect(received!.messages[1]!.content).toContain("Aktivitas GitHub sejak 2026-11-10:\n- [commit] fix: login redirect");
  });

  test("the checkout draft asks what was done today", async () => {
    await draftYesterday(config, activity, "2026-11-10", TODAY_DONE_QUESTION);
    expect(received!.messages[0]!.content).toContain('"Apa yang kamu kerjakan hari ini?"');
  });

  test("without AI the draft is the notable activity", () => {
    expect(activityList(activity)).toBe("- fix: login redirect (acme/web)\n- Invoice export (acme/api)");
    expect(activityList({ counts: {}, items: [] })).toBeNull();
  });

  test("a failing provider gives no draft", async () => {
    reply = "";
    expect(await draftYesterday(config, activity, "2026-11-10")).toBeNull();
  });

  test("the morning prompt tells kemarin and asks only today's plan", () => {
    const fromCheckout = morningPromptText("2026-11-11", { from: "2026-11-10", yesterday: "Merge PR export invoice.", source: "checkout" });
    expect(fromCheckout).toContain("Kemarin (checkout 2026-11-10) kamu mengerjakan:\nMerge PR export invoice.");
    expect(fromCheckout.endsWith("Apa rencanamu hari ini?")).toBe(true);
    expect(fromCheckout).not.toContain("kendala");

    const fromGithub = morningPromptText("2026-11-11", { from: "2026-11-10", yesterday: "Fix login.", source: "github" });
    expect(fromGithub).toContain("Kemarin (dari aktivitas GitHub kamu sejak 2026-11-10):\nFix login.");
    expect(morningPromptText("2026-11-11")).toBe("Selamat pagi! Standup harian 2026-11-11 ☀️\nApa rencanamu hari ini?");
  });

  test("the checkout shows today's draft, or asks when there was no activity", () => {
    expect(checkoutPromptText("2026-11-11", "- Fix login")).toContain("Yang kamu kerjakan hari ini (dari aktivitas GitHub):\n- Fix login");
    expect(checkoutPromptText("2026-11-11", null)).toContain("Apa saja yang kamu kerjakan hari ini?");
  });

  test("additions join the work as list items when it is a list", () => {
    expect(appendWork("- Fix login", "meeting klien")).toBe("- Fix login\n- meeting klien");
    expect(appendWork("Fix login.", "Meeting klien.")).toBe("Fix login.\nMeeting klien.");
    expect(appendWork(undefined, "Meeting klien")).toBe("Meeting klien");
  });

  test("with only the plan open, an unlabelled multi-line reply is all plan", () => {
    expect(parseStandupText("lanjut testing\nreview PR", "today", ["today"])).toEqual({});
  });

  test("unlabelled lines fill the open questions, not the drafted kemarin", () => {
    expect(parseStandupText("lanjut testing\ntidak ada", "today", ["today", "blockers"])).toEqual({
      today: "lanjut testing",
      blockers: "tidak ada",
    });
  });
});
