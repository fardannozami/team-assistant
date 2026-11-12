import {
  MOOD_EMOJI,
  dateInTimezone,
  parseMoodScore,
  type CheckinKind,
  type CheckinQuestion,
} from "@repo/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  checkinAnswers,
  checkinConfigs,
  checkinSessions,
  createDbClient,
} from "@repo/database";
import { getStandupSession } from "../standups/engine.js";
import { CHECKIN_LABEL } from "./defaults.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const OPEN_STATUSES = ["pending", "in_progress"];
const SKIP = /^(-+|lewati|lewat|skip|tidak ada|ga ada|gak ada|nggak ada|none)$/i;

// Alone or followed by ":" ("MOOD", "mood: 4"), so answers like "mood tim
// lagi turun" stay answers.
const KEYWORDS: { kind: CheckinKind; re: RegExp }[] = [
  { kind: "checkout", re: /^check[\s-]?out(?:\s*:\s*|\s*$)/i },
  { kind: "icebreaker", re: /^(?:mood|ice[\s-]?break(?:ing|er)?)(?:\s*:\s*|\s*$)/i },
];
// Standup keywords keep working while a check-in is open.
const STANDUP_KEYWORDS = /^(?:(?:ubah|edit|update|ganti|revisi)\s+)?standup\b|^(?:bantuan|help|menu)$/i;

export const MOOD_SCALE = MOOD_EMOJI.map((e, i) => `${i + 1} ${e}`).join("  ");

export function questionText(question: CheckinQuestion, index: number, total: number) {
  const counter = total > 1 ? `(${index + 1}/${total}) ` : "";
  const scale = question.type === "mood" ? `\nBalas 1–5: ${MOOD_SCALE}` : "";
  return `${counter}${question.text}${scale}`;
}

export function checkinPromptText(
  kind: CheckinKind,
  args: { name: string; questions: CheckinQuestion[]; motivation?: string | null },
) {
  const first = questionText(args.questions[0]!, 0, args.questions.length);
  if (kind === "icebreaker") {
    return [
      `Selamat pagi ${args.name}! ☀️ Selamat datang di minggu baru.`,
      ...(args.motivation ? ["", `💬 ${args.motivation}`] : []),
      "",
      first,
    ].join("\n");
  }
  return [
    `Halo ${args.name}! Waktunya check-out mingguan 🏁`,
    `Ada ${args.questions.length} pertanyaan singkat untuk menutup minggu ini.`,
    "",
    first,
  ].join("\n");
}

export function checkinReminderText(kind: CheckinKind, questions: CheckinQuestion[], nextIndex: number) {
  return [
    `Pengingat: ${CHECKIN_LABEL[kind].toLowerCase()} kamu belum selesai.`,
    "",
    questionText(questions[nextIndex]!, nextIndex, questions.length),
  ].join("\n");
}

function displayAnswer(question: CheckinQuestion, answer: string | undefined) {
  if (!answer) return "-";
  if (question.type !== "mood") return answer;
  const score = parseMoodScore(answer);
  return score ? `${score} ${MOOD_EMOJI[score - 1]}` : answer;
}

export function checkinSummaryText(
  kind: CheckinKind,
  questions: CheckinQuestion[],
  answers: Map<string, string>,
) {
  return [
    `${CHECKIN_LABEL[kind]} tercatat ✅`,
    ...questions.map((q) => `• ${q.text}\n  ${displayAnswer(q, answers.get(q.key))}`),
  ].join("\n");
}

type Session = typeof checkinSessions.$inferSelect;

export async function getCheckinAnswers(sessionId: string) {
  const rows = await db
    .select({ questionKey: checkinAnswers.questionKey, answer: checkinAnswers.answer })
    .from(checkinAnswers)
    .where(eq(checkinAnswers.sessionId, sessionId));
  return new Map(rows.map((r) => [r.questionKey, r.answer]));
}

/** Index of the first unanswered question, or -1 when all are answered. */
export function nextQuestionIndex(questions: CheckinQuestion[], answers: Map<string, string>) {
  return questions.findIndex((q) => !answers.has(q.key));
}

