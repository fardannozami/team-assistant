import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  boolean,
  integer,
  date,
  unique,
} from "drizzle-orm/pg-core";
import { employees } from "./employees.js";
import { workspaceRef } from "./workspaces.js";

// Recurring check-ins besides the daily standup, one config per kind per
// workspace: "checkout" (end-of-week questions) and "icebreaker" (start-of-week
// mood + motivation). Kept apart from `schedules`, which is standup-only.
export const checkinConfigs = pgTable(
  "checkin_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    kind: text("kind").notNull(), // checkout | icebreaker
    weekdays: jsonb("weekdays").notNull(), // number[], 0=Sunday .. 6=Saturday
    timeOfDay: text("time_of_day").notNull(), // HH:mm
    timezone: text("timezone").default("Asia/Jakarta").notNull(),
    reminderMinutes: integer("reminder_minutes"), // one reminder, minutes after the prompt
    closeTime: text("close_time"), // HH:mm: unfinished check-ins become "missed"
    questions: jsonb("questions").notNull(), // CheckinQuestion[]
    isActive: boolean("is_active").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("checkin_configs_workspace_kind_uq").on(t.workspaceId, t.kind)],
);

export const checkinSessions = pgTable(
  "checkin_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    configId: uuid("config_id")
      .notNull()
      .references(() => checkinConfigs.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    date: date("date").notNull(),
    status: text("status").default("pending").notNull(), // pending | in_progress | completed | missed
    // Snapshot at prompt time, so editing the config mid-week keeps answers aligned.
    questions: jsonb("questions").notNull(),
    motivation: text("motivation"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("checkin_sessions_employee_kind_date_uq").on(t.employeeId, t.kind, t.date)],
);

export const checkinAnswers = pgTable(
  "checkin_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => checkinSessions.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    answer: text("answer").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("checkin_answers_session_question_uq").on(t.sessionId, t.questionKey)],
);
