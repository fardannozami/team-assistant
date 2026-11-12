import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";

// A tenant: each account that signs up gets its own workspace, with its own
// WhatsApp bot, employees, schedules and reports.
export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // No FK: users.workspace_id already references workspaces.
  ownerUserId: uuid("owner_user_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceRef = () =>
  uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" });
