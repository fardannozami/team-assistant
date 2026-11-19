import { pgTable, text, timestamp, uuid, date, numeric, unique, index } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { employees } from "./employees.js";
import { projects } from "./projects.js";
import { workspaceRef } from "./workspaces.js";

// Bonus fees (T&C Bonus): projects ending before startDate were paid outside
// the app and never carry over.
export const feeSettings = pgTable("fee_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef().unique(),
  startDate: date("start_date"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One finalized bonus for one person and group (pm | maker | lead_design |
// lead_development) over the projects in its items.
export const feePayouts = pgTable(
  "fee_payouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    group: text("group").notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    base: numeric("base", { precision: 14, scale: 2 }).notNull(),
    percent: numeric("percent", { precision: 5, scale: 2 }).notNull(),
    bonus: numeric("bonus", { precision: 14, scale: 2 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("fee_payouts_workspace_employee_idx").on(t.workspaceId, t.employeeId)],
);

// The amounts a payout covered: a project is paid once per person and group.
export const feePayoutItems = pgTable(
  "fee_payout_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payoutId: uuid("payout_id")
      .notNull()
      .references(() => feePayouts.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    group: text("group").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [unique("fee_payout_items_employee_group_project_uq").on(t.employeeId, t.group, t.projectId)],
);
