-- Tables and columns nothing reads (or only ever wrote): see the audit in the commit message.
ALTER TABLE "employee_integrations" DROP CONSTRAINT IF EXISTS "employee_integrations_integration_id_integrations_id_fk";--> statement-breakpoint
DROP TABLE IF EXISTS "admins" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "agent_memories" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "daily_activity_summaries" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration_credentials" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integrations" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "role_permissions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "permissions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "reports" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "team_members" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tracked_figma_files" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "whatsapp_messages" CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_messages" DROP COLUMN IF EXISTS "metadata";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "ended_at";--> statement-breakpoint
ALTER TABLE "employee_integrations" DROP COLUMN IF EXISTS "integration_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" DROP COLUMN IF EXISTS "auth_state";
