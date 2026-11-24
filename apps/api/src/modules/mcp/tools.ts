import type { McpTool } from "./protocol.js";
import { listProjects } from "../projects/service.js";
import { listEmployees } from "../employees/service.js";
import { listStandupsByDate } from "../standups/service/progress.js";
import { standupToday } from "../standups/engine/store.js";
import { generateDailyReport, generateWeeklyReport } from "../reports/service.js";
import { listBriefingItems } from "../briefings/service.js";

// Read-only daily data for Hermes agents. Fees, shares and phone numbers stay
// out: agents only need who works on what.

export type McpContext = { workspaceId: string };

const json = (value: unknown) => ({ text: JSON.stringify(value, null, 1) });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateArg(args: Record<string, unknown>): string | undefined {
  const date = args.date;
  if (date === undefined || date === null || date === "") return undefined;
  if (typeof date !== "string" || !DATE.test(date)) throw new Error("date must be YYYY-MM-DD");
  return date;
}

const noInput = { type: "object" as const, properties: {} };
const dateInput = {
  type: "object" as const,
  properties: { date: { type: "string", description: "YYYY-MM-DD; default today (workspace timezone)" } },
};

/** Projects without fee figures. */
export async function projectSummaries(workspaceId: string, status?: string) {
  const rows = await listProjects(workspaceId);
  return rows
    .filter((p) => !status || p.status === status)
    .map((p) => ({
      name: p.name,
      platform: p.platform,
      type: p.type,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      members: p.members.map((m) => ({ name: m.employeeName, role: m.role })),
    }));
}

/** Active people with their ongoing projects and today's plan; idle = no ongoing project. */
export async function teamLoad(workspaceId: string, date: string) {
  const [people, projects, sessions] = await Promise.all([
    listEmployees(workspaceId, { active: true }),
    projectSummaries(workspaceId, "ongoing"),
    listStandupsByDate(workspaceId, date),
  ]);
  return people.map((person) => {
    const ongoing = projects.filter((p) => p.members.some((m) => m.name === person.name)).map((p) => p.name);
    const session = sessions.find((s) => s.employeeId === person.id);
    return {
      name: person.name,
      team: person.teamName,
      position: person.lead,
      ongoingProjects: ongoing,
      todayPlan: session?.answers.today ?? null,
      blockers: session?.answers.blockers ?? null,
      idle: ongoing.length === 0,
    };
  });
}

export const MCP_TOOLS: McpTool<McpContext>[] = [
  {
    name: "list_projects",
    description: "Client projects with platform, type, status, dates and members (name and role). No fees.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["ongoing", "completed", "cancelled"] } },
    },
    run: async (args, { workspaceId }) =>
      json(await projectSummaries(workspaceId, typeof args.status === "string" ? args.status : undefined)),
  },
  {
    name: "list_team",
    description: "Active team members with team, role and position (pm_sales, design, development, …). No phone numbers.",
    inputSchema: noInput,
    run: async (_args, { workspaceId }) =>
      json(
        (await listEmployees(workspaceId, { active: true })).map((e) => ({
          name: e.name,
          team: e.teamName,
          role: e.roleName,
          position: e.lead,
          shift: e.shift,
        })),
      ),
  },
  {
    name: "standup_today",
    description: "Standup answers for a day: yesterday, today, done and blockers per person.",
    inputSchema: dateInput,
    run: async (args, { workspaceId }) => {
      const date = dateArg(args) ?? (await standupToday(workspaceId));
      const sessions = await listStandupsByDate(workspaceId, date);
      return json({
        date,
        standups: sessions.map((s) => ({ name: s.employeeName, team: s.teamName, status: s.status, answers: s.answers })),
      });
    },
  },
  {
    name: "daily_report",
    description: "The daily standup report: who submitted, blockers and GitHub activity.",
    inputSchema: dateInput,
    run: async (args, { workspaceId }) => ({ text: (await generateDailyReport(workspaceId, dateArg(args))).text }),
  },
  {
    name: "weekly_report",
    description: "The last seven days of standups: submissions per day and repeated blockers.",
    inputSchema: noInput,
    run: async (_args, { workspaceId }) => ({ text: (await generateWeeklyReport(workspaceId)).text }),
  },
  {
    name: "idle_members",
    description:
      "Who has capacity: every active member with their ongoing projects and today's plan; idle=true means no ongoing project (bench time).",
    inputSchema: dateInput,
    run: async (args, { workspaceId }) => {
      const date = dateArg(args) ?? (await standupToday(workspaceId));
      const load = await teamLoad(workspaceId, date);
      return json({ date, idle: load.filter((p) => p.idle), busy: load.filter((p) => !p.idle) });
    },
  },
  {
    name: "list_leads",
    description: "Leads and news from the pre-standup briefings (newest first).",
    inputSchema: {
      type: "object",
      properties: {
        audience: { type: "string", enum: ["sales", "design", "dev"] },
        status: { type: "string", enum: ["new", "sent", "claimed", "dismissed", "won"] },
        limit: { type: "number", description: "1-100, default 30" },
      },
    },
    run: async (args, { workspaceId }) => {
      const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
      const rows = await listBriefingItems(workspaceId, {
        audience: typeof args.audience === "string" ? args.audience : undefined,
        status: typeof args.status === "string" ? args.status : undefined,
        limit,
      });
      return json(
        rows.map((r) => ({
          type: r.type,
          title: r.title,
          url: r.url,
          source: r.source,
          country: r.country,
          budget: r.budget,
          score: r.score,
          summary: r.summary,
          pitch: r.pitch,
          status: r.status,
          date: r.createdAt,
        })),
      );
    },
  },
];
