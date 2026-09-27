CREATE TABLE "ebay_idealo_prices" (
	"tenant_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"day" text NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebay_idealo_prices_tenant_id_product_key_day_pk" PRIMARY KEY("tenant_id","product_key","day")
);
--> statement-breakpoint
CREATE TABLE "ebay_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"env" text NOT NULL,
	"number" text NOT NULL,
	"year" integer NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"order_id" text NOT NULL,
	"cancels_id" integer,
	"cancelled_by_id" integer,
	"data" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"emailed_at" text,
	"email_to" text,
	"email_error" text,
	"imported_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ebay_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ean" text NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"condition" text NOT NULL,
	"status" text NOT NULL,
	"epid" text,
	"catalog_matches" jsonb,
	"sku" text,
	"offer_id" text,
	"listing_id" text,
	"title" text,
	"description" text,
	"image_urls" jsonb,
	"aspects" jsonb,
	"category_id" text,
	"gpsr" jsonb,
	"warnings" jsonb,
	"error_message" text,
	"purchased_units" integer,
	"purchase_price" numeric(14, 4),
	"purchase_source" text,
	"target_price" numeric(14, 2),
	"article_key" text,
	"purchase_price_basis" text,
	"fulfillment_policy_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ebay_settings" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "ebay_settings_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "ebay_tokens" (
	"tenant_id" uuid NOT NULL,
	"env" text NOT NULL,
	"type" text NOT NULL,
	"access_token" text NOT NULL,
	"access_expires_at" text NOT NULL,
	"refresh_token" text,
	"refresh_expires_at" text,
	CONSTRAINT "ebay_tokens_tenant_id_env_type_pk" PRIMARY KEY("tenant_id","env","type")
);
--> statement-breakpoint
ALTER TABLE "ebay_idealo_prices" ADD CONSTRAINT "ebay_idealo_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_invoices" ADD CONSTRAINT "ebay_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD CONSTRAINT "ebay_listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_settings" ADD CONSTRAINT "ebay_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_tokens" ADD CONSTRAINT "ebay_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_invoices_number_uq" ON "ebay_invoices" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_invoices_year_seq_uq" ON "ebay_invoices" USING btree ("tenant_id","year","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_invoices_open_order_uq" ON "ebay_invoices" USING btree ("tenant_id","order_id") WHERE kind = 'invoice' and cancelled_by_id is null;--> statement-breakpoint
CREATE INDEX "ebay_listings_tenant_idx" ON "ebay_listings" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "ebay_listings_ean_idx" ON "ebay_listings" USING btree ("tenant_id","ean");