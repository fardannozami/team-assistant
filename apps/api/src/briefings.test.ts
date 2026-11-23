/**
 * Pre-standup briefings: who gets which briefing, and the WhatsApp message.
 */
import { describe, expect, test } from "bun:test";
import { briefingAudienceFor } from "@repo/shared";
import { formatBriefing } from "./modules/briefings/format.js";

describe("briefing audiences", () => {
  test("positions map to one briefing each; no position, no briefing", () => {
    expect(briefingAudienceFor("pm_sales")).toBe("sales");
    expect(briefingAudienceFor("design")).toBe("design");
    expect(briefingAudienceFor("designer")).toBe("design");
    expect(briefingAudienceFor("development")).toBe("dev");
    expect(briefingAudienceFor("developer")).toBe("dev");
    expect(briefingAudienceFor(null)).toBeNull();
    expect(briefingAudienceFor("hr")).toBeNull();
  });
});

describe("briefing message", () => {
  test("numbered items with source, summary, optional pitch and the link last", () => {
    const text = formatBriefing("sales", "2026-11-23", [
      {
        type: "lead",
        title: "Redesign SaaS dashboard",
        url: "https://example.com/job/1",
        source: "We Work Remotely",
        summary: "Startup US cari agensi untuk redesign.",
        score: 90,
        country: "US",
        budget: "$5k",
        pitch: "Kami baru selesai dashboard serupa.",
      },
      { type: "news", title: "Bun 2.0", url: "https://bun.sh/blog", source: "Bun releases", summary: "Rilis besar.", score: 70 },
    ])[0]!;
    expect(text.split("\n")[0]).toBe("*💼 Peluang & leads hari ini* (23 Nov)");
    expect(text).toContain("1. *Redesign SaaS dashboard*\n_Proyek · We Work Remotely · US · $5k_\nStartup US cari agensi untuk redesign.\n💬 Kami baru selesai dashboard serupa.\nhttps://example.com/job/1");
    expect(text).toContain("2. *Bun 2.0*\n_Bun releases_\nRilis besar.\nhttps://bun.sh/blog");
  });

  test("upsell ideas carry no link: they point at our own project", () => {
    const text = formatBriefing("sales", "2026-11-23", [
      { type: "upsell", title: "Acme landing (Upwork)", url: "upsell://project/p1/2026-11", source: "Proyek kita", summary: "Tawarkan maintenance.", score: 60, pitch: "Tawarkan paket bulanan." },
    ])[0]!;
    expect(text).toContain("_Upsell · Proyek kita_\nTawarkan maintenance.\n💬 Tawarkan paket bulanan.\n\nSilahkan di eksplor lebih lanjut.");
    expect(text).not.toContain("upsell://");
  });

  test("15 leads become three messages of five, numbered on, closing line only at the end", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      type: "lead", title: `Lead ${i + 1}`, url: `https://example.com/${i + 1}`, source: "Upwork (search)", summary: "s", score: 90 - i,
    }));
    const messages = formatBriefing("sales", "2026-11-23", items);
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.split("\n")[0])).toEqual([
      "*💼 Peluang & leads hari ini* (23 Nov) 1/3",
      "*💼 Peluang & leads hari ini* (23 Nov) 2/3",
      "*💼 Peluang & leads hari ini* (23 Nov) 3/3",
    ]);
    expect(messages[1]).toContain("6. *Lead 6*");
    expect(messages[1]).toContain("10. *Lead 10*");
    expect(messages[1]).not.toContain("11. ");
    expect(messages.filter((m) => m.includes("Silahkan di eksplor"))).toEqual([messages[2]!]);
    expect(formatBriefing("dev", "2026-11-23", items.slice(0, 5))).toHaveLength(1);
  });
});
