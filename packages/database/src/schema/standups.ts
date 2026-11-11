import { pgTable, text, timestamp, uuid, date, unique } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";
import { workspaceRef } from "./workspaces.js";

export const standupSessions = pgTable(
  "standup_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: text("status").default("pending").notNull(), // pending | in_progress | completed
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique("standup_sessions_employee_date_uq").on(t.employeeId, t.date)],
);

export const standups = pgTable(
  "standups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    sessionId: uuid("session_id").references(() => standupSessions.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique("standups_employee_date_uq").on(t.employeeId, t.date)],
);

export const standupAnswers = pgTable(
  "standup_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    standupId: uuid("standup_id")
      .notNull()
      .references(() => standups.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(), // yesterday | today | blockers
    answer: text("answer").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("standup_answers_standup_question_uq").on(
      t.standupId,
      t.questionKey,
    ),
  ],
);
