CREATE TABLE "amazon_lagergebuehren" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"monat" text NOT NULL,
	"asin" text NOT NULL,
	"fnsku" text DEFAULT '' NOT NULL,
	"lager" text DEFAULT '' NOT NULL,
	"land" text DEFAULT '' NOT NULL,
	"titel" text,
	"groesse" text,
	"bestand_schnitt" numeric(14, 4),
	"volumen_m3" numeric(14, 4),
	"gebuehr" numeric(14, 4) NOT NULL,
	"zuschlag" numeric(14, 4),
	"waehrung" text DEFAULT 'EUR' NOT NULL,
	"kategorie" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datei_importe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"art" text NOT NULL,
	"dateiname" text NOT NULL,
	"hinweis" text,
	"token_hash" text NOT NULL,
	"gueltig_bis" timestamp with time zone NOT NULL,
	"benutzt_am" timestamp with time zone,
	"status" text DEFAULT 'wartet_auf_datei' NOT NULL,
	"fortschritt" integer DEFAULT 0 NOT NULL,
	"groesse" bigint,
	"sha256" text,
	"ablage" text,
	"bereits_import_id" uuid,
	"hochgeladen_am" timestamp with time zone,
	"fertig_am" timestamp with time zone,
	"fehler_text" text,
	"ergebnis" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_settlement_lines" ADD COLUMN "quelle" text DEFAULT 'abrechnung' NOT NULL;--> statement-breakpoint
ALTER TABLE "amazon_lagergebuehren" ADD CONSTRAINT "amazon_lagergebuehren_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datei_importe" ADD CONSTRAINT "datei_importe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datei_importe" ADD CONSTRAINT "datei_importe_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amz_lager_geb_uq" ON "amazon_lagergebuehren" USING btree ("tenant_id","monat","asin","fnsku","lager","land");--> statement-breakpoint
CREATE INDEX "amz_lager_geb_asin_idx" ON "amazon_lagergebuehren" USING btree ("tenant_id","asin");--> statement-breakpoint
CREATE UNIQUE INDEX "datei_importe_token_uq" ON "datei_importe" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "datei_importe_tenant_idx" ON "datei_importe" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "datei_importe_hash_idx" ON "datei_importe" USING btree ("tenant_id","sha256");