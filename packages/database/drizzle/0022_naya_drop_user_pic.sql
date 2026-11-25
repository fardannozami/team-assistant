ALTER TABLE "naya_cards" DROP CONSTRAINT "naya_cards_pic_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "naya_checklist_items" DROP CONSTRAINT "naya_checklist_items_pic_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "naya_cards" DROP COLUMN IF EXISTS "pic_user_id";--> statement-breakpoint
ALTER TABLE "naya_checklist_items" DROP COLUMN IF EXISTS "pic_user_id";