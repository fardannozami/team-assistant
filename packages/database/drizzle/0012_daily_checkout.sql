ALTER TABLE "standup_sessions" ADD COLUMN "checkout_status" text;--> statement-breakpoint
ALTER TABLE "standup_sessions" ADD COLUMN "checkout_at" timestamp with time zone;