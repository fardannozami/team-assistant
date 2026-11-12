CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_configs" DROP CONSTRAINT "agent_configs_key_unique";--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_phone_unique";--> statement-breakpoint
ALTER TABLE "schedules" DROP CONSTRAINT "schedules_name_uq";--> statement-breakpoint
ALTER TABLE "whatsapp_messages" DROP CONSTRAINT "whatsapp_messages_message_id_unique";--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_exceptions" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "standup_sessions" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "standups" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "tracked_figma_files" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD COLUMN "bot_phone" text;--> statement-breakpoint
-- Backfill: move all existing (single-tenant) data into one default workspace
-- owned by the oldest user. Does nothing on an empty database.
DO $$
DECLARE
  ws uuid;
  owner uuid;
  t text;
  has_data boolean := false;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_configs', 'agent_memories', 'ai_usage_logs', 'calendar_exceptions', 'calendar_settings', 'conversations', 'employees', 'github_installations', 'integrations', 'reports', 'scheduled_jobs', 'schedules', 'standup_sessions', 'standups', 'teams', 'tracked_figma_files', 'users', 'whatsapp_messages', 'whatsapp_sessions', 'audit_logs'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO has_data;
    EXIT WHEN has_data;
  END LOOP;
  IF NOT has_data THEN
    RETURN;
  END IF;

  SELECT id INTO owner FROM users ORDER BY created_at LIMIT 1;
  INSERT INTO workspaces (name, owner_user_id) VALUES ('Default workspace', owner) RETURNING id INTO ws;
  IF owner IS NOT NULL THEN
    UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'Owner') WHERE id = owner;
  END IF;

  -- calendar_settings was an implicit singleton: keep only the newest row.
  DELETE FROM calendar_settings WHERE id <> (SELECT id FROM calendar_settings ORDER BY updated_at DESC LIMIT 1);
  -- whatsapp_sessions was unused; replace it with a marker for the legacy session directory.
  DELETE FROM whatsapp_sessions;

  FOREACH t IN ARRAY ARRAY['agent_configs', 'agent_memories', 'ai_usage_logs', 'calendar_exceptions', 'calendar_settings', 'conversations', 'employees', 'github_installations', 'integrations', 'reports', 'scheduled_jobs', 'schedules', 'standup_sessions', 'standups', 'teams', 'tracked_figma_files', 'users', 'whatsapp_messages', 'whatsapp_sessions', 'audit_logs'] LOOP
    EXECUTE format('UPDATE %I SET workspace_id = $1 WHERE workspace_id IS NULL', t) USING ws;
  END LOOP;

  INSERT INTO calendar_settings (workspace_id) SELECT ws WHERE NOT EXISTS (SELECT 1 FROM calendar_settings);
  INSERT INTO schedules (workspace_id, name, time_of_day, weekdays, timezone, reminder_minutes, is_active)
    SELECT ws, 'standup', '09:00', '[1,2,3,4,5]'::jsonb, 'Asia/Jakarta', 90, true
    WHERE NOT EXISTS (SELECT 1 FROM schedules WHERE name = 'standup');
  INSERT INTO whatsapp_sessions (workspace_id, session_key, is_active) VALUES (ws, 'legacy', true);
END $$;
--> statement-breakpoint
ALTER TABLE "agent_configs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_memories" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_exceptions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_settings" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "github_installations" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "standup_sessions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "standups" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_figma_files" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_exceptions" ADD CONSTRAINT "calendar_exceptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employees" ADD CONSTRAINT "employees_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standup_sessions" ADD CONSTRAINT "standup_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standups" ADD CONSTRAINT "standups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracked_figma_files" ADD CONSTRAINT "tracked_figma_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_workspace_idx" ON "employees" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_workspace_key_uq" UNIQUE("workspace_id","key");--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_workspace_id_unique" UNIQUE("workspace_id");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_workspace_phone_uq" UNIQUE("workspace_id","phone");--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workspace_name_uq" UNIQUE("workspace_id","name");--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_workspace_message_uq" UNIQUE("workspace_id","message_id");--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_workspace_id_unique" UNIQUE("workspace_id");