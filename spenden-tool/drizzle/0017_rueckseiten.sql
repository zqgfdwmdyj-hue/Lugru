CREATE TABLE "product_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"role" text DEFAULT 'rueckseite' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_checks" ADD COLUMN "recognized_side" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "distinct_from" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_photos_product_idx" ON "product_photos" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_photos_uq" ON "product_photos" USING btree ("product_id","file_id");