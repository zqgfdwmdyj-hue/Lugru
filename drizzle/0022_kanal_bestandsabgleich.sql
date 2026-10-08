ALTER TABLE "listings" ADD COLUMN "stock_sku" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "stock_sync" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "max_quantity" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "pushed_quantity" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "listings_stock_sku_idx" ON "listings" USING btree ("tenant_id","stock_sku");