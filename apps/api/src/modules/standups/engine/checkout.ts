/**
 * Daily checkout: in the afternoon the employee gets what they did today,
 * drafted from GitHub, confirms it, adds to it or replaces it, and then
 * answers the blocker question. Stored on the day's standup: answers "done"
 * and "blockers", with its own status on the session (`checkoutStatus`).
 */
import { checkinSessions, employees, standupAnswers, standupSessions } from "@repo/database";
import { isNoBlocker } from "@repo/shared";
import { and, eq, inArray, lt } from "drizzle-orm";
import {
  db,
  getAnswers,
  getOrCreateStandupRow,
  getStandupSession,
  upsertAnswer,
  type StandupCollector,
} from "./store.js";
import {
  CHECKOUT_EDIT_HINT,
  checkoutBlockerQuestion,
  checkoutClosedText,
  checkoutPromptText,
  checkoutSummary,
} from "./texts.js";

export const OPEN_CHECKOUT = ["pending", "in_progress"];

const CONFIRM = /^(?:ok(?:e|ay|ey)?|ya|iya|yes|y|sip|siap|sesuai|benar|betul|setuju|mantap|done|👍|✅)[\s.!👍✅]*$/i;
const REPLACE = /^(?:ganti|ubah)\s*:\s*/i;
const APPEND = /^tambah(?:kan)?\s*:\s*/i;
const BLOCKER = /^(?:kendala|blockers?|hambatan)\s*:\s*/i;

type Session = { id: string; checkoutStatus: string | null };

/** Adds `extra` to the work done, as a list item when the work is a list. */
export function appendWork(done: string | undefined, extra: string) {
  if (!done) return extra;
  const asItem = /^\s*[-•*]\s/m.test(done) && !/^\s*[-•*]\s/.test(extra) ? `- ${extra}` : extra;
  return `${done}\n${asItem}`;
}

async function setCheckout(sessionId: string, checkoutStatus: string | null, prompted = false) {
  await db
    .update(standupSessions)
    .set({ checkoutStatus, ...(prompted ? { checkoutAt: new Date() } : {}), updatedAt: new Date() })
    .where(eq(standupSessions.id, sessionId));
}

/**
 * Opens today's checkout: creates the day's session when there is none, files
 * the GitHub draft as "done" (never over one already there) and returns the
 * prompt. `undo` takes it back when the prompt could not be delivered.
 */
export async function openCheckout(
  employee: { id: string; workspaceId: string },
  date: string,
  draft: string | null,
) {
  let session = await getStandupSession(employee.id, date);
  let createdSession = false;
  if (!session) {
    const [created] = await db
      .insert(standupSessions)
      .values({ workspaceId: employee.workspaceId, employeeId: employee.id, date, status: "pending" })
      .onConflictDoNothing()
      .returning({ id: standupSessions.id });
    createdSession = !!created;
    session = await getStandupSession(employee.id, date);
    if (!session) throw new Error("Failed to open the checkout session");
  }
  const row = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);
  const existing = (await getAnswers(row.id)).find((a) => a.questionKey === "done")?.answer;
  let filed = false;
  if (draft && !existing) {
    await upsertAnswer(row.id, "done", draft);
    filed = true;
  }
  const previous = session.checkoutStatus;
  await setCheckout(session.id, "pending", true);

  const sessionId = session.id;
  return {
    text: checkoutPromptText(date, existing ?? draft),
    async undo() {
      if (createdSession) {
        await db.delete(standupSessions).where(eq(standupSessions.id, sessionId));
        return;
      }
      if (filed) {
        await db.delete(standupAnswers).where(and(eq(standupAnswers.standupId, row.id), eq(standupAnswers.questionKey, "done")));
      }
      await setCheckout(sessionId, previous);
    },
  };
}

/** Note for when a weekly check-out is also waiting today. */
async function weeklyHint(employeeId: string, date: string) {
  const [open] = await db
    .select({ id: checkinSessions.id })
    .from(checkinSessions)
    .where(
      and(
        eq(checkinSessions.employeeId, employeeId),
        eq(checkinSessions.kind, "checkout"),
        eq(checkinSessions.date, date),
        inArray(checkinSessions.status, OPEN_CHECKOUT),
      ),
    )
    .limit(1);
  return open ? "\n\nCheck-out mingguan kamu juga masih menunggu. Kirim CHECKOUT MINGGUAN untuk lanjut." : "";
}

async function complete(employee: StandupCollector, session: Session, date: string, standupId: string) {
  await setCheckout(session.id, "completed");
  const summary = checkoutSummary(date, "Checkout tercatat untuk", await getAnswers(standupId));
  return `${summary}\nTerima kasih, sampai besok! 🙌${await weeklyHint(employee.id, date)}`;
}

