import { pgTable, text, timestamp, uuid, jsonb, boolean } from "drizzle-orm/pg-core";

export const trackedFigmaFiles = pgTable("tracked_figma_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileKey: text("file_key").notNull().unique(),
  name: text("name"),
  teamId: text("team_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
