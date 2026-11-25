ALTER TABLE "naya_cards" ADD COLUMN "pic_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "naya_cards" ADD COLUMN "pic_pool" text;--> statement-breakpoint
ALTER TABLE "naya_cards" ADD COLUMN "continues_from" text;--> statement-breakpoint
ALTER TABLE "naya_cards" ADD COLUMN "continued_to" text;--> statement-breakpoint
ALTER TABLE "naya_cards" ADD COLUMN "continued_step" text;--> statement-breakpoint
ALTER TABLE "naya_checklist_items" ADD COLUMN "pic_employee_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_cards" ADD CONSTRAINT "naya_cards_pic_employee_id_employees_id_fk" FOREIGN KEY ("pic_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "naya_checklist_items" ADD CONSTRAINT "naya_checklist_items_pic_employee_id_employees_id_fk" FOREIGN KEY ("pic_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Cards made before PICs were team members: let the most available sales/PM member pick them up.
UPDATE "naya_cards" SET "pic_pool" = 'review' WHERE "pic_employee_id" IS NULL AND "continues_from" IS NULL;
