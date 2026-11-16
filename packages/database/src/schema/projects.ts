import { pgTable, text, timestamp, uuid, date, numeric, unique, index } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { employees } from "./employees.js";
import { workspaceRef } from "./workspaces.js";

// Client projects and how their fee is split (entered by PMs on the web).
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    platform: text("platform").notNull(), // Upwork, Fiverr, Direct, ...
    name: text("name").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: text("status").notNull().default("ongoing"), // ongoing | completed | cancelled
    paymentType: text("payment_type").notNull().default("fixed"), // fixed | hourly
    currency: text("currency").notNull().default("USD"),
    // What actually arrived, after the platform's cut.
    feeReceived: numeric("fee_received", { precision: 14, scale: 2 }).notNull().default("0"),
    // The platform's cut, so the client-side price is feeReceived / (1 - cut).
    platformFeePercent: numeric("platform_fee_percent", { precision: 5, scale: 2 }).notNull().default("10"),
    // Amount split between members; null means the whole feeReceived.
    totalFee: numeric("total_fee", { precision: 14, scale: 2 }),
    paymentStatus: text("payment_status").notNull().default("pending"), // pending | accepted | paid
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("projects_workspace_idx").on(t.workspaceId)],
);

// Who worked on a project and their share of totalFee. PM & Sales split one
// 100% pool; designers and developers split another.
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Employees are only ever deactivated, so fee history keeps its people.
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    role: text("role").notNull(), // pm_sales | designer | developer
    sharePercent: numeric("share_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  },
  (t) => [unique("project_members_project_employee_role_uq").on(t.projectId, t.employeeId, t.role)],
);
