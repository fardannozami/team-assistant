import { Hono } from "hono";
import { requireInternalOrRole, requireRole } from "../auth/index.js";
import { getWorkspaceId } from "../../lib/tenant.js";
import { generateDailyReport, generateWeeklyReport } from "./service.js";
import { listEmployees } from "../employees/service.js";
import { sendText } from "../whatsapp/service.js";
import { isAdminRole, normalizePhoneNumber, remindStandupSchema } from "@repo/shared";
import { parseWith } from "../../lib/validate.js";

export const reportsApi = new Hono();

const canView = requireRole("Owner", "Admin", "Manager");

reportsApi.get("/daily", canView, async (c) => {
  const date = c.req.query("date");
  return c.json(await generateDailyReport(getWorkspaceId(c), date));
});

reportsApi.get("/weekly", canView, async (c) => {
  return c.json(await generateWeeklyReport(getWorkspaceId(c)));
});

reportsApi.post(
  "/daily/notify",
  requireInternalOrRole("Owner", "Admin"),
  async (c) => {
    const ws = getWorkspaceId(c);
    // The worker sends the date in the timezone the report's cron ran in.
    const { date } = parseWith(remindStandupSchema, await c.req.json().catch(() => ({})));
    const report = await generateDailyReport(ws, date);
    const employees = await listEmployees(ws, { active: true });
    const admins = employees.filter((e) => isAdminRole(e.roleName));

    let sent = 0;
    for (const admin of admins) {
      try {
        await sendText(
          ws,
          `${normalizePhoneNumber(admin.phone)}@s.whatsapp.net`,
          report.text,
        );
        sent += 1;
      } catch (error) {
        console.error("Failed to send daily report to", admin.phone, error);
      }
    }
    return c.json({ sent, total: admins.length });
  },
);
