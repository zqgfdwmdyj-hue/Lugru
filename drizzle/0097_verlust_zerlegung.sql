ALTER TABLE "sellerboard_sku_tage" ADD COLUMN "refunds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sellerboard_sku_tage" ADD COLUMN "refund_cost" numeric(14, 4);