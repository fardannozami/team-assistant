import { MORNING_STANDUP_ELEMENTS, isAdminRole, type StandupElement } from "@repo/shared";
import { listEmployees } from "../../employees/service.js";
import { standupToday } from "../engine.js";
import { excludedDay, jidFor, NOT_CONNECTED, notConnected, senderFor, type SendFn } from "./delivery.js";
import { standupProgress } from "./progress.js";

const MISSING_LABEL: Record<StandupElement, string> = {
  yesterday: "kemarin",
  today: "hari ini",
  blockers: "kendala",
};

/** Sends admins the list of who has not finished today's standup yet. */
export async function sendStandupSummary(
  workspaceId: string,
  options: { date?: string; send?: SendFn } = {},
) {
  const send = senderFor(workspaceId, options.send);
  const date = options.date ?? (await standupToday(workspaceId));

  if (notConnected(workspaceId, options.send)) {
    return { date, ...NOT_CONNECTED, pending: 0 };
  }
  if ((await excludedDay(workspaceId, date)).excluded) {
    return { date, sent: 0, failed: 0, pending: 0, excluded: true };
  }

  const progress = await standupProgress(workspaceId, date);
  const pending = progress.filter((p) => p.session?.status !== "completed");
  const done = progress.length - pending.length;
  const describe = (p: (typeof pending)[number]) => {
    const status = p.session?.status;
    if (status === "missed") return "tidak mengisi";
    if (!p.session || p.missing.length === MORNING_STANDUP_ELEMENTS.length) return "belum mulai";
    return `kurang ${p.missing.map((k) => MISSING_LABEL[k]).join(", ")}`;
  };
  const text = pending.length
    ? [
        `Standup ${date}: ${done} dari ${progress.length} sudah mengisi.`,
        "Belum selesai:",
        ...pending.map((p) => `- ${p.name}: ${describe(p)}`),
      ].join("\n")
    : `Standup ${date}: semua (${progress.length}) sudah mengisi 🎉`;

  const admins = (await listEmployees(workspaceId, { active: true })).filter((e) => isAdminRole(e.roleName));
  let sent = 0;
  let failed = 0;
  for (const admin of admins) {
    try {
      await send(jidFor(admin.phone), text);
      sent++;
    } catch {
      failed++;
    }
  }
  return { date, sent, failed, pending: pending.length };
}
