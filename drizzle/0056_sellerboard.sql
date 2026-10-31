CREATE TABLE "sellerboard_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sb_id" text NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"fnsku" text,
	"name" text,
	"channel" text,
	"fba_stock" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"inbound" integer DEFAULT 0 NOT NULL,
	"sales_velocity" numeric(10, 2),
	"days_left" integer,
	"time_to_reorder" text,
	"days_to_reorder" integer,
	"qty_to_reorder" integer DEFAULT 0 NOT NULL,
	"running_out" text,
	"cost" numeric(14, 4),
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellerboard_months" (
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"sales" numeric(14, 4),
	"units" integer,
	"orders" integer,
	"refunds" integer,
	"amazon_fees" numeric(14, 4),
	"product_costs" numeric(14, 4),
	"expenses" numeric(14, 4),
	"gross_profit" numeric(14, 4),
	"net_profit" numeric(14, 4),
	"payout" numeric(14, 4),
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sellerboard_months_tenant_id_month_pk" PRIMARY KEY("tenant_id","month")
);
--> statement-breakpoint
CREATE TABLE "sellerboard_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sb_id" text NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"ean" text,
	"name" text,
	"channel" text,
	"cost" numeric(14, 4),
	"cost_period" text,
	"price" numeric(14, 4),
	"fba_fee" numeric(14, 4),
	"referral_fee" numeric(14, 4),
	"vat_pct" numeric(6, 2),
	"margin" numeric(14, 4),
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellerboard_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sb_id" text NOT NULL,
	"amazon_id" text,
	"name" text,
	"status" text NOT NULL,
	"created_on" date,
	"last_update" date,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellerboard_sku_months" (
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"name" text,
	"units" integer,
	"sales" numeric(14, 4),
	"net_profit" numeric(14, 4),
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sellerboard_sku_months_tenant_id_month_sku_pk" PRIMARY KEY("tenant_id","month","sku")
);
--> statement-breakpoint
ALTER TABLE "amazon_inventory" ADD COLUMN "source" text DEFAULT 'report' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_items" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "sellerboard_inventory" ADD CONSTRAINT "sellerboard_inventory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerboard_months" ADD CONSTRAINT "sellerboard_months_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerboard_products" ADD CONSTRAINT "sellerboard_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerboard_shipments" ADD CONSTRAINT "sellerboard_shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerboard_sku_months" ADD CONSTRAINT "sellerboard_sku_months_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sb_inventory_uq" ON "sellerboard_inventory" USING btree ("tenant_id","sb_id");--> statement-breakpoint
CREATE INDEX "sb_inventory_sku_idx" ON "sellerboard_inventory" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "sb_products_uq" ON "sellerboard_products" USING btree ("tenant_id","sb_id");--> statement-breakpoint
CREATE INDEX "sb_products_sku_idx" ON "sellerboard_products" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "sb_shipments_uq" ON "sellerboard_shipments" USING btree ("tenant_id","sb_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_items_ext_uq" ON "cash_items" USING btree ("tenant_id","external_ref") WHERE "cash_items"."external_ref" is not null;