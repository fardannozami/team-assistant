import { editStandup, recordAnswers, startStandup } from "./engine/answers.js";
import { editCheckout, OPEN_CHECKOUT, recordCheckout, startCheckout } from "./engine/checkout.js";
import { getStandupSession, standupTimezone, standupToday, type StandupCollector } from "./engine/store.js";
import { EMPLOYEE_MENU } from "./engine/texts.js";
import { checkoutDrafts } from "./draft.js";

export { openingText } from "./engine/answers.js";
export { closeStaleCheckouts, openCheckout, OPEN_CHECKOUT } from "./engine/checkout.js";
export { parseStandupText } from "./engine/parse.js";
export {
  getStandupSession,
  standupTimezone,
  standupToday,
  type StandupCollector,
} from "./engine/store.js";
export {
  checkoutPromptText,
  EMPLOYEE_MENU,
  morningPromptText,
  STANDUP_QUESTIONS,
  standupReminderText,
} from "./engine/texts.js";

const STANDUP_COMMAND = /^standup\b[\s:,.-]*/i;
const EDIT_COMMAND = /^(?:ubah|edit|update|ganti|revisi)\s+standup\b[\s:,.-]*/i;
// "CHECKOUT MINGGUAN" is the weekly check-in's, so it is left out here.
const CHECKOUT_COMMAND = /^check[\s-]?out(?:\s*:\s*|\s*$)/i;
const EDIT_CHECKOUT_COMMAND = /^(?:ubah|edit|update|ganti|revisi)\s+check[\s-]?out\b[\s:,.-]*/i;
const HELP_COMMAND = /^(?:bantuan|help|menu)$/i;

/**
 * Standup messages from employees. With an open checkout, any message is a
 * checkout answer; else, with an open morning session (after a prompt or
 * STANDUP) and no checkout yet, any message is a morning answer. Otherwise
 * only the keywords above touch the standup, so everything else can go to
 * admin commands or the AI agent. Returns null when not for the standup.
 */
export async function handleStandupMessage(args: {
  employee: StandupCollector;
  body: string;
  date?: string;
}): Promise<string | null> {
  const text = args.body.trim();
  if (!text || !args.employee.isActive) return null;

  const { employee } = args;
  const date = args.date ?? (await standupToday(employee.workspaceId));
  if (HELP_COMMAND.test(text)) return EMPLOYEE_MENU;

  const edit = text.match(EDIT_COMMAND);
  if (edit) return editStandup(employee, date, text.slice(edit[0].length));

  const editCheckoutMatch = text.match(EDIT_CHECKOUT_COMMAND);
  if (editCheckoutMatch) return editCheckout(employee, date, text.slice(editCheckoutMatch[0].length));

  const checkout = text.match(CHECKOUT_COMMAND);
  if (checkout) {
    return startCheckout(employee, date, text.slice(checkout[0].length), async () => {
      const tz = await standupTimezone(employee.workspaceId);
      return (await checkoutDrafts(employee.workspaceId, date, [employee.id], tz)).get(employee.id) ?? null;
    });
  }

  const start = text.match(STANDUP_COMMAND);
  if (start) return startStandup(employee, date, text.slice(start[0].length));

  const session = await getStandupSession(employee.id, date);
  if (!session) return null;
  if (session.checkoutStatus) {
    return OPEN_CHECKOUT.includes(session.checkoutStatus) ? recordCheckout(employee, session, date, text) : null;
  }
  if (session.status === "completed" || session.status === "missed") return null;
  return recordAnswers(employee, session, date, text);
}
