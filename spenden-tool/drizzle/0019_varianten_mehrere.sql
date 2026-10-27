ALTER TABLE "event_items" ADD COLUMN "more_packs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "price_checks" ADD COLUMN "multiple_products" boolean DEFAULT false NOT NULL;