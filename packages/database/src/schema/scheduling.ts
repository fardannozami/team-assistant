import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  boolean,
  integer,
  unique,
} from "drizzle-orm/pg-core";

export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    cronExpression: text("cron_expression"),
    weekdays: jsonb("weekdays"), // number[], cron convention 0=Sunday .. 6=Saturday
    timeOfDay: text("time_of_day"), // HH:mm
    timezone: text("timezone").default("Asia/Jakarta").notNull(),
    reminderMinutes: integer("reminder_minutes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique("schedules_name_uq").on(t.name)],
);

export const scheduledJobs = pgTable("scheduled_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  scheduleId: uuid("schedule_id").references(() => schedules.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  payload: jsonb("payload"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: text("status").default("pending").notNull(), // pending | running | completed | failed
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobExecutions = pgTable("job_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").references(() => scheduledJobs.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
