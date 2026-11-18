const DAY_INDEX: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_WORDS: { pattern: string; day: number }[] = [
  { pattern: "sunday|sun|minggu", day: 0 },
  { pattern: "monday|mon|senin", day: 1 },
  { pattern: "tuesday|tue|selasa", day: 2 },
  { pattern: "wednesday|wed|rabu", day: 3 },
  { pattern: "thursday|thu|kamis", day: 4 },
  { pattern: "friday|fri|jumat|jum'at", day: 5 },
  { pattern: "saturday|sat|sabtu", day: 6 },
];

export const DAY_PATTERN = DAY_WORDS.map((d) => `(?:${d.pattern})`).join("|");
export const DAY_RANGE_RE = new RegExp(
  `\\b(${DAY_PATTERN})\\b\\s*(?:to|through|thru|sampai|-|–)\\s*\\b(${DAY_PATTERN})\\b`,
  "i",
);

export function dayFromToken(token: string): number | null {
  const normalized = token.trim().toLowerCase();
  for (const { pattern, day } of DAY_WORDS) {
    if (new RegExp(`^(?:${pattern})$`).test(normalized)) return day;
  }
  return null;
}

/** Parses SET SCHEDULE day tokens: "MON TUE", "MON-FRI", DAILY, WEEKDAYS. */
export function parseWeekdays(input: string): number[] | null {
  const token = input.trim().toUpperCase();
  if (!token) return null;

  if (/^(DAILY|EVERYDAY|EVERY DAY)$/.test(token)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^(WEEKDAYS?|WORKDAYS?)$/.test(token)) return [1, 2, 3, 4, 5];

  const days = new Set<number>();
  for (const part of token.split(/[\s,]+/).filter(Boolean)) {
    const range = part.match(/^([A-Z]{3})-([A-Z]{3})$/);
    if (range) {
      const start = DAY_INDEX[range[1]!];
      const end = DAY_INDEX[range[2]!];
      if (start === undefined || end === undefined) return null;
      let cursor = start;
      days.add(cursor);
      while (cursor !== end) {
        cursor = (cursor + 1) % 7;
        days.add(cursor);
      }
      continue;
    }
    const day = DAY_INDEX[part];
    if (day === undefined) return null;
    days.add(day);
  }
  return days.size ? [...days].sort((a, b) => a - b) : null;
}

export function formatWeekdays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join(",") === "1,2,3,4,5") return "Mon-Fri";
  if (sorted.join(",") === "0,1,2,3,4,5,6") return "every day";
  return sorted.map((day) => DAY_NAMES[day]).join(", ");
}
