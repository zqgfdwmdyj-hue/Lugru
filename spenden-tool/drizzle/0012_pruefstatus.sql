ALTER TABLE "event_items" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "event_items" ADD COLUMN "unit_count" integer;--> statement-breakpoint
ALTER TABLE "event_items" ADD COLUMN "price_source" text;--> statement-breakpoint
ALTER TABLE "event_items" ADD COLUMN "price_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_items" ADD COLUMN "price_over_photo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "mhd_mode" text;--> statement-breakpoint
-- Bisher eingetragene Preise gelten als bestätigt (sie waren schon im Einsatz). Widersprüche zum Foto erscheinen trotzdem unter „Prüfen“.
UPDATE "event_items" SET "price_confirmed" = true WHERE "price" IS NOT NULL;
