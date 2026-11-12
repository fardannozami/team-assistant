import { Hono } from "hono";
import {
  createEmployeeSchema,
  isAdminRole,
  updateEmployeePhoneSchema,
  updateEmployeeSchema,
} from "@repo/shared";
import { requireRole } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import { parseWith } from "../../lib/validate.js";
import {
  createEmployee,
  getEmployee,
  getEmployeeStandupHistory,
  listEmployees,
  updateEmployee,
  updateEmployeePhone,
  type EmployeeRecord,
} from "./service.js";
import { buildAdminWelcomeText } from "../whatsapp/admin.js";
import { sendText } from "../whatsapp/service.js";

export const employeesApi = new Hono();

const canManage = requireRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager");

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";

// Fire-and-forget: a disconnected bot must not fail the dashboard request.
function welcomeNewAdmin(
  workspaceId: string,
  before: EmployeeRecord | null | undefined,
  after: EmployeeRecord | null | undefined,
) {
  if (!after?.isActive || !isAdminRole(after.roleName)) return;
  if (before && isAdminRole(before.roleName)) return;
  const text = buildAdminWelcomeText(after.name, after.roleName!, WEB_URL);
  sendText(workspaceId, `${after.phone}@s.whatsapp.net`, text).catch((error) =>
    console.error("Failed to send admin welcome to", after.phone, error),
  );
}

employeesApi.get("/", canView, async (c) => {
  const activeParam = c.req.query("active");
  const rows = await listEmployees(getWorkspaceId(c), {
    teamId: c.req.query("teamId"),
    roleId: c.req.query("roleId"),
    search: c.req.query("search"),
    active:
      activeParam === "true" ? true : activeParam === "false" ? false : undefined,
  });
  return c.json({ employees: rows });
});

employeesApi.post("/", canManage, async (c) => {
  const input = parseWith(createEmployeeSchema, await c.req.json());
  const employee = await createEmployee(
    getWorkspaceId(c),
    input,
    getActorId(c),
  );
  welcomeNewAdmin(getWorkspaceId(c), null, employee);
  return c.json(employee, 201);
});

employeesApi.get("/:id/standups", canView, async (c) => {
  return c.json(await getEmployeeStandupHistory(getWorkspaceId(c), c.req.param("id")));
});

employeesApi.patch("/:id/phone", canManage, async (c) => {
  const { phone } = parseWith(
    updateEmployeePhoneSchema,
    await c.req.json(),
  );
  const employee = await updateEmployeePhone(
    getWorkspaceId(c),
    c.req.param("id"),
    phone,
    getActorId(c),
  );
  return c.json(employee);
});

employeesApi.get("/:id", canView, async (c) => {
  const employee = await getEmployee(getWorkspaceId(c), c.req.param("id"));
  if (!employee) throw new HttpError(404, "Employee not found");
  return c.json(employee);
});

employeesApi.patch("/:id", canManage, async (c) => {
  const input = parseWith(updateEmployeeSchema, await c.req.json());
  const before = await getEmployee(getWorkspaceId(c), c.req.param("id"));
  const employee = await updateEmployee(
    getWorkspaceId(c),
    c.req.param("id"),
    input,
    getActorId(c),
  );
  welcomeNewAdmin(getWorkspaceId(c), before, employee);
  return c.json(employee);
});
