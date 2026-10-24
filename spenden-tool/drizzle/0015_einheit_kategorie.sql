ALTER TABLE "event_items" ADD COLUMN "unit_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_checked" boolean DEFAULT false NOT NULL;