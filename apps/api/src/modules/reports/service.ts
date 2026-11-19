import { createDbClient, employees, roles, standupAnswers, standupSessions, standups } from "@repo/database";
import { and, eq, gte, isNull, lte, notInArray, or } from "drizzle-orm";
import { describeCounts, recentCommits } from "../github/digest.js";
import { standupActivity } from "../github/service.js";
import { standupToday } from "../standups/engine.js";
import { isNoBlocker } from "@repo/shared";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export async function generateDailyReport(workspaceId: string, date?: string) {
  const d = date ?? (await standupToday(workspaceId));
  const rows = await db
    .select({
      sessionId: standupSessions.id,
      status: standupSessions.status,
      checkoutStatus: standupSessions.checkoutStatus,
      employeeId: employees.id,
      employeeName: employees.name,
      standupId: standups.id,
      questionKey: standupAnswers.questionKey,
      answer: standupAnswers.answer,
    })
    .from(standupSessions)
    .innerJoin(employees, eq(standupSessions.employeeId, employees.id))
    .leftJoin(roles, eq(employees.roleId, roles.id))
    .leftJoin(standups, eq(standups.sessionId, standupSessions.id))
    .leftJoin(standupAnswers, eq(standupAnswers.standupId, standups.id))
    .where(
      and(
        eq(standupSessions.workspaceId, workspaceId),
        eq(employees.workspaceId, workspaceId),
        eq(standupSessions.date, d),
        eq(employees.isActive, true),
        or(isNull(roles.name), notInArray(roles.name, ["Owner", "Admin"])),
      ),
    );

  const byEmployee = new Map<
    string,
    { name: string; status: string; checkoutStatus: string | null; answers: Record<string, string> }
  >();
  for (const r of rows) {
    const entry = byEmployee.get(r.employeeId) ?? {
      name: r.employeeName,
      status: r.status,
      checkoutStatus: r.checkoutStatus,
      answers: {},
    };
    if (r.questionKey && r.answer) entry.answers[r.questionKey] = r.answer;
    byEmployee.set(r.employeeId, entry);
  }

  const allEmployees = await db
    .select({ id: employees.id, name: employees.name, shift: employees.shift })
    .from(employees)
    .leftJoin(roles, eq(employees.roleId, roles.id))
    .where(
      and(
        eq(employees.workspaceId, workspaceId),
        eq(employees.isActive, true),
        or(isNull(roles.name), notInArray(roles.name, ["Owner", "Admin"])),
      ),
    );

  // GitHub activity behind each standup's "kemarin" (GIT-008 timeline).
  const activity = await standupActivity(
    workspaceId,
    d,
    allEmployees.map((e) => e.id),
  );
  const github = allEmployees
    .filter((e) => activity.byEmployee.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      counts: activity.byEmployee.get(e.id)!.counts,
      summary: describeCounts(activity.byEmployee.get(e.id)!.counts),
      recentCommits: recentCommits(activity.byEmployee.get(e.id)!.items),
    }));

  const submitted = [...byEmployee.entries()]
    .filter(([, v]) => v.status === "completed")
    .map(([id, v]) => ({ id, name: v.name, answers: v.answers }));
  // The night shift starts in the evening: no session yet is not "not submitted".
  const notSubmitted = allEmployees
    .filter((e) => (byEmployee.has(e.id) ? byEmployee.get(e.id)!.status !== "completed" : e.shift !== "night"))
    .map((e) => e.name);

  // Checkout: the work done today and its blockers.
  const checkedOut = [...byEmployee.entries()]
    .filter(([, v]) => v.checkoutStatus === "completed")
    .map(([id, v]) => ({ id, name: v.name, done: v.answers.done ?? "-", blockers: v.answers.blockers ?? null }));
  const notCheckedOut = [...byEmployee.values()]
    .filter((v) => v.checkoutStatus && v.checkoutStatus !== "completed")
    .map((v) => v.name);

  const blockers = [...byEmployee.values()]
    .filter((v) => v.answers.blockers && !isNoBlocker(v.answers.blockers))
    .map((v) => ({ name: v.name, blocker: v.answers.blockers! }));
  const indent = (text: string) => text.split("\n").map((l) => `  ${l}`).join("\n");

  const lines = [
    `Daily Report - ${d}`,
    `Submitted: ${submitted.length}/${allEmployees.length}`,
    "",
    "Rencana hari ini:",
    ...submitted.map((s) => `- ${s.name}: ${s.answers.today ?? "-"}`),
    "",
    "Not submitted:",
    ...(notSubmitted.length ? notSubmitted.map((n) => `- ${n}`) : ["- none"]),
    "",
    `Checkout: ${checkedOut.length}/${allEmployees.length}`,
    ...checkedOut.map((c) => `- ${c.name}:\n${indent(c.done)}`),
    ...(notCheckedOut.length ? ["Belum checkout:", ...notCheckedOut.map((n) => `- ${n}`)] : []),
    "",
    "Blockers:",
    ...(blockers.length
      ? blockers.map((b) => `- ${b.name}: ${b.blocker}`)
      : ["- none"]),
    "",
    `GitHub activity (since ${activity.from}):`,
    ...(github.length
      ? github.flatMap((g) => [
          `- ${g.name}: ${g.summary}`,
          ...g.recentCommits.map(
            (c) => `  • ${[c.hash, c.title].filter(Boolean).join(" ")}${c.url ? ` - ${c.url}` : ""}`,
          ),
        ])
      : ["- none"]),
  ];

  return {
    date: d,
    githubSince: activity.from,
    github,
    total: allEmployees.length,
    submittedCount: submitted.length,
    notSubmittedCount: notSubmitted.length,
    submitted,
    notSubmitted,
    checkedOut,
    notCheckedOut,
    blockers,
    text: lines.join("\n"),
  };
}

