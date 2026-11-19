import { getEmployee } from "../../employees/service.js";
import { HttpError } from "../../../lib/http-error.js";
import { checkoutDrafts } from "../draft.js";
import { closeStaleCheckouts, getStandupSession, openCheckout, standupTimezone, standupToday } from "../engine.js";
import { excludedDay, jidFor, NOT_CONNECTED, notConnected, senderFor, type SendFn } from "./delivery.js";
import { standupTargets } from "./progress.js";

/**
 * Sends the afternoon checkout to every standup target who has not had one
 * today: what they did today, drafted from today's GitHub activity, to
 * confirm or extend, then the blocker question. `resend` sends it again to
 * checkouts that are still open.
 */
export async function sendCheckoutPrompts(
  workspaceId: string,
  options: { employeeId?: string; date?: string; send?: SendFn; force?: boolean; resend?: boolean } = {},
) {
  const send = senderFor(workspaceId, options.send);
  const date = options.date ?? (await standupToday(workspaceId));

  if (notConnected(workspaceId, options.send)) return { date, ...NOT_CONNECTED, skipped: 0 };
  if (!options.force) {
    const check = await excludedDay(workspaceId, date);
    if (check.excluded) return { date, sent: 0, skipped: 0, failed: 0, excluded: true, reason: check.reason };
  }

  let targets;
  if (options.employeeId) {
    const employee = await getEmployee(workspaceId, options.employeeId);
    if (!employee) throw new HttpError(404, "Employee not found");
    if (!employee.isActive) throw new HttpError(400, "Employee is not active");
    targets = [employee];
  } else {
    targets = await standupTargets(workspaceId);
  }
  await closeStaleCheckouts(workspaceId, date);

  const toPrompt = [];
  let skipped = 0;
  for (const employee of targets) {
    const status = (await getStandupSession(employee.id, date))?.checkoutStatus;
    if (!status || (options.resend && (status === "pending" || status === "in_progress"))) toPrompt.push(employee);
    else skipped++;
  }

  const tz = await standupTimezone(workspaceId);
  const drafts = await checkoutDrafts(workspaceId, date, toPrompt.map((e) => e.id), tz);

  let sent = 0;
  let failed = 0;
  for (const employee of toPrompt) {
    const opened = await openCheckout({ id: employee.id, workspaceId }, date, drafts.get(employee.id) ?? null);
    try {
      await send(jidFor(employee.phone), opened.text);
      sent++;
    } catch {
      await opened.undo();
      failed++;
    }
  }
  return { date, sent, skipped, failed };
}
