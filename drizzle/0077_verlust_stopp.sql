CREATE TABLE "sellerboard_sku_tage" (
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"day" date NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"name" text,
	"units" integer DEFAULT 0 NOT NULL,
	"sales" numeric(14, 4),
	"net_profit" numeric(14, 4),
	"avg_price" numeric(14, 4),
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sellerboard_sku_tage_tenant_id_channel_day_sku_pk" PRIMARY KEY("tenant_id","channel","day","sku")
);
--> statement-breakpoint
CREATE TABLE "verlust_ausnahmen" (
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"grund" text NOT NULL,
	"bis" date,
	"angelegt_von" uuid,
	"angelegt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verlust_ausnahmen_tenant_id_sku_pk" PRIMARY KEY("tenant_id","sku")
);
--> statement-breakpoint
ALTER TABLE "sellerboard_sku_tage" ADD CONSTRAINT "sellerboard_sku_tage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verlust_ausnahmen" ADD CONSTRAINT "verlust_ausnahmen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_sku_tage_sku_idx" ON "sellerboard_sku_tage" USING btree ("tenant_id","sku");