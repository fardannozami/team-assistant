import type { ToolSpec } from "../client.js";
import { TOOL_DESCRIPTIONS, toolSpec } from "./shared.js";

export const EMPLOYEE_SPECS: ToolSpec[] = [
  toolSpec(
    "get_employee",
    `Look up an employee's profile (name, WhatsApp, team, role, active status). Without arguments returns the current user. ${TOOL_DESCRIPTIONS.getEmployeeOnly}`,
    {
      type: "object",
      properties: {
        identifier: {
          type: "string",
          description:
            "Employee name or WhatsApp phone number. Omit for the current user.",
        },
      },
    },
  ),
  toolSpec(
    "get_standup_history",
    `Read an employee's recorded standups (most recent first). Defaults to the current user. ${TOOL_DESCRIPTIONS.getEmployeeOnly}`,
    {
      type: "object",
      properties: {
        identifier: {
          type: "string",
          description:
            "Employee name or phone. Omit for the current user.",
        },
        limit: {
          type: "integer",
          description: "Maximum standups to return (default 5).",
        },
      },
    },
  ),
  toolSpec(
    "list_employees",
    `List employees (name, WhatsApp, team, role, active). ${TOOL_DESCRIPTIONS.getEmployeeOnly}`,
    {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "inactive", "all"], description: "Default active." },
        team: { type: "string", description: "Only employees of this team (name)." },
        search: { type: "string", description: "Filter by part of a name or phone." },
      },
    },
  ),
  toolSpec(
    "add_employee",
    `Add a new employee. Owner/Admin only. Ask for the name and WhatsApp number if missing. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        name: { type: "string", description: "Full name." },
        phone: { type: "string", description: "WhatsApp number, e.g. 0812... or 62812..." },
        team: { type: "string", description: "Optional team name." },
        role: { type: "string", enum: ["Employee", "Manager", "Admin"], description: "Default Employee." },
      },
      required: ["name", "phone"],
    },
  ),
  toolSpec(
    "update_employee",
    `Change an employee's name, team or role. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Current employee name or phone." },
        name: { type: "string", description: "New name." },
        team: { type: "string", description: "New team name, or 'none' to remove from the team." },
        role: { type: "string", enum: ["Employee", "Manager", "Admin"] },
      },
      required: ["identifier"],
    },
  ),
  toolSpec(
    "update_employee_phone",
    `Change an employee's WhatsApp number. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Employee name or current phone." },
        phone: { type: "string", description: "New WhatsApp number." },
      },
      required: ["identifier", "phone"],
    },
  ),
  toolSpec(
    "set_employee_active",
    `Deactivate an employee (no more standup prompts) or reactivate them. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Employee name or phone." },
        active: { type: "boolean", description: "false to deactivate, true to reactivate." },
      },
      required: ["identifier", "active"],
    },
  ),
];
