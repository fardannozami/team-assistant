/** Confirmation text for mutating tools that prepareTool does not prepare. */
export function pendingSummary(tool: string, args: Record<string, unknown>): string {
  if (tool === "create_schedule") {
    const days = Array.isArray(args.weekdays)
      ? (args.weekdays as unknown[])
          .map(String)
          .join(", ")
      : "no days";
    return `Confirm: create standup schedule "${args.name ?? "?"}" at ${args.timeOfDay ?? "?"} for days (${days})? Reply YES to confirm or NO to cancel.`;
  }

  if (tool === "update_schedule") {
    const parts: string[] = [];
    if (args.newName) parts.push(`rename to "${args.newName}"`);
    if (args.timeOfDay) parts.push(`time ${args.timeOfDay}`);
    if (Array.isArray(args.weekdays)) {
      parts.push(`days (${(args.weekdays as unknown[]).map(String).join(", ")})`);
    }
    if (args.timezone) parts.push(`timezone ${args.timezone}`);
    if (args.reminderMiddayTime !== undefined) {
      parts.push(args.reminderMiddayTime === null ? "no siang reminder" : `siang reminder at ${args.reminderMiddayTime}`);
    }
    if (args.reminderAfternoonTime !== undefined) {
      parts.push(args.reminderAfternoonTime === null ? "no sore reminder" : `sore reminder at ${args.reminderAfternoonTime}`);
    }
    if (args.closeTime !== undefined) parts.push(args.closeTime === null ? "never close" : `close at ${args.closeTime}`);
    if (args.summaryTime !== undefined) parts.push(args.summaryTime === null ? "no admin summary" : `admin summary at ${args.summaryTime}`);
    if (args.isActive !== undefined) {
      parts.push(args.isActive ? "activate" : "deactivate");
    }
    const target = args.id
      ? `schedule ${args.id}`
      : args.name
        ? `schedule "${args.name}"`
        : "the schedule";
    const details = parts.length ? `: ${parts.join(", ")}` : "";
    return `Confirm: update ${target}${details}? Reply YES to confirm or NO to cancel.`;
  }

  if (tool === "create_standup") {
    return `Confirm: save your standup for today?\nYesterday: ${args.yesterday ?? "-"}\nToday: ${args.today ?? "-"}\nBlockers: ${args.blockers ?? "-"}` + "\nReply YES to confirm or NO to cancel.";
  }

  return "An action is waiting for your confirmation. Reply YES to confirm or NO to cancel.";
}
