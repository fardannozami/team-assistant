ALTER TABLE "naya_cards" ADD COLUMN "next_step" text;--> statement-breakpoint
ALTER TABLE "naya_cards" ADD COLUMN "next_pic_employee_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_cards" ADD CONSTRAINT "naya_cards_next_pic_employee_id_employees_id_fk" FOREIGN KEY ("next_pic_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
