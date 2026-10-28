ALTER TABLE "sku_weights" ALTER COLUMN "grams" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_weights" ADD COLUMN "ws_max" integer;