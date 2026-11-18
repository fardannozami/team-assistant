import { CORE_STANDUP_ELEMENTS, isNoBlocker, type StandupElement } from "@repo/shared";

// Everyday words ("akan", "sekarang", "issue", ...) only label a part when
// they open a line or carry a colon; mid-sentence they are just words:
// "Fix issue #12" is not a blocker.
const label = (word: string) => new RegExp(`(?:^|\\n)[ \\t]*(?:${word})\\b|\\b(?:${word})[ \\t]*:`, "i");

const ELEMENT_KEYWORDS: Record<StandupElement, RegExp[]> = {
  yesterday: [/\byesterday\b/i, /\bkemarin\b/i, /\bkemaren\b/i],
  today: [
    /\btoday\b/i,
    /\bhari ini\b/i,
    label("planning"),
    label("plan"),
    /\brencana\b/i,
    label("akan"),
    label("sekarang"),
  ],
  blockers: [
    /\bblockers?\b/i,
    /\bblocked\b/i,
    /\bkendala\b/i,
    /\bhambatan\b/i,
    label("masalah"),
    /\bterhambat\b/i,
    label("issues?"),
    label("problems?"),
    // "... dan tidak ada masalah" still answers the blocker question.
    /(?<=\b(?:tidak|tdk|ga|gak|nggak|ngga|enggak|belum)\s+ada\s+)(?:masalah|issues?|problems?)\b/i,
  ],
};

// Negation right before a blocker keyword ("... dan tidak ada kendala").
const NEGATED_BLOCKER_PREFIX =
  /(?:[,;]?\s*(?:dan|tapi|terus)\s+)?(?:tidak|tdk|ga|gak|nggak|ngga|enggak|belum)\s+ada\s+$/i;

type Mark = {
  index: number;
  end: number;
  element: StandupElement;
  negated?: boolean;
};

/** Where each part's label sits in the text, in order. */
function findMarks(text: string): Mark[] {
  const marks: Mark[] = [];
  for (const [element, patterns] of Object.entries(ELEMENT_KEYWORDS) as [
    StandupElement,
    RegExp[],
  ][]) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match.index !== undefined) {
        const negation =
          element === "blockers"
            ? text.slice(0, match.index).match(NEGATED_BLOCKER_PREFIX)
            : null;
        marks.push({
          index: match.index - (negation?.[0].length ?? 0),
          end: match.index + match[0].length,
          element,
          negated: !!negation,
        });
      }
    }
  }
  return marks.sort((a, b) => a.index - b.index);
}

/**
 * Splits a reply into its labelled parts. `lead` is the part the bot just
 * asked for: unlabelled text before the first label belongs to it, so
 * "Selesai modul invoice, hari ini testing" keeps its first half. Unlabelled
 * lines fill `open` in turn, so a drafted "kemarin" is not overwritten.
 */
export function parseStandupText(
  text: string,
  lead?: StandupElement,
  open: readonly StandupElement[] = CORE_STANDUP_ELEMENTS,
): Partial<Record<StandupElement, string>> {
  const marks = findMarks(text);
  const parsed: Partial<Record<StandupElement, string>> = {};

  // Line-based fallback: if the user sends 2-3 separate lines without
  // explicit keywords, treat them as the open parts in order.
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (marks.length === 0 && lines.length >= 2) {
    open.forEach((key, i) => {
      if (lines[i]) parsed[key] = lines[i];
    });
    return parsed;
  }
  const leading = marks.length && lead
    ? text.slice(0, marks[0]!.index).replace(/[\s,;:\-]+$/, "").trim()
    : "";
  if (leading && lead) parsed[lead] = leading;

  for (let i = 0; i < marks.length; i++) {
    const start = marks[i]!.end;
    const stop = i + 1 < marks.length ? marks[i + 1]!.index : text.length;
    const element = marks[i]!.element;
    const rawValue = text
      .slice(start, stop)
      .replace(/^[\s:,\-]+/, "")
      .replace(/[\s,;]+$/, "")
      .trim();
    let value = rawValue;
    if (
      element === "blockers" &&
      (marks[i]!.negated || (!value && isNoBlocker(text)))
    ) {
      value = "none";
    }
    if (!value) continue;
    parsed[element] = parsed[element] ? `${parsed[element]} ${value}` : value;
  }
  // If a blocker keyword was found but no answer text followed it, treat
  // phrases like "tidak ada blocker" as an explicit "none".
  if (!parsed.blockers && /blocker/i.test(text) && /tidak\s+ada/i.test(text)) {
    parsed.blockers = "none";
  }
  return parsed;
}
