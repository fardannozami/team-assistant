CREATE TABLE IF NOT EXISTS "checkin_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_answers_session_question_uq" UNIQUE("session_id","question_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checkin_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"weekdays" jsonb NOT NULL,
	"time_of_day" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"reminder_minutes" integer,
	"close_time" text,
	"questions" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_configs_workspace_kind_uq" UNIQUE("workspace_id","kind")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checkin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"config_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"questions" jsonb NOT NULL,
	"motivation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_sessions_employee_kind_date_uq" UNIQUE("employee_id","kind","date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkin_answers" ADD CONSTRAINT "checkin_answers_session_id_checkin_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."checkin_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkin_configs" ADD CONSTRAINT "checkin_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkin_sessions" ADD CONSTRAINT "checkin_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkin_sessions" ADD CONSTRAINT "checkin_sessions_config_id_checkin_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."checkin_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkin_sessions" ADD CONSTRAINT "checkin_sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
