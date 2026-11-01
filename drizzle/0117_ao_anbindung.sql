CREATE TABLE "ao_accountone_cog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"monat" text NOT NULL,
	"zeilen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spalten" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dateiname" text,
	"datei_import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aktualisiert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ao_einkaeufe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"asin" text NOT NULL,
	"sku" text,
	"titel" text,
	"kaufdatum" date NOT NULL,
	"menge" integer NOT NULL,
	"ek_netto" numeric(12, 2),
	"waehrung" text,
	"lieferant" text,
	"rechnung" text,
	"datei_import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ao_laeufe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ausloeser" text NOT NULL,
	"status" text DEFAULT 'laeuft' NOT NULL,
	"ergebnis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"protokoll" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fehler" text,
	"ende_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ao_lagerbestand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stichtag" date NOT NULL,
	"sku" text,
	"asin" text,
	"titel" text,
	"menge" integer NOT NULL,
	"ek_netto" numeric(12, 2),
	"wert" numeric(14, 2),
	"lagerort" text,
	"datei_import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "datei_importe" ADD COLUMN "herkunft" text DEFAULT 'claude' NOT NULL;--> statement-breakpoint
ALTER TABLE "datei_importe" ADD COLUMN "quelle_export" text;--> statement-breakpoint
ALTER TABLE "ao_accountone_cog" ADD CONSTRAINT "ao_accountone_cog_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ao_einkaeufe" ADD CONSTRAINT "ao_einkaeufe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ao_laeufe" ADD CONSTRAINT "ao_laeufe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ao_lagerbestand" ADD CONSTRAINT "ao_lagerbestand_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ao_accountone_cog_uq" ON "ao_accountone_cog" USING btree ("tenant_id","monat");--> statement-breakpoint
CREATE UNIQUE INDEX "ao_einkaeufe_uq" ON "ao_einkaeufe" USING btree ("tenant_id","schluessel");--> statement-breakpoint
CREATE INDEX "ao_einkaeufe_asin_idx" ON "ao_einkaeufe" USING btree ("tenant_id","asin","kaufdatum");--> statement-breakpoint
CREATE INDEX "ao_einkaeufe_tag_idx" ON "ao_einkaeufe" USING btree ("tenant_id","kaufdatum");--> statement-breakpoint
CREATE INDEX "ao_laeufe_tenant_idx" ON "ao_laeufe" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ao_lagerbestand_tag_idx" ON "ao_lagerbestand" USING btree ("tenant_id","stichtag");--> statement-breakpoint
CREATE INDEX "ao_lagerbestand_sku_idx" ON "ao_lagerbestand" USING btree ("tenant_id","sku");