export async function generateWeeklyReport(workspaceId: string) {
  // The last 7 days in the workspace's standup timezone, today included.
  const endStr = await standupToday(workspaceId);
  const start = new Date(`${endStr}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const startStr = start.toISOString().slice(0, 10);

  const rows = await db
    .select({
      date: standupSessions.date,
      status: standupSessions.status,
      employeeId: employees.id,
      employeeName: employees.name,
      questionKey: standupAnswers.questionKey,
      answer: standupAnswers.answer,
    })
    .from(standupSessions)
    .innerJoin(employees, eq(standupSessions.employeeId, employees.id))
    .leftJoin(roles, eq(employees.roleId, roles.id))
    .leftJoin(standups, eq(standups.sessionId, standupSessions.id))
    .leftJoin(standupAnswers, eq(standupAnswers.standupId, standups.id))
    .where(
      and(
        eq(standupSessions.workspaceId, workspaceId),
        eq(employees.workspaceId, workspaceId),
        gte(standupSessions.date, startStr),
        lte(standupSessions.date, endStr),
        eq(employees.isActive, true),
        // Same people as the daily report.
        or(isNull(roles.name), notInArray(roles.name, ["Owner", "Admin"])),
      ),
    );

  // One row per answer: count people, not rows.
  const byDate = new Map<string, { submitted: Set<string>; total: Set<string> }>();
  const blockersCount = new Map<string, number>();
  for (const r of rows) {
    const entry = byDate.get(r.date) ?? { submitted: new Set(), total: new Set() };
    entry.total.add(r.employeeId);
    if (r.status === "completed") entry.submitted.add(r.employeeId);
    byDate.set(r.date, entry);
    if (r.questionKey === "blockers" && r.answer && !isNoBlocker(r.answer)) {
      blockersCount.set(r.answer, (blockersCount.get(r.answer) ?? 0) + 1);
    }
  }

  const lines = [
    `Weekly Report - ${startStr} to ${endStr}`,
    "",
    "Daily completion:",
    ...[...byDate.entries()]
      .sort()
      .map(([d, v]) => `- ${d}: ${v.submitted.size}/${v.total.size}`),
    "",
    "Repeated blockers:",
    ...(blockersCount.size
      ? [...blockersCount.entries()].map(([b, c]) => `- ${b} (${c}x)`)
      : ["- none"]),
  ];

  return {
    start: startStr,
    end: endStr,
    days: [...byDate.entries()].map(([date, v]) => ({
      date,
      submitted: v.submitted.size,
      total: v.total.size,
    })),
    repeatedBlockers: [...blockersCount.entries()].map(([blocker, count]) => ({
      blocker,
      count,
    })),
    text: lines.join("\n"),
  };
}