import type { BriefingAudience } from "@repo/shared";

export type AgentItem = {
  type: string;
  title: string;
  url: string;
  source: string;
  summary: string;
  score: number;
  country?: string | null;
  budget?: string | null;
  pitch?: string | null;
};

const HEADINGS: Record<BriefingAudience, string> = {
  sales: "💼 Peluang & leads hari ini",
  design: "🎨 Tren UI/UX hari ini",
  dev: "💻 Berita developer hari ini",
};

// Shown on sales items; news items need no label.
const TYPE_LABEL: Record<string, string> = {
  lead: "Proyek",
  tender: "Tender",
  hiring: "Sinyal hiring",
  funding: "Baru dapat funding",
  upsell: "Upsell",
};

/** "23 Nov" from YYYY-MM-DD. */
function shortDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
}

// Items per WhatsApp message: 15 leads arrive as three short messages instead of one wall of text.
export const ITEMS_PER_MESSAGE = 5;

/**
 * WhatsApp messages for one audience, ITEMS_PER_MESSAGE items each: heading (with "1/3" when split),
 * numbered items, link last so previews stay off the text. Numbering runs on across messages.
 */
export function formatBriefing(audience: BriefingAudience, date: string, items: AgentItem[]): string[] {
  const parts = Math.max(1, Math.ceil(items.length / ITEMS_PER_MESSAGE));
  return Array.from({ length: parts }, (_, part) => {
    const page = parts > 1 ? ` ${part + 1}/${parts}` : "";
    const lines = [`*${HEADINGS[audience]}* (${shortDate(date)})${page}`];
    items.slice(part * ITEMS_PER_MESSAGE, (part + 1) * ITEMS_PER_MESSAGE).forEach((item, i) => {
      const meta = [TYPE_LABEL[item.type], item.source, item.country, item.budget].filter(Boolean).join(" · ");
      lines.push("", `${part * ITEMS_PER_MESSAGE + i + 1}. *${item.title}*`, `_${meta}_`, item.summary);
      if (item.pitch) lines.push(`💬 ${item.pitch}`);
      // Upsell ideas point at our own project (upsell://...), not a page to open.
      if (/^https?:\/\//.test(item.url)) lines.push(item.url);
    });
    if (part === parts - 1) lines.push("", "Silahkan di eksplor lebih lanjut.");
    return lines.join("\n");
  });
}
