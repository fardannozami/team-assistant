import { pgTable, text, timestamp, uuid, jsonb, date } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").references(() => employees.id),
  provider: text("provider").notNull(), // github | figma
  type: text("type").notNull(),
  title: text("title"),
  url: text("url"),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const dailyActivitySummaries = pgTable("daily_activity_summaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").references(() => employees.id),
  date: date("date").notNull(),
  summary: jsonb("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
