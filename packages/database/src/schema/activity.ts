import { pgTable, text, timestamp, uuid, jsonb, date, unique, index } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";
import { workspaceRef } from "./workspaces.js";

// Normalized activity timeline (GIT-008). Observed activity, never a score.
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    // Null when the actor is not mapped to an employee: no attribution without evidence.
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    provider: text("provider").notNull(), // github | figma
    type: text("type").notNull(), // commit | pr_opened | pr_merged | pr_reviewed | issue_opened | ...
    // Stable per provider object + action, e.g. "commit:<repoId>:<sha>"; dedupes across deliveries.
    externalId: text("external_id").notNull(),
    actorLogin: text("actor_login"), // provider-authenticated login, kept for later mapping
    repository: text("repository"),
    title: text("title"),
    url: text("url"),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("activity_events_workspace_external_uq").on(t.workspaceId, t.provider, t.externalId),
    index("activity_events_workspace_occurred_idx").on(t.workspaceId, t.occurredAt),
  ],
);

export const dailyActivitySummaries = pgTable("daily_activity_summaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").references(() => employees.id),
  date: date("date").notNull(),
  summary: jsonb("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
