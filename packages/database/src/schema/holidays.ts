import { pgTable, text, timestamp, uuid, boolean, date, jsonb } from "drizzle-orm/pg-core";
import { workspaceRef } from "./workspaces.js";

export const holidays = pgTable("holidays", {
  id: uuid("id").defaultRandom().primaryKey(),
  date: date("date").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // national | joint
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Public holiday data stays global; settings and exceptions are per workspace.
export const calendarSettings = pgTable("calendar_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef().unique(),
  country: text("country").default("ID").notNull(),
  timezone: text("timezone").default("Asia/Jakarta").notNull(),
  skipWeekends: boolean("skip_weekends").default(true).notNull(),
  skipNationalHolidays: boolean("skip_national_holidays").default(true).notNull(),
  skipJointHolidays: boolean("skip_joint_holidays").default(true).notNull(),
  config: jsonb("config"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const calendarExceptions = pgTable("calendar_exceptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  date: date("date").notNull(),
  reason: text("reason"),
  skip: boolean("skip").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
