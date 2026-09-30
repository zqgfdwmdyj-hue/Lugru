ALTER TABLE "supplier_offers" ADD COLUMN "price_orig" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "pack" text;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "market" jsonb;