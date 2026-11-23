import { Hono } from "hono";
import { feeRangeSchema, feeSettingsSchema, feeStatementInputSchema } from "@repo/shared";
import { audit, requireRole } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { parseWith } from "../../lib/validate.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import { getWhatsAppStatus, sendDocument } from "../whatsapp/service.js";
import { periodLabel, statementPdf } from "./pdf.js";
import { rupiah, usdToIdr } from "./rate.js";
import {
  feeOverview,
  finalizeStatement,
  getFeeSettings,
  listPayouts,
  saveFeeSettings,
  statementFor,
  undoPayout,
} from "./service.js";

// Bonus fee statements. Owner and Admin only: they decide and pay the bonus.
export const feesApi = new Hono();

const canManage = requireRole("Owner", "Admin");

feesApi.get("/", canManage, async (c) => {
  const range = parseWith(feeRangeSchema, { from: c.req.query("from"), to: c.req.query("to") });
  return c.json(await feeOverview(getWorkspaceId(c), range));
});

feesApi.get("/settings", canManage, async (c) => c.json(await getFeeSettings(getWorkspaceId(c))));

feesApi.put("/settings", canManage, async (c) => {
  const input = parseWith(feeSettingsSchema, await c.req.json());
  return c.json(await saveFeeSettings(getWorkspaceId(c), input.startDate));
});

const fileName = (name: string, from: string, to: string) => `Fee ${periodLabel(from, to)} - ${name}.pdf`;

feesApi.post("/statement/pdf", canManage, async (c) => {
  const input = parseWith(feeStatementInputSchema, await c.req.json());
  const { employee, statement } = await statementFor(getWorkspaceId(c), input);
  const pdf = await statementPdf({ name: employee.name, from: input.from, to: input.to, statement, rate: await usdToIdr() });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${encodeURIComponent(fileName(employee.name, input.from, input.to))}"`,
    },
  });
});

feesApi.post("/statement/send", canManage, async (c) => {
  const ws = getWorkspaceId(c);
  const input = parseWith(feeStatementInputSchema, await c.req.json());
  if (!getWhatsAppStatus(ws).connected) throw new HttpError(409, "WhatsApp belum terhubung.");
  const { employee, statement } = await statementFor(ws, input);
  const rate = await usdToIdr();
  const pdf = await statementPdf({ name: employee.name, from: input.from, to: input.to, statement, rate });
  const total =
    `$${statement.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
    (rate ? ` (${rupiah(statement.total * rate.idr)})` : "");
  await sendDocument(ws, `${employee.phone}@s.whatsapp.net`, {
    buffer: pdf,
    mimetype: "application/pdf",
    fileName: fileName(employee.name, input.from, input.to),
    caption: `Halo ${employee.name}, berikut rincian fee ${periodLabel(input.from, input.to)}. Total fee: ${total}.`,
  });
  await audit(ws, getActorId(c), "fee.statement.send", "employee", employee.id, { from: input.from, to: input.to, total: statement.total });
  return c.json({ sent: true, phone: employee.phone });
});

feesApi.post("/statement/finalize", canManage, async (c) => {
  const ws = getWorkspaceId(c);
  const input = parseWith(feeStatementInputSchema, await c.req.json());
  const result = await finalizeStatement(ws, input, getActorId(c));
  await audit(ws, getActorId(c), "fee.statement.finalize", "employee", result.employee.id, {
    from: input.from,
    to: input.to,
    payouts: result.payouts,
  });
  return c.json(result, 201);
});

feesApi.get("/payouts", canManage, async (c) => {
  const employeeId = c.req.query("employeeId") || undefined;
  if (employeeId && !/^[0-9a-f-]{36}$/i.test(employeeId)) throw new HttpError(400, "employeeId tidak valid");
  return c.json({ payouts: await listPayouts(getWorkspaceId(c), employeeId) });
});

feesApi.delete("/payouts/:id", canManage, async (c) => {
  const ws = getWorkspaceId(c);
  const row = await undoPayout(ws, c.req.param("id"));
  await audit(ws, getActorId(c), "fee.payout.undo", "employee", row.employeeId, { payoutId: row.id, group: row.group });
  return c.json({ deleted: true });
});
