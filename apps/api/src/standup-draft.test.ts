/** "Kemarin" drafted from GitHub activity by the workspace's AI. */
import { afterAll, describe, expect, test } from "bun:test";
import { activityLines, draftYesterday } from "./modules/standups/draft.js";
import { draftedPromptText, parseStandupText } from "./modules/standups/engine.js";

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

  test("a failing provider gives no draft", async () => {
    reply = "";
    expect(await draftYesterday(config, activity, "2026-11-10")).toBeNull();
  });

  test("the prompt shows the draft and asks only today and blockers", () => {
    const text = draftedPromptText("2026-11-11", "2026-11-10", "Merge PR export invoice.");
    expect(text).toContain("Kemarin (dari aktivitas GitHub kamu sejak 2026-11-10):\nMerge PR export invoice.");
    expect(text).toContain("1. Apa rencanamu hari ini?");
    expect(text).not.toContain("Apa yang kamu kerjakan kemarin?");
  });

  test("unlabelled lines fill the open questions, not the drafted kemarin", () => {
    expect(parseStandupText("lanjut testing\ntidak ada", "today", ["today", "blockers"])).toEqual({
      today: "lanjut testing",
      blockers: "tidak ada",
    });
  });
});
