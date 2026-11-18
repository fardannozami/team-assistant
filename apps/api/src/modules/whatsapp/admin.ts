import { isAdminRole } from "@repo/shared";
import { upsertStandupSchedule } from "../schedules/service.js";
import { generateDailyReport, generateWeeklyReport } from "../reports/service.js";
import { continueAddFlow, startAddFlow } from "./admin/add-flow.js";
import { ADMIN_KEYWORD, MENU_TEXT, parseCommand, type CommandName } from "./admin/commands.js";
import { clearFlow, getFlow, isNo, isYes, setFlow, type AdminSender } from "./admin/flows.js";
import { parseNaturalSchedule, scheduleConfirmation } from "./admin/natural-schedule.js";
import { continuePhoneFlow, startPhoneFlow } from "./admin/phone-flow.js";
import {
  checkinKindFrom,
  checkinReportText,
  renderEmployeeList,
  startCheckinCommand,
  startStandupCommand,
} from "./admin/reports.js";
import { savedScheduleReply, setReminderCommand, setScheduleCommand, showSchedules } from "./admin/schedule.js";

export { buildAdminWelcomeText } from "./admin/commands.js";
export { standupTriggerReply } from "./admin/reports.js";

async function runCommand(ws: string, flowKey: string, name: CommandName, rest: string): Promise<string> {
  switch (name) {
    case "MENU":
    case "HELP":
      return MENU_TEXT;
    case "EMPLOYEE_LIST":
      return renderEmployeeList(ws);
    case "SHOW_SCHEDULE":
      return showSchedules(ws);
    case "SET_SCHEDULE":
      return setScheduleCommand(ws, rest);
    case "SET_REMINDER":
      return setReminderCommand(ws, rest);
    case "ADD_EMPLOYEE":
      return startAddFlow(flowKey, rest);
    case "UPDATE_PHONE":
      return startPhoneFlow(ws, flowKey, rest);
    case "REPORT_TODAY":
      return (await generateDailyReport(ws)).text;
    case "REPORT_WEEKLY":
      return (await generateWeeklyReport(ws)).text;
    case "START_CHECKIN":
      return startCheckinCommand(ws, checkinKindFrom(rest));
    case "REPORT_CHECKIN":
      return checkinReportText(ws, checkinKindFrom(rest));
    case "START_STANDUP":
      return startStandupCommand(ws, rest);
  }
}

export async function handleAdminMessage(args: {
  workspaceId: string;
  phone: string;
  body: string;
  employee: AdminSender | null;
  roleName: string | null;
}): Promise<string | null> {
  const text = args.body.trim();
  if (!text) return null;

  const ws = args.workspaceId;
  const flowKey = `${ws}:${args.phone}`;
  const command = parseCommand(text);
  const pending = getFlow(flowKey);

  if (!args.employee) {
    const looksAdmin = command || pending || ADMIN_KEYWORD.test(text);
    return looksAdmin ? "Kamu bukan pengguna terdaftar." : null;
  }

  if (!isAdminRole(args.roleName)) {
    // Employees get their own menu from the standup engine.
    if (command?.name === "MENU" || command?.name === "HELP") return null;
    const looksAdmin = command || pending || ADMIN_KEYWORD.test(text);
    return looksAdmin ? "Kamu bukan administrator." : null;
  }

  if (/^(cancel|batal|stop)$/i.test(text)) {
    clearFlow(flowKey);
    return "Dibatalkan.";
  }

  if (command) {
    clearFlow(flowKey);
    return runCommand(ws, flowKey, command.name, command.rest);
  }

  if (pending?.kind === "schedule") {
    clearFlow(flowKey);
    if (isYes(text)) {
      const schedule = await upsertStandupSchedule(ws, pending.schedule, args.employee.userId);
      return savedScheduleReply(schedule);
    }
    if (isNo(text)) return "Dibatalkan, jadwal tidak diubah.";
    // Anything else is a new message: the schedule stays as it was.
  } else if (pending) {
    return pending.kind === "add"
      ? continueAddFlow(ws, flowKey, pending, text, args.employee)
      : continuePhoneFlow(ws, flowKey, pending, text, args.employee);
  }

  // Never saved straight away: a sentence that merely mentions a day and a
  // time would otherwise replace the whole schedule.
  const natural = parseNaturalSchedule(text);
  if (natural) {
    setFlow(flowKey, { kind: "schedule", step: "confirm", schedule: natural });
    return scheduleConfirmation(natural);
  }

  return null;
}
