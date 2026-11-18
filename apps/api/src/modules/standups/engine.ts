import { editStandup, recordAnswers, startStandup } from "./engine/answers.js";
import { getStandupSession, standupToday, type StandupCollector } from "./engine/store.js";
import { EMPLOYEE_MENU } from "./engine/texts.js";

export { openingText } from "./engine/answers.js";
export { parseStandupText } from "./engine/parse.js";
export {
  getStandupSession,
  standupTimezone,
  standupToday,
  type StandupCollector,
} from "./engine/store.js";
export {
  draftedPromptText,
  EMPLOYEE_MENU,
  STANDUP_QUESTIONS,
  standupPromptText,
  standupReminderText,
} from "./engine/texts.js";

const STANDUP_COMMAND = /^standup\b[\s:,.-]*/i;
const EDIT_COMMAND = /^(?:ubah|edit|update|ganti|revisi)\s+standup\b[\s:,.-]*/i;
const HELP_COMMAND = /^(?:bantuan|help|menu)$/i;

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

  const date = args.date ?? (await standupToday(args.employee.workspaceId));
  if (HELP_COMMAND.test(text)) return EMPLOYEE_MENU;

  const edit = text.match(EDIT_COMMAND);
  if (edit) return editStandup(args.employee, date, text.slice(edit[0].length));

  const start = text.match(STANDUP_COMMAND);
  if (start) return startStandup(args.employee, date, text.slice(start[0].length));

  const session = await getStandupSession(args.employee.id, date);
  if (!session || session.status === "completed" || session.status === "missed") return null;
  return recordAnswers(args.employee, session, date, text);
}
