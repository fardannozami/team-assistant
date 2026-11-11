import { pgTable, text, timestamp, boolean, uuid, unique, index } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { workspaceRef } from "./workspaces.js";

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const employees = pgTable("employees", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  userId: uuid("user_id").references(() => users.id),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  teamId: uuid("team_id").references(() => teams.id),
  roleId: uuid("role_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique("employees_workspace_phone_uq").on(t.workspaceId, t.phone),
  index("employees_workspace_idx").on(t.workspaceId),
]);

export const teamMembers = pgTable("team_members", {
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
});
