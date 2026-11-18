import type { ToolSpec } from "../client.js";
import { TOOL_DESCRIPTIONS, toolSpec } from "./shared.js";

export const WORKSPACE_SPECS: ToolSpec[] = [
  toolSpec(
    "get_team_activity",
    "Aggregated standup activity for active employees over the last 7 days: completed counts and recurring blockers. Manager/Admin only; no raw standings are returned.",
    { type: "object", properties: {} },
  ),
  toolSpec(
    "generate_daily_report",
    "Generate the daily standup report (submissions, blockers). Manager/Admin only.",
    {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date in YYYY-MM-DD; defaults to today." },
      },
    },
  ),
  toolSpec(
    "generate_weekly_report",
    "Generate the weekly standup report (daily completion, repeated blockers). Manager/Admin only.",
    { type: "object", properties: {} },
  ),
  toolSpec(
    "list_teams",
    "List teams with their member counts. Manager/Admin only.",
    { type: "object", properties: {} },
  ),
  toolSpec(
    "create_team",
    `Create a team. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
    },
  ),
  toolSpec(
    "update_team",
    `Rename a team or change its description. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        team: { type: "string", description: "Current team name." },
        name: { type: "string", description: "New name." },
        description: { type: "string" },
      },
      required: ["team"],
    },
  ),
  toolSpec(
    "delete_team",
    `Delete an empty team. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: { team: { type: "string", description: "Team name." } },
      required: ["team"],
    },
  ),
  toolSpec(
    "list_holidays",
    "Upcoming public holidays plus this workspace's own day-off / workday exceptions.",
    { type: "object", properties: {} },
  ),
  toolSpec(
    "add_calendar_exception",
    `Mark a date as a day off (no standup) or as a working day despite a holiday. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD." },
        skip: { type: "boolean", description: "true = day off (default), false = standup still runs." },
        reason: { type: "string" },
      },
      required: ["date"],
    },
  ),
  toolSpec(
    "delete_calendar_exception",
    `Remove this workspace's exception for a date. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
    {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD." } },
      required: ["date"],
    },
  ),
];
