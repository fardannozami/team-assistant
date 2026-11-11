// Upper bound on reminder runs per schedule per day.
const MAX_REMINDERS_PER_DAY = 24;

function toMinutes(timeOfDay: string): number {
  const [hour = 0, minute = 0] = timeOfDay.split(":").map(Number);
  return hour * 60 + minute;
}

function toTime(total: number): string {
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Reminder times for one day: the first one `reminderMinutes` after the
 * prompt, then every `reminderRepeatMinutes` until the close time (or the
 * end of the day). Never wraps into the next day.
 */
export function reminderTimes(schedule: {
  timeOfDay: string;
  reminderMinutes: number | null;
  reminderRepeatMinutes: number | null;
  closeTime: string | null;
}): string[] {
  if (schedule.reminderMinutes == null || schedule.reminderMinutes <= 0) return [];
  const end = schedule.closeTime ? toMinutes(schedule.closeTime) : 1440;
  const step = schedule.reminderRepeatMinutes ?? 0;
  const times: string[] = [];
  for (
    let t = toMinutes(schedule.timeOfDay) + schedule.reminderMinutes;
    t < end && times.length < MAX_REMINDERS_PER_DAY;
    t += step
  ) {
    times.push(toTime(t));
    if (step <= 0) break;
  }
  return times;
}
