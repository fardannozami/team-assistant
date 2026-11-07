import { pgTable, text, timestamp, uuid, jsonb, date } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(), // daily | weekly
  date: date("date").notNull(),
  scope: text("scope"), // team | company
  teamId: uuid("team_id"),
  content: jsonb("content"),
  generatedBy: uuid("generated_by").references(() => employees.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
