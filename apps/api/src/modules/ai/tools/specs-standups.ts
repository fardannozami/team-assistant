import type { ToolSpec } from "../client.js";
import { TOOL_DESCRIPTIONS, toolSpec } from "./shared.js";

export const STANDUP_SPECS: ToolSpec[] = [
  toolSpec(
    "create_standup",
    `Save the current user's standup for today with exactly three answers (yesterday, today, blockers). Only for the current user. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        yesterday: { type: "string", description: "What was worked on yesterday." },
        today: { type: "string", description: "What is planned for today." },
        blockers: {
          type: "string",
          description: "Blockers or issues; use 'none' when everything is fine.",
        },
      },
      required: ["yesterday", "today", "blockers"],
    },
  ),
  toolSpec(
    "get_schedule",
    "List the current standup schedules (name, time, weekdays, timezone, reminder).",
    { type: "object", properties: {} },
  ),
  toolSpec(
    "create_schedule",
    `Create a standup schedule. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique schedule name." },
        timeOfDay: { type: "string", description: "HH:mm 24-hour time." },
        weekdays: {
          type: "array",
          items: { type: "integer" },
          description: "0=Sunday..6=Saturday.",
        },
        timezone: { type: "string", description: "IANA timezone, e.g. Asia/Jakarta." },
        reminderMiddayTime: { type: "string", description: "Optional HH:mm \"siang\" reminder to whoever has not finished, e.g. 12:00." },
        reminderAfternoonTime: { type: "string", description: "Optional HH:mm \"sore\" reminder, e.g. 15:00." },
      },
      required: ["name", "timeOfDay", "weekdays"],
    },
  ),
  toolSpec(
    "update_schedule",
    `Update an existing standup schedule by id or name. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        id: { type: "string", description: "Schedule id (takes priority over name)." },
        name: { type: "string", description: "Current schedule name to find." },
        newName: { type: "string", description: "New name, only when renaming." },
        timeOfDay: { type: "string", description: "HH:mm 24-hour time." },
        weekdays: { type: "array", items: { type: "integer" }, description: "0=Sunday..6=Saturday." },
        timezone: { type: "string", description: "IANA timezone, e.g. Asia/Jakarta." },
        reminderMiddayTime: { type: "string", description: "HH:mm \"siang\" reminder to whoever has not finished (after the standup, before closeTime), or null to disable." },
        reminderAfternoonTime: { type: "string", description: "HH:mm \"sore\" reminder (after the siang one, before closeTime), or null to disable." },
        closeTime: { type: "string", description: "HH:mm when today's standup closes: reminders stop and unfinished ones count as missed. null to never close." },
        summaryTime: { type: "string", description: "HH:mm when admins get the list of who has not finished. null to disable." },
        isActive: { type: "boolean", description: "Enable or disable the schedule." },
      },
    },
  ),
  toolSpec(
    "delete_schedule",
    `Delete a standup schedule by name. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: { name: { type: "string", description: "Schedule name." } },
      required: ["name"],
    },
  ),
  toolSpec(
    "start_standup",
    `Send today's standup prompt now, to everyone or to one employee. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Optional employee name or phone; omit for everyone." },
      },
    },
  ),
  toolSpec(
    "send_standup_reminder",
    `Remind everyone who has not finished today's standup. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    { type: "object", properties: {} },
  ),
];
