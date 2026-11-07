import { pgTable, text, timestamp, uuid, jsonb, date } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";

export const standupSessions = pgTable("standup_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: text("status").default("pending").notNull(), // pending | in_progress | completed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const standups = pgTable("standups", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").references(() => standupSessions.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const standupAnswers = pgTable("standup_answers", {
  id: uuid("id").defaultRandom().primaryKey(),
  standupId: uuid("standup_id").notNull().references(() => standups.id, { onDelete: "cascade" }),
  questionKey: text("question_key").notNull(), // yesterday | today | blockers
  answer: text("answer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
