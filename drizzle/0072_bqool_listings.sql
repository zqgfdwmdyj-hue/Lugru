CREATE TABLE "bqool_listings" (
	"tenant_id" uuid NOT NULL,
	"marktplatz" text NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"titel" text,
	"versand" text,
	"preis" numeric(12, 2),
	"min" numeric(12, 2),
	"max" numeric(12, 2),
	"regel" text,
	"status" text,
	"buybox_preis" numeric(12, 2),
	"buybox_gewinner" text,
	"eigene_buybox" boolean,
	"niedrigster_preis" numeric(12, 2),
	"angebote" numeric(10, 0),
	"bestand" numeric(12, 0),
	"zusatz" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"datei" text,
	"eingelesen_am" timestamp with time zone NOT NULL,
	CONSTRAINT "bqool_listings_tenant_id_marktplatz_sku_pk" PRIMARY KEY("tenant_id","marktplatz","sku")
);
--> statement-breakpoint
ALTER TABLE "bqool_listings" ADD CONSTRAINT "bqool_listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bqool_asin_idx" ON "bqool_listings" USING btree ("tenant_id","asin");