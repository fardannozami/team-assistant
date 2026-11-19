/**
 * GitHub activity as standup context: which window a standup's "kemarin"
 * covers, and how to word what happened in it. Pure, so it is easy to test;
 * the query lives in service.ts (`standupActivity`).
 */
import { DEFAULT_TIMEZONE } from "@repo/shared";

export type StandupActivityItem = {
  type: string;
  title: string | null;
  url: string | null;
  repository: string | null;
  occurredAt: Date;
};

export type StandupActivity = {
  counts: Record<string, number>;
  items: StandupActivityItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const TYPE_LABEL: Record<string, string> = {
  commit: "commit",
  pr_opened: "PR dibuka",
  pr_reopened: "PR dibuka ulang",
  pr_ready: "PR siap review",
  pr_updated: "update PR",
  pr_merged: "PR di-merge",
  pr_closed: "PR ditutup",
  pr_reviewed: "review PR",
  pr_commented: "komentar PR",
  issue_opened: "issue dibuka",
  issue_reopened: "issue dibuka ulang",
  issue_closed: "issue ditutup",
  issue_commented: "komentar issue",
};

// Types worth naming one by one; the rest are only counted.
const LISTED_TYPES = new Set(["commit", "pr_opened", "pr_merged", "pr_reviewed", "issue_closed"]);

/** Offset of `tz` from UTC at `utcMs`, in ms. */
function offsetMs(utcMs: number, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return local - utcMs;
}

/** 00:00 of a YYYY-MM-DD date in `tz`. */
export function startOfDay(date: string, tz: string = DEFAULT_TIMEZONE) {
  const [y, m, d] = date.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d!);
  return new Date(utc - offsetMs(utc, tz));
}

/** The workday before `date` (Monday -> Friday), as YYYY-MM-DD. */
export function previousWorkday(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  let t = Date.UTC(y!, m! - 1, d!) - DAY_MS;
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * What a standup on `date` reports as "kemarin": from the start of the
 * previous workday up to the start of `date`, so Monday covers Friday and
 * the weekend.
 */
export function standupWindow(date: string, tz: string = DEFAULT_TIMEZONE) {
  const from = previousWorkday(date);
  return { from, since: startOfDay(from, tz), until: startOfDay(date, tz) };
}

/** "3 commit, 1 PR di-merge", most frequent first. */
export function describeCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${n} ${TYPE_LABEL[type] ?? type}`)
    .join(", ");
}

/** Notable titles, oldest first and without repeats. */
export function notableItems(items: StandupActivityItem[], max = 5) {
  const seen = new Set<string>();
  const picked: StandupActivityItem[] = [];
  for (const item of [...items].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    if (!LISTED_TYPES.has(item.type) || !item.title || seen.has(item.title)) continue;
    seen.add(item.title);
    picked.push(item);
  }
  return { shown: picked.slice(0, max), more: Math.max(picked.length - max, 0) };
}

/** The latest `max` commits, newest first, with the short hash from the commit URL. */
export function recentCommits(items: StandupActivityItem[], max = 3) {
  return items
    .filter((i) => i.type === "commit")
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, max)
    .map((i) => ({
      hash: i.url?.match(/\/commit\/([0-9a-f]{7,40})/i)?.[1]?.slice(0, 7) ?? null,
      title: i.title,
      url: i.url,
      repository: i.repository,
      occurredAt: i.occurredAt,
    }));
}

/** Block for the WhatsApp prompt, or null when there is nothing to show. */
export function activityHint(activity: StandupActivity | undefined, from: string) {
  if (!activity?.items.length) return null;
  const { shown, more } = notableItems(activity.items);
  return [
    `Aktivitas GitHub kamu sejak ${from}: ${describeCounts(activity.counts)}.`,
    ...shown.map((i) => `- ${i.title}${i.repository ? ` (${i.repository})` : ""}`),
    ...(more ? [`- dan ${more} lainnya`] : []),
  ].join("\n");
}
