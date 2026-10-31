CREATE TABLE "keepa_cache" (
	"tenant_id" uuid NOT NULL,
	"asin" text NOT NULL,
	"marktplatz" text NOT NULL,
	"abgerufen_am" timestamp with time zone NOT NULL,
	"gefunden" boolean NOT NULL,
	"stand" jsonb,
	"tokens_uebrig" integer,
	CONSTRAINT "keepa_cache_tenant_id_asin_marktplatz_pk" PRIMARY KEY("tenant_id","asin","marktplatz")
);
--> statement-breakpoint
ALTER TABLE "keepa_cache" ADD CONSTRAINT "keepa_cache_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;