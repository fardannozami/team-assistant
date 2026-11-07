import { Hono } from "hono";
import type { Context } from "hono";
import {
  createEmployeeSchema,
  updateEmployeePhoneSchema,
  updateEmployeeSchema,
} from "@repo/shared";
import { requireRole } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { parseWith } from "../../lib/validate.js";
import {
  createEmployee,
  getEmployee,
  getEmployeeStandupHistory,
  listEmployees,
  updateEmployee,
  updateEmployeePhone,
} from "./service.js";

export const employeesApi = new Hono();

const canManage = requireRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager");

function actorId(c: Context): string | null {
  return (c.get("user") as { sub?: string } | undefined)?.sub ?? null;
}

employeesApi.get("/", canView, async (c) => {
  const activeParam = c.req.query("active");
  const rows = await listEmployees({
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
  const employee = await createEmployee(input, actorId(c));
  return c.json(employee, 201);
});

employeesApi.get("/:id/standups", canView, async (c) => {
  return c.json(await getEmployeeStandupHistory(c.req.param("id")));
});

employeesApi.patch("/:id/phone", canManage, async (c) => {
  const { phone } = parseWith(
    updateEmployeePhoneSchema,
    await c.req.json(),
  );
  const employee = await updateEmployeePhone(
    c.req.param("id"),
    phone,
    actorId(c),
  );
  return c.json(employee);
});

employeesApi.get("/:id", canView, async (c) => {
  const employee = await getEmployee(c.req.param("id"));
  if (!employee) throw new HttpError(404, "Employee not found");
  return c.json(employee);
});

employeesApi.patch("/:id", canManage, async (c) => {
  const input = parseWith(updateEmployeeSchema, await c.req.json());
  const employee = await updateEmployee(c.req.param("id"), input, actorId(c));
  return c.json(employee);
});
