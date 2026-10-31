CREATE TABLE "sellerboard_kpis" (
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL,
	"sales" numeric(14, 4),
	"orders" integer,
	"units" integer,
	"refunds" integer,
	"advertising" numeric(14, 4),
	"payout" numeric(14, 4),
	"gross_profit" numeric(14, 4),
	"net_profit" numeric(14, 4),
	"missing_cost" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sellerboard_kpis_tenant_id_channel_from_day_to_day_pk" PRIMARY KEY("tenant_id","channel","from_day","to_day")
);
--> statement-breakpoint
CREATE TABLE "sellerboard_top" (
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"day" date NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sellerboard_top_tenant_id_channel_day_pk" PRIMARY KEY("tenant_id","channel","day")
);
--> statement-breakpoint
ALTER TABLE "sellerboard_kpis" ADD CONSTRAINT "sellerboard_kpis_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerboard_top" ADD CONSTRAINT "sellerboard_top_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;