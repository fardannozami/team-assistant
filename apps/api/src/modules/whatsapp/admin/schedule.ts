import { describeStandupReminders } from "@repo/shared";
import { HttpError } from "../../../lib/http-error.js";
import { listSchedules, upsertStandupSchedule } from "../../schedules/service.js";
import { formatWeekdays, parseWeekdays } from "./days.js";

export function savedScheduleReply(schedule: {
  timeOfDay: string | null;
  weekdays: unknown;
  timezone: string;
  reminderMiddayTime: string | null;
  reminderAfternoonTime: string | null;
}): string {
  const days = Array.isArray(schedule.weekdays)
    ? formatWeekdays(schedule.weekdays as number[])
    : "custom days";
  const reminders = describeStandupReminders(schedule);
  const reminder = reminders ? `\nPengingat: ${reminders}.` : "";
  return `Jadwal tersimpan.\nStandup berjalan ${days} pukul ${schedule.timeOfDay} (${schedule.timezone}).${reminder}`;
}

export async function showSchedules(workspaceId: string): Promise<string> {
  const rows = await listSchedules(workspaceId);
  if (rows.length === 0) {
    return "Belum ada jadwal. Gunakan SET SCHEDULE <HH:mm> [HARI], contoh SET SCHEDULE 09:00 MON-FRI.";
  }
  return rows
    .map((schedule) => {
      const weekdays = Array.isArray(schedule.weekdays)
        ? (schedule.weekdays as number[])
        : null;
      const when = schedule.timeOfDay ?? schedule.cronExpression ?? "?";
      const days = weekdays ? formatWeekdays(weekdays) : "custom cron";
      const reminders = describeStandupReminders(schedule);
      const reminder = reminders ? `, pengingat ${reminders}` : "";
      return `- ${schedule.name} (${schedule.isActive ? "active" : "disabled"}): ${when} ${days}, ${schedule.timezone}${reminder}`;
    })
    .join("\n");
}

export async function setScheduleCommand(workspaceId: string, rest: string): Promise<string> {
  const timeMatch = rest.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!timeMatch) {
    return "Format: SET SCHEDULE <HH:mm> [HARI], contoh SET SCHEDULE 08:45 MON-FRI";
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) {
    return "Jam itu tidak valid. Gunakan format 24 jam HH:mm, contoh 08:45.";
  }
  const timeOfDay = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const remainder = rest.replace(timeMatch[0], " ").trim();
  let weekdays: number[] | undefined;
  if (remainder) {
    const parsed = parseWeekdays(remainder);
    if (!parsed) {
      return "Hari tidak terbaca. Gunakan nama hari (MON TUE), rentang (MON-FRI), DAILY, atau WEEKDAYS.";
    }
    weekdays = parsed;
  }

  const schedule = await upsertStandupSchedule(workspaceId, { timeOfDay, weekdays });
  return savedScheduleReply(schedule);
}

const REMINDER_FORMAT =
  "Format: SET REMINDER <siang HH:mm> <sore HH:mm>, contoh SET REMINDER 12:00 15:00, atau SET REMINDER OFF";

function parseClock(token: string): string | null {
  const match = token.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Standup reminders go out twice: siang and sore. */
export async function setReminderCommand(workspaceId: string, rest: string): Promise<string> {
  const tokens = rest.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && /^(OFF|NONE|DISABLED?)$/.test(tokens[0]!)) {
    await upsertStandupSchedule(workspaceId, { reminderMiddayTime: null, reminderAfternoonTime: null });
    return "Pengingat dimatikan.";
  }
  if (tokens.length !== 2) return REMINDER_FORMAT;

  const [midday, afternoon] = tokens.map(parseClock);
  if (!midday || !afternoon) return REMINDER_FORMAT;

  try {
    await upsertStandupSchedule(workspaceId, { reminderMiddayTime: midday, reminderAfternoonTime: afternoon });
  } catch (error) {
    if (error instanceof HttpError) return error.message;
    throw error;
  }
  return `Pengingat standup dikirim siang pukul ${midday} dan sore pukul ${afternoon} ke yang belum selesai.`;
}
