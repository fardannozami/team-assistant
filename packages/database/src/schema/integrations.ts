import { pgTable, text, timestamp, uuid, jsonb, boolean } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";

export const integrations = pgTable("integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(), // github | figma
  name: text("name"),
  config: jsonb("config"),
  credentials: text("credentials"), // encrypted
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const employeeIntegrations = pgTable("employee_integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const integrationCredentials = pgTable("integration_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").notNull(), // encrypted
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
