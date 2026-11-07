import { pgTable, text, timestamp, uuid, boolean, date, jsonb } from "drizzle-orm/pg-core";

export const holidays = pgTable("holidays", {
  id: uuid("id").defaultRandom().primaryKey(),
  date: date("date").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // national | joint
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const calendarSettings = pgTable("calendar_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
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
  date: date("date").notNull(),
  reason: text("reason"),
  skip: boolean("skip").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
