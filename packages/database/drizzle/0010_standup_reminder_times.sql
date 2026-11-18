ALTER TABLE "schedules" ADD COLUMN "reminder_midday_time" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "reminder_afternoon_time" text;--> statement-breakpoint
-- Standup reminders become two clock times (siang, sore): schedules that had
-- reminders on get 12:00 and 15:00 wherever they fit between prompt and close.
UPDATE "schedules" SET "reminder_midday_time" = '12:00'
WHERE "reminder_minutes" > 0 AND "time_of_day" < '12:00' AND ("close_time" IS NULL OR "close_time" > '12:00');--> statement-breakpoint
UPDATE "schedules" SET "reminder_afternoon_time" = '15:00'
WHERE "reminder_minutes" > 0 AND "time_of_day" < '15:00' AND ("close_time" IS NULL OR "close_time" > '15:00');--> statement-breakpoint
ALTER TABLE "schedules" DROP COLUMN IF EXISTS "reminder_minutes";--> statement-breakpoint
ALTER TABLE "schedules" DROP COLUMN IF EXISTS "reminder_repeat_minutes";
