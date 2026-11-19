import { CHECKOUT_TIME, MORNING_STANDUP_ELEMENTS, isNoBlocker, type StandupElement } from "@repo/shared";
import { standupAnswers, standupSessions } from "@repo/database";
import { morningOpenings, type MorningOpening } from "../draft.js";
import { parseStandupText } from "./parse.js";
import {
  db,
  getAnswers,
  getOrCreateStandupRow,
  getStandupSession,
  setSessionStatus,
  standupTimezone,
  upsertAnswer,
  type StandupCollector,
} from "./store.js";
import { closedText, EDIT_HINT, morningPromptText, STANDUP_QUESTIONS, summarize } from "./texts.js";

/**
 * The morning message. "Kemarin" (the previous checkout, else drafted from
 * GitHub) is filed as the answer, unless one is there already, and shown, so
 * the prompt asks only for today's plan.
 */
export async function openingText(
  employee: { id: string; workspaceId: string },
  sessionId: string,
  date: string,
  opening?: MorningOpening,
): Promise<string> {
  if (opening?.yesterday) {
    const row = await getOrCreateStandupRow(employee.workspaceId, sessionId, employee.id, date);
    // Never over a "kemarin" the employee may have just sent.
    const [filed] = await db
      .insert(standupAnswers)
      .values({ standupId: row.id, questionKey: "yesterday", answer: opening.yesterday })
      .onConflictDoNothing()
      .returning({ id: standupAnswers.id });
    if (!filed) return morningPromptText(date);
  }
  return morningPromptText(date, opening);
}

async function saveParsed(standupId: string, parsed: Partial<Record<StandupElement, string>>) {
  for (const [key, value] of Object.entries(parsed) as [StandupElement, string][]) {
    const normalized = key === "blockers" && isNoBlocker(value) ? "none" : value;
    await upsertAnswer(standupId, key, normalized);
  }
}

/** STANDUP: opens today's session on demand, then records any answers sent with it. */
export async function startStandup(employee: StandupCollector, date: string, rest: string) {
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
  const missing = MORNING_STANDUP_ELEMENTS.filter((key) => !answered.has(key));
  if (missing.length === 0) {
    await setSessionStatus(session.id, "completed");
    return `${summarize(date, "Standup kamu sudah tercatat untuk", await getAnswers(row.id))}\n${EDIT_HINT}`;
  }
  if (!answered.size) {
    const tz = await standupTimezone(employee.workspaceId);
    const openings = await morningOpenings(employee.workspaceId, date, [employee.id], tz);
    return openingText(employee, session.id, date, openings.get(employee.id));
  }
  return `Lanjutkan standup ${date}: ${STANDUP_QUESTIONS[missing[0]!]}`;
}

/** UBAH STANDUP: changes only the labelled parts of today's answers. */
export async function editStandup(employee: StandupCollector, date: string, rest: string) {
  const session = await getStandupSession(employee.id, date);
  if (!session) return `Belum ada standup untuk ${date}. Kirim STANDUP untuk mulai.`;
  if (session.status === "missed") return closedText(date);
  if (session.status !== "completed") {
    return rest ? recordAnswers(employee, session, date, rest) : `Standup ${date} belum selesai. ${STANDUP_QUESTIONS.today}`;
  }

  const parsed = parseStandupText(rest);
  if (Object.keys(parsed).length === 0) return EDIT_HINT;

  const row = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);
  await saveParsed(row.id, parsed);
  return `${summarize(date, "Standup diperbarui untuk", await getAnswers(row.id))} 😊`;
}

/** Files a message into an open session and asks for whatever is still missing. */
export async function recordAnswers(
  employee: StandupCollector,
  session: { id: string; status: string },
  date: string,
  text: string,
) {
  const standupRow = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);

  const answers = await getAnswers(standupRow.id);
  const answered = new Set(answers.map((a) => a.questionKey));
  const missing = MORNING_STANDUP_ELEMENTS.filter((key) => !answered.has(key));
  if (missing.length === 0) return null;

  let parsed = parseStandupText(text, missing[0], missing);
  if (Object.keys(parsed).length === 0) {
    // Free-form reply to the question we asked last: file it there.
    parsed = { [missing[0]!]: text };
  }
  await saveParsed(standupRow.id, parsed);
  for (const key of Object.keys(parsed)) answered.add(key);

  if (session.status === "pending") {
    await setSessionStatus(session.id, "in_progress");
  }

  const stillMissing = MORNING_STANDUP_ELEMENTS.filter((key) => !answered.has(key));
  if (stillMissing.length === 0) {
    await setSessionStatus(session.id, "completed");
    return [
      summarize(date, "Standup tercatat untuk", await getAnswers(standupRow.id)),
      `Terima kasih 😊 Jam ${CHECKOUT_TIME} nanti aku kirim checkout untuk mencatat yang kamu kerjakan hari ini.`,
    ].join("\n");
  }
  return `Diterima. ${STANDUP_QUESTIONS[stillMissing[0]!]}`;
}
