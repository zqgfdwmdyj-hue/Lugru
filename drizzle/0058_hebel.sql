CREATE TABLE "hebel_dismissals" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"until" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hebel_dismissals_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "hebel_keepa" (
	"tenant_id" uuid NOT NULL,
	"asin" text NOT NULL,
	"buy_box_price" numeric(14, 4),
	"has_buy_box" boolean,
	"buy_box_is_amazon" boolean DEFAULT false NOT NULL,
	"buy_box_is_fba" boolean DEFAULT false NOT NULL,
	"buy_box_seller_id" text,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hebel_keepa_tenant_id_asin_pk" PRIMARY KEY("tenant_id","asin")
);
--> statement-breakpoint
CREATE TABLE "sellerboard_ebay_units" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sku" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"units_with_cost" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sellerboard_ebay_units_tenant_id_day_sku_pk" PRIMARY KEY("tenant_id","day","sku")
);
--> statement-breakpoint
CREATE TABLE "sellerboard_sku_stats" (
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"sku" text NOT NULL,
	"name" text,
	"asin" text,
	"image" text,
	"link" text,
	"units" integer DEFAULT 0 NOT NULL,
	"refunds" integer DEFAULT 0 NOT NULL,
	"sales" numeric(14, 4),
	"net_profit" numeric(14, 4),
	"gross_profit" numeric(14, 4),
	"fees" numeric(14, 4),
	"product_costs" numeric(14, 4),
	"advertising" numeric(14, 4),
	"vat" numeric(14, 4),
	"refund_cost" numeric(14, 4),
	"avg_price" numeric(14, 4),
	"price" numeric(14, 4),
	"sessions" integer,
	"conversion" numeric(8, 2),
	"stock" integer,
	"days_left" integer,
	"sales_velocity" numeric(10, 2),
	"time_to_reorder" text,
	"stock_value" numeric(14, 4),
	"cost_missing" boolean DEFAULT false NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sellerboard_sku_stats_tenant_id_channel_sku_pk" PRIMARY KEY("tenant_id","channel","sku")
);
--> statement-breakpoint
ALTER TABLE "sellerboard_inventory" ADD COLUMN "stock_value" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "hebel_dismissals" ADD CONSTRAINT "hebel_dismissals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hebel_keepa" ADD CONSTRAINT "hebel_keepa_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerboard_ebay_units" ADD CONSTRAINT "sellerboard_ebay_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerboard_sku_stats" ADD CONSTRAINT "sellerboard_sku_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;