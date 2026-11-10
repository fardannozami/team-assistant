import {
  CORE_STANDUP_ELEMENTS,
  dateInTimezone,
  type StandupElement,
} from "@repo/shared";
import { and, eq } from "drizzle-orm";
import { createDbClient, standupAnswers, standupSessions, standups } from "@repo/database";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const ELEMENT_KEYWORDS: Record<StandupElement, RegExp[]> = {
  yesterday: [/\byesterday\b/i, /\bkemarin\b/i, /\bkemaren\b/i],
  today: [
    /\btoday\b/i,
    /\bhari ini\b/i,
    /\bplanning\b/i,
    /\bplan\b/i,
    /\brencana\b/i,
    /\bakan\b/i,
    /\bsekarang\b/i,
  ],
  blockers: [
    /\bblockers?\b/i,
    /\bblocked\b/i,
    /\bkendala\b/i,
    /\bhambatan\b/i,
    /\bmasalah\b/i,
    /\bterhambat\b/i,
    /\bissues?\b/i,
    /\bproblems?\b/i,
  ],
};

const NO_BLOCKER =
  /^(tidak\s+ada(\s+(kendala|blocker|masalah))?|ga[k]?\s+ada(\s+(kendala|blocker))?|nggak\s+ada(\s+(kendala|blocker))?|none|no\s+blockers?|nothing|belum\s+ada|aman|lancar)\.?$/i;

export const STANDUP_QUESTIONS: Record<StandupElement, string> = {
  yesterday: "Apa yang kamu kerjakan kemarin?",
  today: "Apa rencanamu hari ini?",
  blockers: "Ada kendala atau blocker? (balas 'tidak ada' jika aman)",
};

export function standupPromptText(date: string): string {
  return [
    `Standup harian untuk ${date}:`,
    `1. ${STANDUP_QUESTIONS.yesterday}`,
    `2. ${STANDUP_QUESTIONS.today}`,
    `3. ${STANDUP_QUESTIONS.blockers}`,
    "Balas dalam satu pesan atau beberapa pesan - jawabanmu akan saya catat.",
  ].join("\n");
}

export function standupReminderText(date: string): string {
  return [
    `Pengingat: kamu belum mengirim standup untuk ${date}.`,
    `${STANDUP_QUESTIONS.yesterday}`,
    `${STANDUP_QUESTIONS.today}`,
    `${STANDUP_QUESTIONS.blockers}`,
  ].join("\n");
}

