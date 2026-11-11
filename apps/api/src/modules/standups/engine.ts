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

// Negation right before a blocker keyword ("... dan tidak ada kendala").
const NEGATED_BLOCKER_PREFIX =
  /(?:[,;]?\s*(?:dan|tapi|terus)\s+)?(?:tidak|tdk|ga|gak|nggak|ngga|enggak|belum)\s+ada\s+$/i;

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

/** Asks only for the answers still missing (all three by default). */
export function standupReminderText(
  date: string,
  missing: readonly StandupElement[] = CORE_STANDUP_ELEMENTS,
): string {
  const partial = missing.length < CORE_STANDUP_ELEMENTS.length;
  return [
    partial
      ? `Pengingat: standup ${date} kamu belum lengkap.`
      : `Pengingat: kamu belum mengirim standup untuk ${date}.`,
    ...missing.map((key) => STANDUP_QUESTIONS[key]),
  ].join("\n");
}

export function parseStandupText(
  text: string,
): Partial<Record<StandupElement, string>> {
  const marks: {
    index: number;
    end: number;
    element: StandupElement;
    negated?: boolean;
  }[] = [];

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
    if (
      element === "blockers" &&
      (marks[i]!.negated || (!value && NO_BLOCKER.test(text)))
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
  workspaceId: string,
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
    .values({ workspaceId, sessionId, employeeId, date })
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
  workspaceId: string;
  name: string;
  phone: string;
  isActive: boolean;
};

const STANDUP_COMMAND = /^standup\b[\s:,.-]*/i;
const EDIT_COMMAND = /^(?:ubah|edit|update|ganti|revisi)\s+standup\b[\s:,.-]*/i;
const HELP_COMMAND = /^(?:bantuan|help|menu)$/i;
const ELEMENT_LABEL: Record<StandupElement, string> = {
  yesterday: "Kemarin",
  today: "Hari ini",
  blockers: "Kendala",
};

export const EMPLOYEE_MENU = [
  "Perintah standup:",
  "STANDUP - mulai atau lanjutkan standup hari ini",
  "STANDUP kemarin: ... hari ini: ... kendala: ... - isi sekaligus",
  "UBAH STANDUP kendala: ... - ubah jawaban yang sudah terkirim",
  "BANTUAN - tampilkan pesan ini",
].join("\n");

const EDIT_HINT = "Untuk mengubah, kirim UBAH STANDUP diikuti bagiannya, contoh: UBAH STANDUP kendala: menunggu akses server";

function summarize(date: string, title: string, answers: { questionKey: string; answer: string }[]) {
  const answerFor = (key: StandupElement) =>
    answers.find((a) => a.questionKey === key)?.answer ?? "-";
  return [
    `${title} ${date}.`,
    ...CORE_STANDUP_ELEMENTS.map((key) => `${ELEMENT_LABEL[key]}: ${answerFor(key)}`),
  ].join("\n");
}

/**
 * Standup messages from employees. With an open session (after a prompt or
 * STANDUP), any message is an answer. Otherwise only the keywords above touch
 * the standup, so everything else can go to admin commands or the AI agent.
 * Returns null when the message is not for the standup.
 */
export async function handleStandupMessage(args: {
  employee: StandupCollector;
  body: string;
  date?: string;
}): Promise<string | null> {
  const text = args.body.trim();
  if (!text || !args.employee.isActive) return null;

  const date = args.date ?? dateInTimezone();
  if (HELP_COMMAND.test(text)) return EMPLOYEE_MENU;

  const edit = text.match(EDIT_COMMAND);
  if (edit) return editStandup(args.employee, date, text.slice(edit[0].length));

  const start = text.match(STANDUP_COMMAND);
  if (start) return startStandup(args.employee, date, text.slice(start[0].length));

  const session = await getStandupSession(args.employee.id, date);
  if (!session || session.status === "completed" || session.status === "missed") return null;
  return recordAnswers(args.employee, session, date, text);
}

function closedText(date: string) {
  return `Standup ${date} sudah ditutup, jawaban tidak bisa dicatat lagi. Sampai jumpa di standup berikutnya!`;
}

/** STANDUP: opens today's session on demand, then records any answers sent with it. */
async function startStandup(employee: StandupCollector, date: string, rest: string) {
  let session = await getStandupSession(employee.id, date);
  if (!session) {
    await db
      .insert(standupSessions)
      .values({ workspaceId: employee.workspaceId, employeeId: employee.id, date, status: "pending" })
      .onConflictDoNothing();
    session = await getStandupSession(employee.id, date);
    if (!session) return "Standup belum bisa dimulai. Coba lagi sebentar.";
  }

  if (session.status === "missed") return closedText(date);
  if (session.status === "completed") {
    const row = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);
    return `${summarize(date, "Standup kamu sudah tercatat untuk", await getAnswers(row.id))}\n${EDIT_HINT}`;
  }
  if (rest) return recordAnswers(employee, session, date, rest);

  const row = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);
  const answered = new Set((await getAnswers(row.id)).map((a) => a.questionKey));
  const missing = CORE_STANDUP_ELEMENTS.filter((key) => !answered.has(key));
  if (missing.length === CORE_STANDUP_ELEMENTS.length) return standupPromptText(date);
  return `Lanjutkan standup ${date}: ${STANDUP_QUESTIONS[missing[0]!]}`;
}

/** UBAH STANDUP: changes only the labelled parts of today's answers. */
async function editStandup(employee: StandupCollector, date: string, rest: string) {
  const session = await getStandupSession(employee.id, date);
  if (!session) return `Belum ada standup untuk ${date}. Kirim STANDUP untuk mulai.`;
  if (session.status === "missed") return closedText(date);
  if (session.status !== "completed") {
    return rest ? recordAnswers(employee, session, date, rest) : `Standup ${date} belum selesai. ${STANDUP_QUESTIONS.yesterday}`;
  }

  const parsed = parseStandupText(rest);
  if (Object.keys(parsed).length === 0) return EDIT_HINT;

  const row = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);
  for (const [key, value] of Object.entries(parsed) as [StandupElement, string][]) {
    const normalized = key === "blockers" && NO_BLOCKER.test(value) ? "none" : value;
    await upsertAnswer(row.id, key, normalized);
  }
  return `${summarize(date, "Standup diperbarui untuk", await getAnswers(row.id))} 😊`;
}

/** Files a message into an open session and asks for whatever is still missing. */
async function recordAnswers(
  employee: StandupCollector,
  session: { id: string; status: string },
  date: string,
  text: string,
) {
  const standupRow = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);

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
    return [
      summarize(date, "Standup tercatat untuk", await getAnswers(standupRow.id)),
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
