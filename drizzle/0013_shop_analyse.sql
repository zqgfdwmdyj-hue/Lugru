CREATE TABLE "brand_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"asin" text NOT NULL,
	"data" jsonb,
	"last_error" text,
	"fetched_at" timestamp with time zone,
	"ai_listing" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_snapshots" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"day" date NOT NULL,
	"price" numeric(10, 2),
	"sales_rank" numeric(12, 0),
	"monthly_sold" numeric(12, 0),
	"reviews" numeric(12, 0),
	"rating" numeric(3, 1),
	CONSTRAINT "product_snapshots_product_id_day_pk" PRIMARY KEY("product_id","day")
);
--> statement-breakpoint
ALTER TABLE "brand_products" ADD CONSTRAINT "brand_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_products" ADD CONSTRAINT "brand_products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_imports" ADD CONSTRAINT "market_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_imports" ADD CONSTRAINT "market_imports_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_snapshots" ADD CONSTRAINT "product_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_snapshots" ADD CONSTRAINT "product_snapshots_product_id_brand_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."brand_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_products_asin_uq" ON "brand_products" USING btree ("tenant_id","asin");--> statement-breakpoint
CREATE INDEX "market_imports_brand_idx" ON "market_imports" USING btree ("tenant_id","brand_id","created_at");--> statement-breakpoint
UPDATE "brands" SET "links" = 'https://www.youtube.com/@zeitlux1' WHERE "name" = 'Zeitlux' AND ("links" IS NULL OR "links" = '');