function parseStandupText(
  text: string,
): Partial<Record<StandupElement, string>> {
  const marks: { index: number; end: number; element: StandupElement }[] = [];

  for (const [element, patterns] of Object.entries(ELEMENT_KEYWORDS) as [
    StandupElement,
    RegExp[],
  ][]) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match.index !== undefined) {
        marks.push({
          index: match.index,
          end: match.index + match[0].length,
          element,
        });
      }
    }
  }

  marks.sort((a, b) => a.index - b.index);

  const parsed: Partial<Record<StandupElement, string>> = {};

  // Line-based fallback: if the user sends 2-3 separate lines without
  // explicit keywords, treat them as yesterday / today / blockers in order.
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (marks.length === 0 && lines.length >= 2) {
    if (lines[0]) parsed.yesterday = lines[0];
    if (lines[1]) parsed.today = lines[1];
    if (lines[2]) parsed.blockers = lines[2];
    return parsed;
  }
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
    if (!value && element === "blockers" && NO_BLOCKER.test(text)) {
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

export async function getStandupSession(employeeId: string, date: string) {
  const [session] = await db
    .select()
    .from(standupSessions)
    .where(
      and(
        eq(standupSessions.employeeId, employeeId),
        eq(standupSessions.date, date),
      ),
    )
    .limit(1);
  return session ?? null;
}

async function getOrCreateStandupRow(
  sessionId: string,
  employeeId: string,
  date: string,
) {
  const [existing] = await db
    .select()
    .from(standups)
    .where(
      and(eq(standups.employeeId, employeeId), eq(standups.date, date)),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(standups)
    .values({ sessionId, employeeId, date })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [raced] = await db
    .select()
    .from(standups)
    .where(
      and(eq(standups.employeeId, employeeId), eq(standups.date, date)),
    )
    .limit(1);
  if (!raced) throw new Error("Failed to load standup row");
  return raced;
}

async function getAnswers(standupId: string) {
  return db
    .select({
      questionKey: standupAnswers.questionKey,
      answer: standupAnswers.answer,
    })
    .from(standupAnswers)
    .where(eq(standupAnswers.standupId, standupId));
}

async function upsertAnswer(
  standupId: string,
  questionKey: StandupElement,
  answer: string,
) {
  await db
    .insert(standupAnswers)
    .values({ standupId, questionKey, answer })
    .onConflictDoUpdate({
      target: [standupAnswers.standupId, standupAnswers.questionKey],
      set: { answer },
    });
}

async function setSessionStatus(sessionId: string, status: string) {
  await db
    .update(standupSessions)
    .set({ status, updatedAt: new Date() })
    .where(eq(standupSessions.id, sessionId));
}

export type StandupCollector = {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
};

/**
 * Collects an inbound WhatsApp message into the employee's open standup
 * session for today. Returns the reply text, or null when the employee has
 * no open session (the message is not a standup answer).
 */
export async function handleStandupMessage(args: {
  employee: StandupCollector;
  body: string;
  date?: string;
}): Promise<string | null> {
  const text = args.body.trim();
  if (!text || !args.employee.isActive) return null;

  const date = args.date ?? dateInTimezone();
  const session = await getStandupSession(args.employee.id, date);
  if (!session) return null;
  if (session.status === "completed") {
    return `Standup untuk ${date} sudah tercatat. Terima kasih 😊`;
  }

  const standupRow = await getOrCreateStandupRow(
    session.id,
    args.employee.id,
    date,
  );

  const answers = await getAnswers(standupRow.id);
  const answered = new Set(answers.map((a) => a.questionKey));
  const missing = CORE_STANDUP_ELEMENTS.filter((key) => !answered.has(key));
  if (missing.length === 0) return null;

  let parsed = parseStandupText(text);
  if (Object.keys(parsed).length === 0) {
    // Free-form reply to the question we asked last: file it there.
    parsed = { [missing[0]!]: text };
  }

  for (const [key, value] of Object.entries(parsed) as [
    StandupElement,
    string,
  ][]) {
    const normalized =
      key === "blockers" && NO_BLOCKER.test(value) ? "none" : value;
    await upsertAnswer(standupRow.id, key, normalized);
    answered.add(key);
  }

  if (session.status === "pending") {
    await setSessionStatus(session.id, "in_progress");
  }

  const stillMissing = CORE_STANDUP_ELEMENTS.filter(
    (key) => !answered.has(key),
  );

  if (stillMissing.length === 0) {
    await setSessionStatus(session.id, "completed");
    const final = await getAnswers(standupRow.id);
    const answerFor = (key: StandupElement) =>
      final.find((a) => a.questionKey === key)?.answer ?? "-";
    return [
      `Standup tercatat untuk ${date}.`,
      `Kemarin: ${answerFor("yesterday")}`,
      `Hari ini: ${answerFor("today")}`,
      `Kendala: ${answerFor("blockers")}`,
      "Terima kasih 😊",
    ].join("\n");
  }

  const got = CORE_STANDUP_ELEMENTS.filter((key) => answered.has(key));
  const gotLabel = got
    .map((key) => (key === "yesterday" ? "kemarin" : key === "today" ? "hari ini" : "kendala"))
    .join(" dan ");
  const gotPrefix = got.length ? `Diterima ${gotLabel}. ` : "";
  return `${gotPrefix}${STANDUP_QUESTIONS[stillMissing[0]!]}`;
}