export type CheckinCollector = { id: string; workspaceId: string; isActive: boolean };

/**
 * Check-out / ice breaker replies from employees. CHECKOUT and MOOD always
 * reach the latest session of that kind; plain text only goes to a session
 * prompted today that is newer than any open standup, so a standup prompt
 * sent later takes over the conversation. Returns null when not for us.
 */
export async function handleCheckinMessage(args: {
  employee: CheckinCollector;
  body: string;
}): Promise<string | null> {
  const text = args.body.trim();
  if (!text || !args.employee.isActive) return null;

  for (const { kind, re } of KEYWORDS) {
    const match = text.match(re);
    if (!match) continue;
    const [session] = await db
      .select()
      .from(checkinSessions)
      .where(and(eq(checkinSessions.employeeId, args.employee.id), eq(checkinSessions.kind, kind)))
      .orderBy(desc(checkinSessions.date))
      .limit(1);
    if (!session) return `Belum ada ${CHECKIN_LABEL[kind].toLowerCase()} untukmu. Tunggu jadwal berikutnya ya.`;
    return continueSession(session, text.slice(match[0].length));
  }

  if (STANDUP_KEYWORDS.test(text)) return null;

  const [open] = await db
    .select({ session: checkinSessions, timezone: checkinConfigs.timezone })
    .from(checkinSessions)
    .innerJoin(checkinConfigs, eq(checkinSessions.configId, checkinConfigs.id))
    .where(
      and(
        eq(checkinSessions.employeeId, args.employee.id),
        inArray(checkinSessions.status, OPEN_STATUSES),
      ),
    )
    .orderBy(desc(checkinSessions.createdAt))
    .limit(1);
  if (!open) return null;

  const today = dateInTimezone(open.timezone);
  if (open.session.date !== today) return null;

  const standup = await getStandupSession(args.employee.id, today);
  if (
    standup &&
    OPEN_STATUSES.includes(standup.status) &&
    standup.createdAt > open.session.createdAt
  ) {
    return null;
  }

  return recordAnswer(open.session, text);
}

async function continueSession(session: Session, rest: string) {
  const kind = session.kind as CheckinKind;
  const questions = session.questions as CheckinQuestion[];
  if (session.status === "missed") {
    return `${CHECKIN_LABEL[kind]} ${session.date} sudah ditutup. Sampai jumpa di jadwal berikutnya!`;
  }
  const answers = await getCheckinAnswers(session.id);
  if (session.status === "completed") return checkinSummaryText(kind, questions, answers);
  if (rest) return recordAnswer(session, rest);
  const next = nextQuestionIndex(questions, answers);
  return questionText(questions[next]!, next, questions.length);
}

/** Files the reply under the current question and asks the next one. */
async function recordAnswer(session: Session, text: string) {
  const kind = session.kind as CheckinKind;
  const questions = session.questions as CheckinQuestion[];
  const answers = await getCheckinAnswers(session.id);
  const index = nextQuestionIndex(questions, answers);
  if (index === -1) return null;
  const question = questions[index]!;

  if (question.type === "mood" && parseMoodScore(text) === null) {
    return `Balas dengan angka 1–5 ya: ${MOOD_SCALE}`;
  }
  const answer = question.type === "text" && SKIP.test(text) ? "-" : text;

  await db
    .insert(checkinAnswers)
    .values({ sessionId: session.id, questionKey: question.key, answer })
    .onConflictDoUpdate({
      target: [checkinAnswers.sessionId, checkinAnswers.questionKey],
      set: { answer },
    });
  answers.set(question.key, answer);

  const next = nextQuestionIndex(questions, answers);
  await db
    .update(checkinSessions)
    .set({ status: next === -1 ? "completed" : "in_progress", updatedAt: new Date() })
    .where(eq(checkinSessions.id, session.id));

  if (next !== -1) return questionText(questions[next]!, next, questions.length);
  const closing =
    kind === "icebreaker" ? "Terima kasih! Semangat menjalani minggu ini 💪" : "Terima kasih, selamat menikmati akhir pekan! 🙌";
  return `${checkinSummaryText(kind, questions, answers)}\n\n${closing}`;
}
