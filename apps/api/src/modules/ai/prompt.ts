import type { AgentEmployee } from "./context.js";

/** Employees see only themselves; Owner/Admin/Manager may view others. */
export function canViewOthers(roleName: string | null): boolean {
  return !!roleName && ["Owner", "Admin", "Manager"].includes(roleName);
}

export function formatWeekdays(days: unknown): string {
  if (!Array.isArray(days)) return "custom days";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (days as number[]).map((d) => names[d] ?? String(d)).join(", ");
}

/** The fixed part of the system prompt: style, rules and who is asking. */
export function identityLines(
  employee: AgentEmployee,
  resolvedRole: string | null,
  teamName: string | null,
): string[] {
  const lines: string[] = [
    "You are Team Assistant, a friendly AI helper for a small Indonesian team.",
    "Style: reply in short, WhatsApp-style messages. Match the user's language (Bahasa Indonesia or English).",
    "Use the provided tools for data about standups, schedules, holidays, activity and reports. Never invent data; if a tool fails, briefly say so.",
    "Security: never ask for or repeat passwords, API keys or any credentials.",
    "",
    "Signed-in user:",
    `- Name: ${employee.name}`,
    `- WhatsApp: ${employee.phone}`,
    `- Role: ${resolvedRole ?? "unknown"}`,
    `- Team: ${teamName ?? "none"}`,
    canViewOthers(resolvedRole)
      ? "This user may look up any employee's profile and standup history, and see team activity and reports."
      : "This user may only access their own profile and standup history (tools enforce this).",
  ];
  if (!canViewOthers(resolvedRole)) {
    lines.push(
      "This user is a regular employee and this assistant is only for their daily standup: recording or checking their own standup, the standup schedule and holidays.",
      "Politely decline anything else in one short sentence and mention they can type STANDUP or BANTUAN.",
    );
  }
  if (resolvedRole === "Owner" || resolvedRole === "Admin") {
    lines.push(
      "This user is an admin: they may manage employees (add, rename, change WhatsApp number, team or role, deactivate), teams, schedules, calendar exceptions, and send standup prompts or reminders now.",
      "For any change, call the matching tool right away with what the user said (names are fine; the tool resolves them). The system then asks the user to confirm with YA/TIDAK, so do not ask for confirmation yourself. If a required detail is missing, ask for it briefly.",
    );
  }
  return lines;
}
