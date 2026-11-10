import { createDbClient, employees, standupAnswers, standupSessions, standups } from "@repo/database";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { dateInTimezone, DEFAULT_TIMEZONE } from "@repo/shared";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export async function generateDailyReport(date?: string) {
  const d = date ?? dateInTimezone();
  const rows = await db
    .select({
      sessionId: standupSessions.id,
      status: standupSessions.status,
      employeeId: employees.id,
      employeeName: employees.name,
      standupId: standups.id,
      questionKey: standupAnswers.questionKey,
      answer: standupAnswers.answer,
    })
    .from(standupSessions)
    .innerJoin(employees, eq(standupSessions.employeeId, employees.id))
    .leftJoin(standups, eq(standups.sessionId, standupSessions.id))
    .leftJoin(standupAnswers, eq(standupAnswers.standupId, standups.id))
    .where(and(eq(standupSessions.date, d), eq(employees.isActive, true)));

  const byEmployee = new Map<
    string,
    { name: string; status: string; answers: Record<string, string> }
  >();
  for (const r of rows) {
    const entry = byEmployee.get(r.employeeId) ?? {
      name: r.employeeName,
      status: r.status,
      answers: {},
    };
    if (r.questionKey && r.answer) entry.answers[r.questionKey] = r.answer;
    byEmployee.set(r.employeeId, entry);
  }

  const allEmployees = await db
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(eq(employees.isActive, true));

  const submitted = [...byEmployee.entries()]
    .filter(([, v]) => v.status === "completed")
    .map(([id, v]) => ({ id, name: v.name, answers: v.answers }));
  const notSubmitted = allEmployees
    .filter((e) => !byEmployee.has(e.id) || byEmployee.get(e.id)!.status !== "completed")
    .map((e) => e.name);

  const blockers = submitted
    .map((s) => ({ name: s.name, blocker: s.answers.blockers }))
    .filter((b) => b.blocker && b.blocker.toLowerCase() !== "none");

  const lines = [
    `Daily Report - ${d}`,
    `Submitted: ${submitted.length}/${allEmployees.length}`,
    "",
    "Submitted:",
    ...submitted.map((s) => `- ${s.name}: ${s.answers.today ?? "-"}`),
    "",
    "Not submitted:",
    ...(notSubmitted.length ? notSubmitted.map((n) => `- ${n}`) : ["- none"]),
    "",
    "Blockers:",
    ...(blockers.length
      ? blockers.map((b) => `- ${b.name}: ${b.blocker}`)
      : ["- none"]),
  ];

  return {
    date: d,
    total: allEmployees.length,
    submittedCount: submitted.length,
    notSubmittedCount: notSubmitted.length,
    submitted,
    notSubmitted,
    blockers,
    text: lines.join("\n"),
  };
}

export async function generateWeeklyReport() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const startStr = dateInTimezone(DEFAULT_TIMEZONE, start);
  const endStr = dateInTimezone(DEFAULT_TIMEZONE, end);

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
    .leftJoin(standups, eq(standups.sessionId, standupSessions.id))
    .leftJoin(standupAnswers, eq(standupAnswers.standupId, standups.id))
    .where(
      and(
        gte(standupSessions.date, startStr),
        lte(standupSessions.date, endStr),
        eq(employees.isActive, true),
      ),
    );

  const byDate = new Map<string, { submitted: number; total: Set<string> }>();
  const blockersCount = new Map<string, number>();
  for (const r of rows) {
    const entry = byDate.get(r.date) ?? { submitted: 0, total: new Set() };
    entry.total.add(r.employeeId);
    if (r.status === "completed") entry.submitted++;
    byDate.set(r.date, entry);
    if (r.questionKey === "blockers" && r.answer && r.answer.toLowerCase() !== "none") {
      blockersCount.set(r.answer, (blockersCount.get(r.answer) ?? 0) + 1);
    }
  }

  const lines = [
    `Weekly Report - ${startStr} to ${endStr}`,
    "",
    "Daily completion:",
    ...[...byDate.entries()]
      .sort()
      .map(([d, v]) => `- ${d}: ${v.submitted}/${v.total.size}`),
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
      submitted: v.submitted,
      total: v.total.size,
    })),
    repeatedBlockers: [...blockersCount.entries()].map(([blocker, count]) => ({
      blocker,
      count,
    })),
    text: lines.join("\n"),
  };
}