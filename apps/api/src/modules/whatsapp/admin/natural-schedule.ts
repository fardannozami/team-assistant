import { DAY_PATTERN, DAY_RANGE_RE, dayFromToken, formatWeekdays } from "./days.js";

export type NaturalSchedule = { timeOfDay: string; weekdays: number[]; timezone?: string };

function parseNaturalTime(text: string): string | null {
  const withMinutes = text.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i);
  if (withMinutes) {
    let hour = Number(withMinutes[1]);
    const minute = Number(withMinutes[2]);
    const suffix = withMinutes[3]?.toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const hourOnly = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (hourOnly) {
    let hour = Number(hourOnly[1]);
    const suffix = hourOnly[2]?.toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour <= 23) return `${String(hour).padStart(2, "0")}:00`;
  }

  return null;
}

const NATURAL_SCHEDULE_VERB =
  /\b(set|atur|aturkan|jadwalkan|ubah|ganti|pindah(?:kan)?|schedule|change|move)\b/i;
const NATURAL_QUESTION =
  /\?|^\s*(kenapa|mengapa|apa|apakah|kapan|bagaimana|gimana|why|what|when|how|is|does|did)\b/i;
const NOT_SUNDAY = /\b(?:(?:se|per|tiap|setiap)\s*minggu|minggu\s+(?:ini|depan|lalu|kemarin))\b/gi;

/**
 * Keeps only times that read as times: "09:00", "jam 9.30", "9.30 am".
 * A bare "10.12" is more likely a date than 10:12, so it is dropped.
 */
function naturalTimeText(text: string): string {
  return text.replace(/(\b(?:jam|pukul|at)\s*)?\b(\d{1,2})\.(\d{2})\b(\s*(?:am|pm))?/gi, (match, lead, _h, _m, suffix) =>
    lead || suffix ? match.replace(".", ":") : " ",
  );
}

export function scheduleConfirmation(schedule: NaturalSchedule) {
  const tz = schedule.timezone ? ` (${schedule.timezone})` : "";
  return `Saya akan mengubah jadwal standup menjadi ${formatWeekdays(schedule.weekdays)} pukul ${schedule.timeOfDay}${tz}. Sudah benar? Balas YA atau TIDAK.`;
}

function naturalWeekdays(text: string): number[] {
  const range = text.match(DAY_RANGE_RE);
  if (range) {
    const start = range[1] ? dayFromToken(range[1]) : null;
    const end = range[2] ? dayFromToken(range[2]) : null;
    if (start === null || end === null) return [];
    const days = new Set<number>([start]);
    let cursor = start;
    while (cursor !== end) {
      cursor = (cursor + 1) % 7;
      days.add(cursor);
    }
    return [...days].sort((a, b) => a - b);
  }
  if (/\b(every\s*day|daily|setiap hari|tiap hari)\b/i.test(text)) {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  const found = new Set<number>();
  const dayRe = new RegExp(`\\b(${DAY_PATTERN})\\b`, "gi");
  for (const match of text.matchAll(dayRe)) {
    const day = match[1] ? dayFromToken(match[1]) : null;
    if (day !== null) found.add(day);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Narrow natural-language schedule parsing (PRD §5.4 example):
 * "Schedule standup from Monday to Friday at 9:00 AM WIB".
 * The M7 agent replaces this with full LLM understanding.
 */
export function parseNaturalSchedule(input: string): NaturalSchedule | null {
  if (!/\b(standup|jadwal)\b/i.test(input)) return null;
  // Only instructions ("atur standup senin-jumat jam 09:00"), not questions
  // or remarks that happen to mention a day and a time.
  if (!NATURAL_SCHEDULE_VERB.test(input) || NATURAL_QUESTION.test(input)) return null;
  // "minggu ini/depan", "per minggu" mean "week", not Sunday.
  const text = input.replace(NOT_SUNDAY, " ");

  const timeOfDay = parseNaturalTime(naturalTimeText(text));
  if (!timeOfDay) return null;

  const weekdays = naturalWeekdays(text);
  if (weekdays.length === 0) return null;

  const timezone = /\bWIB\b|\bAsia\/Jakarta\b/i.test(text)
    ? "Asia/Jakarta"
    : /\bWITA\b/i.test(text)
      ? "Asia/Makassar"
      : /\bWIT\b/i.test(text)
        ? "Asia/Jayapura"
        : undefined;

  return { timeOfDay, weekdays, timezone };
}
