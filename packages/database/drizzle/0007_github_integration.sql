CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_provider_delivery_uq" UNIQUE("provider","delivery_id")
);
--> statement-breakpoint
ALTER TABLE "tracked_repositories" DROP CONSTRAINT "tracked_repositories_full_name_unique";--> statement-breakpoint
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "tracked_repositories" ALTER COLUMN "installation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "external_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "actor_login" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "repository" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "repository_selection" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_repositories" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_repositories" ADD COLUMN "github_repo_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_repositories" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracked_repositories" ADD CONSTRAINT "tracked_repositories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_events_workspace_occurred_idx" ON "activity_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_external_uq" UNIQUE("workspace_id","provider","external_id");--> statement-breakpoint
ALTER TABLE "tracked_repositories" ADD CONSTRAINT "tracked_repositories_github_repo_id_unique" UNIQUE("github_repo_id");