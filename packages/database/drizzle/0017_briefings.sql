CREATE TABLE IF NOT EXISTS "agency_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"services" text[] DEFAULT '{}' NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"excluded_keywords" text[] DEFAULT '{}' NOT NULL,
	"target_countries" text[] DEFAULT '{}' NOT NULL,
	"min_budget_usd" integer,
	"tenders_enabled" boolean DEFAULT true NOT NULL,
	"offset_minutes" integer DEFAULT 30 NOT NULL,
	"items_per_briefing" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_profiles_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "briefing_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid,
	"audience" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"summary" text,
	"score" integer,
	"country" text,
	"budget" text,
	"pitch" text,
	"status" text DEFAULT 'new' NOT NULL,
	"claimed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefing_items_workspace_url_uq" UNIQUE("workspace_id","url")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "briefing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"date" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"model" text,
	"candidates" integer,
	"items" integer,
	"sent" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_profiles" ADD CONSTRAINT "agency_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "briefing_items" ADD CONSTRAINT "briefing_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "briefing_items" ADD CONSTRAINT "briefing_items_run_id_briefing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."briefing_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "briefing_items" ADD CONSTRAINT "briefing_items_claimed_by_employees_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "briefing_runs" ADD CONSTRAINT "briefing_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefing_items_workspace_audience_idx" ON "briefing_items" USING btree ("workspace_id","audience","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefing_runs_workspace_date_idx" ON "briefing_runs" USING btree ("workspace_id","date");