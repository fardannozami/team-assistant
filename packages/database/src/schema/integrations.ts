import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";

// Per-employee provider identity, e.g. a GitHub login (external_id).
export const employeeIntegrations = pgTable("employee_integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