/** Files a reply into an open checkout and asks what is still missing. */
export async function recordCheckout(employee: StandupCollector, session: Session, date: string, text: string) {
  const row = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);
  const done = (await getAnswers(row.id)).find((a) => a.questionKey === "done")?.answer;

  const blocker = text.match(BLOCKER);
  if (blocker) {
    if (!done) return "Tulis dulu apa saja yang kamu kerjakan hari ini.";
    const answer = text.slice(blocker[0].length).trim();
    await upsertAnswer(row.id, "blockers", isNoBlocker(answer) || !answer ? "none" : answer);
    return complete(employee, session, date, row.id);
  }

  const replace = text.match(REPLACE);
  const append = text.match(APPEND);
  if (session.checkoutStatus === "pending" || replace || append) {
    let next: string;
    if (replace) next = text.slice(replace[0].length).trim();
    else if (append) next = appendWork(done, text.slice(append[0].length).trim());
    else if (CONFIRM.test(text)) {
      if (!done) return "Tulis apa saja yang kamu kerjakan hari ini.";
      next = done;
    } else next = appendWork(done, text);
    if (!next) return "Tulis apa saja yang kamu kerjakan hari ini.";
    await upsertAnswer(row.id, "done", next);
    await setCheckout(session.id, "in_progress");
    return checkoutBlockerQuestion(next);
  }

  await upsertAnswer(row.id, "blockers", isNoBlocker(text) ? "none" : text);
  return complete(employee, session, date, row.id);
}

/** CHECKOUT: opens today's checkout on demand, or shows it / continues it. */
export async function startCheckout(
  employee: StandupCollector,
  date: string,
  rest: string,
  draftFor: () => Promise<string | null>,
) {
  const session = await getStandupSession(employee.id, date);
  if (session?.checkoutStatus === "missed") return checkoutClosedText(date);
  if (session?.checkoutStatus === "completed") {
    const row = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);
    return `${checkoutSummary(date, "Checkout kamu sudah tercatat untuk", await getAnswers(row.id))}\n${CHECKOUT_EDIT_HINT}`;
  }
  if (session && session.checkoutStatus && OPEN_CHECKOUT.includes(session.checkoutStatus)) {
    if (rest) return recordCheckout(employee, session, date, rest);
    const row = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);
    const done = (await getAnswers(row.id)).find((a) => a.questionKey === "done")?.answer;
    return session.checkoutStatus === "pending" ? checkoutPromptText(date, done ?? null) : checkoutBlockerQuestion(done ?? "-");
  }

  const { text } = await openCheckout(employee, date, await draftFor());
  if (!rest) return text;
  const opened = await getStandupSession(employee.id, date);
  return recordCheckout(employee, opened!, date, rest);
}

/** UBAH CHECKOUT: replaces the work done, or adds to it, or changes the blocker. */
export async function editCheckout(employee: StandupCollector, date: string, rest: string) {
  const session = await getStandupSession(employee.id, date);
  if (!session?.checkoutStatus) return `Belum ada checkout untuk ${date}. Kirim CHECKOUT untuk mulai.`;
  if (session.checkoutStatus === "missed") return checkoutClosedText(date);
  if (session.checkoutStatus !== "completed") {
    return rest ? recordCheckout(employee, session, date, rest) : CHECKOUT_EDIT_HINT;
  }
  if (!rest) return CHECKOUT_EDIT_HINT;

  const row = await getOrCreateStandupRow(employee.workspaceId, session.id, employee.id, date);
  const done = (await getAnswers(row.id)).find((a) => a.questionKey === "done")?.answer;
  const blocker = rest.match(BLOCKER);
  const append = rest.match(APPEND);
  if (blocker) {
    const answer = rest.slice(blocker[0].length).trim();
    await upsertAnswer(row.id, "blockers", isNoBlocker(answer) || !answer ? "none" : answer);
  } else if (append) {
    await upsertAnswer(row.id, "done", appendWork(done, rest.slice(append[0].length).trim()));
  } else {
    await upsertAnswer(row.id, "done", rest.replace(REPLACE, "").trim());
  }
  return `${checkoutSummary(date, "Checkout diperbarui untuk", await getAnswers(row.id))} 😊`;
}

/**
 * The shift's checkouts left open before `date` are closed, so they stop
 * taking replies. Per shift: a night checkout sent at 07:00 is still open
 * when the day shift starts.
 */
export async function closeStaleCheckouts(workspaceId: string, date: string, shift: string = "day") {
  const onShift = db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.workspaceId, workspaceId), eq(employees.shift, shift)));
  await db
    .update(standupSessions)
    .set({ checkoutStatus: "missed", updatedAt: new Date() })
    .where(
      and(
        eq(standupSessions.workspaceId, workspaceId),
        lt(standupSessions.date, date),
        inArray(standupSessions.checkoutStatus, OPEN_CHECKOUT),
        inArray(standupSessions.employeeId, onShift),
      ),
    );
}
