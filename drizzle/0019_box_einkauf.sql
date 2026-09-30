ALTER TABLE "purchase_order_items" ALTER COLUMN "asin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "supplier_sku" text;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "components" jsonb DEFAULT '[]'::jsonb NOT NULL;