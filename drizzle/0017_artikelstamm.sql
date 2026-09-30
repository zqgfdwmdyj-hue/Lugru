CREATE TABLE "article_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"public_token" text NOT NULL,
	"ebay_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid,
	"idea_id" uuid,
	"product_id" uuid,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'entwurf' NOT NULL,
	"ean" text,
	"gtin_exempt" boolean DEFAULT false NOT NULL,
	"asin" text,
	"cost_price" numeric(14, 4),
	"price" numeric(14, 4),
	"vat_rate" numeric(5, 2) DEFAULT '19' NOT NULL,
	"weight_grams" integer,
	"length_cm" numeric(8, 1),
	"width_cm" numeric(8, 1),
	"height_cm" numeric(8, 1),
	"bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"keywords" text,
	"contents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"food" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manufacturer" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"amazon" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ebay" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "amazon_account" text DEFAULT 'haupt' NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "gpsr" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_images_idx" ON "article_images" USING btree ("article_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "article_images_token_uq" ON "article_images" USING btree ("public_token");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_sku_uq" ON "articles" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_idea_uq" ON "articles" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "articles_brand_idx" ON "articles" USING btree ("tenant_id","brand_id");