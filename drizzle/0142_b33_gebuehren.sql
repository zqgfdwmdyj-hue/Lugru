CREATE TABLE "bqool_gebuehren" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"sku" text NOT NULL,
	"quelle" text NOT NULL,
	"asin" text,
	"fba" numeric(12, 2),
	"provision_satz" numeric(6, 4),
	"preis" numeric(12, 2),
	"kategorie" text,
	"stand" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bqool_gebuehren_tenant_id_land_sku_quelle_pk" PRIMARY KEY("tenant_id","land","sku","quelle")
);
--> statement-breakpoint
ALTER TABLE "bqool_gebuehren" ADD CONSTRAINT "bqool_gebuehren_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;