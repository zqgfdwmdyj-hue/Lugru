CREATE TABLE "b2b_kunden" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"firma" text NOT NULL,
	"ansprechpartner" text,
	"email" text,
	"strasse" text,
	"plz" text,
	"ort" text,
	"land" text DEFAULT 'DE' NOT NULL,
	"ust_id" text,
	"ust_gueltig" boolean,
	"ust_geprueft_am" timestamp with time zone,
	"ust_pruef_name" text,
	"ust_pruef_kennung" text,
	"amazon_name" text,
	"zahlungsart" text DEFAULT 'vorkasse' NOT NULL,
	"lexoffice_kontakt_id" text,
	"abo" jsonb DEFAULT '{"alle":true}'::jsonb NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "b2b_sitzungen" (
	"id" text PRIMARY KEY NOT NULL,
	"zugang_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kunde_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "b2b_zugaenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kunde_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"passwort_hash" text,
	"einladung_hash" text,
	"einladung_bis" timestamp with time zone,
	"letzter_login" timestamp with time zone,
	"gesperrt" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_bestellungen" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menge" integer NOT NULL,
	"eigene_menge" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'entwurf' NOT NULL,
	"mail_an" text,
	"mail_betreff" text,
	"mail_text" text,
	"freigegeben_von" uuid,
	"freigegeben_am" timestamp with time zone,
	"bestellt_am" timestamp with time zone,
	"grosshaendler_rechnung_nr" text,
	"grosshaendler_rechnung_id" integer,
	"eingang_menge" integer,
	"eingang_am" timestamp with time zone,
	"reklamation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_kontrollen" (
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"tag" integer NOT NULL,
	"land" text NOT NULL,
	"prognose_vk" numeric(12, 4),
	"bb_schnitt" numeric(12, 4),
	"angebote" integer,
	"abweichung_prozent" numeric(8, 2),
	"bewertung" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_kontrollen_deal_id_tag_land_pk" PRIMARY KEY("deal_id","tag","land")
);
--> statement-breakpoint
CREATE TABLE "deal_kundenpreise" (
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"kunde_id" uuid NOT NULL,
	"preis_netto" numeric(12, 4) NOT NULL,
	CONSTRAINT "deal_kundenpreise_deal_id_kunde_id_pk" PRIMARY KEY("deal_id","kunde_id")
);
--> statement-breakpoint
CREATE TABLE "deal_reservierungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"kunde_id" uuid NOT NULL,
	"menge" integer NOT NULL,
	"preis_netto" numeric(12, 4) NOT NULL,
	"status" text DEFAULT 'reserviert' NOT NULL,
	"bedingungen_am" timestamp with time zone NOT NULL,
	"zugeteilt" integer,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"rechnung_id" text,
	"rechnung_nr" text,
	"rechnung_brutto" numeric(12, 4),
	"bezahlt_am" timestamp with time zone,
	"gutschrift_id" text,
	"gutschrift_betrag" numeric(12, 4),
	"exportiert_am" timestamp with time zone,
	"notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nr" integer NOT NULL,
	"status" text DEFAULT 'entwurf' NOT NULL,
	"asin" text NOT NULL,
	"ean" text,
	"titel" text NOT NULL,
	"bild_url" text,
	"marke" text,
	"kategorie" text,
	"supplier_id" uuid,
	"angebot_id" uuid,
	"ek_netto" numeric(12, 4) NOT NULL,
	"staffel" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"moq_lieferant" integer DEFAULT 1 NOT NULL,
	"lieferzeit_tage" integer,
	"angebot_gueltig_bis" date,
	"frist" date,
	"kundenpreis_netto" numeric(12, 4),
	"mindestmenge_kunde" integer DEFAULT 1 NOT NULL,
	"max_gesamt" integer,
	"max_pro_kunde" integer,
	"max_kunden" integer,
	"nur_restmenge" boolean DEFAULT false NOT NULL,
	"eigener_bestand" integer DEFAULT 0 NOT NULL,
	"versand_anteil" numeric(12, 4),
	"prep_gebuehr" numeric(12, 4),
	"prognose" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hinweis" text,
	"discord" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"freigeschaltet_am" timestamp with time zone,
	"freigeschaltet_von" uuid,
	"geschlossen_am" timestamp with time zone,
	"angekommen_am" timestamp with time zone,
	"angelegt_von" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lieferanten_profile" (
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"email" text,
	"mindestbestellwert" numeric(12, 4),
	"versandkosten" numeric(12, 4),
	"zahlungsziel_tage" integer,
	"lieferzeit_tage" integer,
	"marken" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bewertung" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"wiederverkauf_erlaubt" boolean,
	"marktplatz_erlaubt" boolean,
	"vertrieb_notiz" text,
	"vertrieb_quelle" text,
	"vertrieb_geprueft_am" timestamp with time zone,
	"vertrieb_geprueft_von" uuid,
	"notiz" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lieferanten_profile_tenant_id_supplier_id_pk" PRIMARY KEY("tenant_id","supplier_id")
);
--> statement-breakpoint
ALTER TABLE "b2b_kunden" ADD CONSTRAINT "b2b_kunden_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "b2b_sitzungen" ADD CONSTRAINT "b2b_sitzungen_zugang_id_b2b_zugaenge_id_fk" FOREIGN KEY ("zugang_id") REFERENCES "public"."b2b_zugaenge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "b2b_sitzungen" ADD CONSTRAINT "b2b_sitzungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "b2b_sitzungen" ADD CONSTRAINT "b2b_sitzungen_kunde_id_b2b_kunden_id_fk" FOREIGN KEY ("kunde_id") REFERENCES "public"."b2b_kunden"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "b2b_zugaenge" ADD CONSTRAINT "b2b_zugaenge_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "b2b_zugaenge" ADD CONSTRAINT "b2b_zugaenge_kunde_id_b2b_kunden_id_fk" FOREIGN KEY ("kunde_id") REFERENCES "public"."b2b_kunden"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_bestellungen" ADD CONSTRAINT "deal_bestellungen_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_bestellungen" ADD CONSTRAINT "deal_bestellungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_bestellungen" ADD CONSTRAINT "deal_bestellungen_freigegeben_von_users_id_fk" FOREIGN KEY ("freigegeben_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_kontrollen" ADD CONSTRAINT "deal_kontrollen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_kontrollen" ADD CONSTRAINT "deal_kontrollen_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_kundenpreise" ADD CONSTRAINT "deal_kundenpreise_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_kundenpreise" ADD CONSTRAINT "deal_kundenpreise_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_kundenpreise" ADD CONSTRAINT "deal_kundenpreise_kunde_id_b2b_kunden_id_fk" FOREIGN KEY ("kunde_id") REFERENCES "public"."b2b_kunden"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_reservierungen" ADD CONSTRAINT "deal_reservierungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_reservierungen" ADD CONSTRAINT "deal_reservierungen_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_reservierungen" ADD CONSTRAINT "deal_reservierungen_kunde_id_b2b_kunden_id_fk" FOREIGN KEY ("kunde_id") REFERENCES "public"."b2b_kunden"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_freigeschaltet_von_users_id_fk" FOREIGN KEY ("freigeschaltet_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_angelegt_von_users_id_fk" FOREIGN KEY ("angelegt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lieferanten_profile" ADD CONSTRAINT "lieferanten_profile_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lieferanten_profile" ADD CONSTRAINT "lieferanten_profile_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lieferanten_profile" ADD CONSTRAINT "lieferanten_profile_vertrieb_geprueft_von_users_id_fk" FOREIGN KEY ("vertrieb_geprueft_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "b2b_kunden_firma_uq" ON "b2b_kunden" USING btree ("tenant_id","firma");--> statement-breakpoint
CREATE UNIQUE INDEX "b2b_zugaenge_email_uq" ON "b2b_zugaenge" USING btree ("email_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_reservierungen_uq" ON "deal_reservierungen" USING btree ("deal_id","kunde_id");--> statement-breakpoint
CREATE INDEX "deal_reservierungen_kunde_idx" ON "deal_reservierungen" USING btree ("tenant_id","kunde_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_nr_uq" ON "deals" USING btree ("tenant_id","nr");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "deals_asin_idx" ON "deals" USING btree ("tenant_id","asin");