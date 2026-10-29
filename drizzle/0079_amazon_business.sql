CREATE TABLE "amazon_b2b_perioden" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"von" text NOT NULL,
	"bis" text NOT NULL,
	"asin" text NOT NULL,
	"sku" text,
	"titel" text,
	"sitzungen" numeric(14, 0),
	"sitzungen_b2b" numeric(14, 0),
	"einheiten" numeric(14, 0),
	"einheiten_b2b" numeric(14, 0),
	"umsatz" numeric(14, 2),
	"umsatz_b2b" numeric(14, 2),
	"buybox" numeric(14, 2),
	"buybox_b2b" numeric(14, 2),
	"quelle" text NOT NULL,
	"abgerufen_am" timestamp with time zone NOT NULL,
	CONSTRAINT "amazon_b2b_perioden_tenant_id_land_von_bis_asin_pk" PRIMARY KEY("tenant_id","land","von","bis","asin")
);
--> statement-breakpoint
CREATE TABLE "amazon_staffelpreise" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"titel" text,
	"business_preis" numeric(14, 2),
	"stufen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mindest_preis" numeric(14, 2),
	"status" text DEFAULT 'vorschlag' NOT NULL,
	"fehler" text,
	"freigegeben_von" text,
	"freigegeben_am" timestamp with time zone,
	"uebertragen_am" timestamp with time zone,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amazon_staffelpreise_tenant_id_land_sku_pk" PRIMARY KEY("tenant_id","land","sku")
);
--> statement-breakpoint
ALTER TABLE "amazon_b2b_perioden" ADD CONSTRAINT "amazon_b2b_perioden_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_staffelpreise" ADD CONSTRAINT "amazon_staffelpreise_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amazon_b2b_perioden_bis_idx" ON "amazon_b2b_perioden" USING btree ("tenant_id","bis");