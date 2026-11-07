ALTER TABLE "standup_answers" ADD CONSTRAINT "standup_answers_standup_question_uq" UNIQUE("standup_id","question_key");--> statement-breakpoint
ALTER TABLE "standup_sessions" ADD CONSTRAINT "standup_sessions_employee_date_uq" UNIQUE("employee_id","date");--> statement-breakpoint
ALTER TABLE "standups" ADD CONSTRAINT "standups_employee_date_uq" UNIQUE("employee_id","date");