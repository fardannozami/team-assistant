ALTER TABLE "schedules" ADD COLUMN "reminder_repeat_minutes" integer;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "close_time" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "summary_time" text;