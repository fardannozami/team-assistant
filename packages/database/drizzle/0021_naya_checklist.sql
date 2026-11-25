CREATE TABLE IF NOT EXISTS "naya_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board" text DEFAULT '' NOT NULL,
	"task_id" text NOT NULL,
	"pic_user_id" uuid,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "naya_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board" text DEFAULT '' NOT NULL,
	"task_id" text NOT NULL,
	"source_task_id" text,
	"title" text NOT NULL,
	"pic_user_id" uuid,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"handed_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "naya_learned_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent" text,
	"rule_text" text NOT NULL,
	"source_item_id" uuid,
	"status" text DEFAULT 'candidate' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_cards" ADD CONSTRAINT "naya_cards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_cards" ADD CONSTRAINT "naya_cards_pic_user_id_users_id_fk" FOREIGN KEY ("pic_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_cards" ADD CONSTRAINT "naya_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_checklist_items" ADD CONSTRAINT "naya_checklist_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_checklist_items" ADD CONSTRAINT "naya_checklist_items_pic_user_id_users_id_fk" FOREIGN KEY ("pic_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_checklist_items" ADD CONSTRAINT "naya_checklist_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_learned_rules" ADD CONSTRAINT "naya_learned_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_learned_rules" ADD CONSTRAINT "naya_learned_rules_source_item_id_naya_checklist_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."naya_checklist_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_learned_rules" ADD CONSTRAINT "naya_learned_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "naya_cards_task_unique" ON "naya_cards" USING btree ("workspace_id","board","task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "naya_checklist_items_task_idx" ON "naya_checklist_items" USING btree ("workspace_id","board","task_id");