CREATE TABLE "retouren_medien" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pruefung_id" uuid NOT NULL,
	"position_id" uuid,
	"art" text NOT NULL,
	"nr" integer DEFAULT 1 NOT NULL,
	"pfad" text NOT NULL,
	"teile" integer DEFAULT 1 NOT NULL,
	"mime" text NOT NULL,
	"groesse" integer DEFAULT 0 NOT NULL,
	"ki_daten" jsonb,
	"aufgenommen_am" timestamp with time zone DEFAULT now() NOT NULL,
	"loeschen_ab" date,
	"geloescht_am" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "retouren_positionen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pruefung_id" uuid NOT NULL,
	"nr" integer NOT NULL,
	"zuordnung" text DEFAULT 'unbekannt' NOT NULL,
	"lpn" text,
	"fnsku" text,
	"sku" text,
	"asin" text,
	"titel" text,
	"bestellnummer" text,
	"rueckgabe_datum" date,
	"rueckgabegrund" text,
	"kundenkommentar" text,
	"amazon_zustand" text,
	"erstattet_betrag" numeric(12, 2),
	"amazon_gezahlt" numeric(12, 2),
	"befund" text,
	"ki_einschaetzung" jsonb,
	"ki_abweichung" boolean DEFAULT false NOT NULL,
	"entscheidung" text,
	"verbleib" text,
	"ret_sku" text,
	"ret_charge_id" uuid,
	"anspruch_schluessel" text,
	"anspruch_id" uuid,
	"fall_betreff" text,
	"fall_text_de" text,
	"fall_text_en" text,
	"notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retouren_pruefungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"remission_id" text,
	"zuordnung" text,
	"sendungsnummer" text,
	"versender" text,
	"erwartet" jsonb,
	"lieferschein" jsonb,
	"abweichungen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notiz" text,
	"zusammenfassung" text,
	"video_teile" integer DEFAULT 0 NOT NULL,
	"angelegt_von" uuid,
	"angelegt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"abgeschlossen_am" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retouren_medien" ADD CONSTRAINT "retouren_medien_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retouren_medien" ADD CONSTRAINT "retouren_medien_pruefung_id_retouren_pruefungen_id_fk" FOREIGN KEY ("pruefung_id") REFERENCES "public"."retouren_pruefungen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retouren_medien" ADD CONSTRAINT "retouren_medien_position_id_retouren_positionen_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."retouren_positionen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retouren_positionen" ADD CONSTRAINT "retouren_positionen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retouren_positionen" ADD CONSTRAINT "retouren_positionen_pruefung_id_retouren_pruefungen_id_fk" FOREIGN KEY ("pruefung_id") REFERENCES "public"."retouren_pruefungen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retouren_positionen" ADD CONSTRAINT "retouren_positionen_ret_charge_id_lots_id_fk" FOREIGN KEY ("ret_charge_id") REFERENCES "public"."lots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retouren_positionen" ADD CONSTRAINT "retouren_positionen_anspruch_id_claims_id_fk" FOREIGN KEY ("anspruch_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retouren_pruefungen" ADD CONSTRAINT "retouren_pruefungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retouren_pruefungen" ADD CONSTRAINT "retouren_pruefungen_angelegt_von_users_id_fk" FOREIGN KEY ("angelegt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retouren_medien_pruefung_idx" ON "retouren_medien" USING btree ("tenant_id","pruefung_id");--> statement-breakpoint
CREATE INDEX "retouren_medien_loeschen_idx" ON "retouren_medien" USING btree ("tenant_id","loeschen_ab");--> statement-breakpoint
CREATE INDEX "retouren_positionen_pruefung_idx" ON "retouren_positionen" USING btree ("tenant_id","pruefung_id");--> statement-breakpoint
CREATE INDEX "retouren_positionen_lpn_idx" ON "retouren_positionen" USING btree ("tenant_id","lpn");--> statement-breakpoint
CREATE INDEX "retouren_positionen_anspruch_idx" ON "retouren_positionen" USING btree ("tenant_id","anspruch_id");--> statement-breakpoint
CREATE INDEX "retouren_pruefungen_tenant_idx" ON "retouren_pruefungen" USING btree ("tenant_id","angelegt_am");--> statement-breakpoint
CREATE INDEX "retouren_pruefungen_status_idx" ON "retouren_pruefungen" USING btree ("tenant_id","status");