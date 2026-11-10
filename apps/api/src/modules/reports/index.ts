import { Hono } from "hono";
import type { Context } from "hono";
import { requireRole } from "../auth/index.js";
import { generateDailyReport, generateWeeklyReport } from "./service.js";
import { listEmployees } from "../employees/service.js";
import { sendText } from "../whatsapp/service.js";
import { isAdminRole } from "@repo/shared";

export const reportsApi = new Hono();

const canView = requireRole("Owner", "Admin", "Manager");

function actorId(c: Context): string | null {
  return (c.get("user") as { sub?: string } | undefined)?.sub ?? null;
}

reportsApi.get("/daily", canView, async (c) => {
  const date = c.req.query("date");
  return c.json(await generateDailyReport(date));
});

reportsApi.get("/weekly", canView, async (c) => {
  return c.json(await generateWeeklyReport());
});

reportsApi.post("/daily/notify", async (c) => {
  const token = c.req.header("x-internal-token");
  const expected = process.env.INTERNAL_API_TOKEN ?? "dev-internal-token";
  if (token !== expected) return c.json({ error: "unauthorized" }, 401);

  const report = await generateDailyReport();
  const employees = await listEmployees({ active: true });
  const admins = employees.filter((e) => isAdminRole(e.roleName));

  let sent = 0;
  for (const admin of admins) {
    try {
      await sendText(`${admin.phone}@s.whatsapp.net`, report.text);
      sent += 1;
    } catch (error) {
      console.error("Failed to send daily report to", admin.phone, error);
    }
  }
  return c.json({ sent, total: admins.length });
});
