import type { createDbClient } from "./client.js";
import { calendarSettings, schedules, workspaces } from "./schema/index.js";

type Db = ReturnType<typeof createDbClient>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Creates a workspace with its factory defaults: calendar settings and the
 * "standup" schedule (09:00 Mon-Fri, reminder 90 minutes later).
 */
export async function createWorkspace(db: Db | Tx, input: { name: string; ownerUserId?: string | null }) {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: input.name, ownerUserId: input.ownerUserId ?? null })
    .returning();
  if (!workspace) throw new Error("Failed to create workspace");

  await db.insert(calendarSettings).values({ workspaceId: workspace.id }).onConflictDoNothing();
  await db
    .insert(schedules)
    .values({
      workspaceId: workspace.id,
      name: "standup",
      timeOfDay: "09:00",
      weekdays: [1, 2, 3, 4, 5],
      timezone: "Asia/Jakarta",
      reminderMinutes: 30,
      reminderRepeatMinutes: 60,
      closeTime: "17:00",
      summaryTime: "11:00",
      isActive: true,
    })
    .onConflictDoNothing();
  return workspace;
}
