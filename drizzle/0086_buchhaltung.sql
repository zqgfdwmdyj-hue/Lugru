CREATE TABLE "beleg_zuordnungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"firma" text NOT NULL,
	"umsatz_id" uuid NOT NULL,
	"invoice_id" uuid,
	"art" text NOT NULL,
	"betrag" numeric(14, 4) NOT NULL,
	"sicherheit" text NOT NULL,
	"regel" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bestaetigt_von" uuid,
	"bestaetigt_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buchhaltung_exporte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"firma" text NOT NULL,
	"monat" text NOT NULL,
	"art" text NOT NULL,
	"buchungen" integer NOT NULL,
	"belege" integer DEFAULT 0 NOT NULL,
	"summe" numeric(14, 4),
	"festgeschrieben" boolean DEFAULT false NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buchhaltung_importe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"firma" text NOT NULL,
	"art" text NOT NULL,
	"dateiname" text NOT NULL,
	"von" date,
	"bis" date,
	"neu" integer DEFAULT 0 NOT NULL,
	"doppelt" integer DEFAULT 0 NOT NULL,
	"summe" numeric(14, 4),
	"anfangssaldo" numeric(14, 4),
	"endsaldo" numeric(14, 4),
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buchhaltung_protokoll" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"objekt" text NOT NULL,
	"objekt_id" text,
	"aktion" text NOT NULL,
	"vorher" jsonb,
	"nachher" jsonb,
	"user_id" uuid,
	"user_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buchungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"firma" text NOT NULL,
	"monat" text NOT NULL,
	"datum" date NOT NULL,
	"betrag" numeric(14, 4) NOT NULL,
	"soll_haben" text NOT NULL,
	"konto" text NOT NULL,
	"gegenkonto" text NOT NULL,
	"bu_schluessel" text,
	"belegfeld1" text DEFAULT '' NOT NULL,
	"buchungstext" text NOT NULL,
	"invoice_id" uuid,
	"umsatz_id" uuid,
	"zuordnung_id" uuid,
	"quelle" text NOT NULL,
	"hinweis" text,
	"status" text NOT NULL,
	"storno_von" uuid,
	"festgeschrieben_am" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kontierungs_regeln" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"konto" text NOT NULL,
	"bu_schluessel" text,
	"anzahl" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ust_auswertungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"firma" text NOT NULL,
	"monat" text NOT NULL,
	"daten" jsonb NOT NULL,
	"dateiname" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "firma" text;--> statement-breakpoint
ALTER TABLE "bank_umsaetze" ADD COLUMN "gegen_iban" text;--> statement-breakpoint
ALTER TABLE "bank_umsaetze" ADD COLUMN "firma" text;--> statement-breakpoint
ALTER TABLE "beleg_zuordnungen" ADD CONSTRAINT "beleg_zuordnungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_zuordnungen" ADD CONSTRAINT "beleg_zuordnungen_umsatz_id_bank_umsaetze_id_fk" FOREIGN KEY ("umsatz_id") REFERENCES "public"."bank_umsaetze"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_zuordnungen" ADD CONSTRAINT "beleg_zuordnungen_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_zuordnungen" ADD CONSTRAINT "beleg_zuordnungen_bestaetigt_von_users_id_fk" FOREIGN KEY ("bestaetigt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchhaltung_exporte" ADD CONSTRAINT "buchhaltung_exporte_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchhaltung_importe" ADD CONSTRAINT "buchhaltung_importe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchhaltung_protokoll" ADD CONSTRAINT "buchhaltung_protokoll_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchungen" ADD CONSTRAINT "buchungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchungen" ADD CONSTRAINT "buchungen_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchungen" ADD CONSTRAINT "buchungen_umsatz_id_bank_umsaetze_id_fk" FOREIGN KEY ("umsatz_id") REFERENCES "public"."bank_umsaetze"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buchungen" ADD CONSTRAINT "buchungen_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kontierungs_regeln" ADD CONSTRAINT "kontierungs_regeln_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ust_auswertungen" ADD CONSTRAINT "ust_auswertungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bh_zuordnung_umsatz_idx" ON "beleg_zuordnungen" USING btree ("tenant_id","umsatz_id");--> statement-breakpoint
CREATE INDEX "bh_zuordnung_beleg_idx" ON "beleg_zuordnungen" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "bh_exporte_idx" ON "buchhaltung_exporte" USING btree ("tenant_id","firma","monat");--> statement-breakpoint
CREATE INDEX "bh_importe_idx" ON "buchhaltung_importe" USING btree ("tenant_id","firma","created_at");--> statement-breakpoint
CREATE INDEX "bh_protokoll_idx" ON "buchhaltung_protokoll" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "buchungen_monat_idx" ON "buchungen" USING btree ("tenant_id","firma","monat");--> statement-breakpoint
CREATE INDEX "buchungen_beleg_idx" ON "buchungen" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kontierungs_regeln_uq" ON "kontierungs_regeln" USING btree ("tenant_id","schluessel");--> statement-breakpoint
CREATE UNIQUE INDEX "ust_auswertungen_uq" ON "ust_auswertungen" USING btree ("tenant_id","firma","monat");--> statement-breakpoint
-- GoBD: Protokoll nur anhängen; festgeschriebene Buchungen weder ändern noch löschen (nur Storno-Buchung).
-- Löschen nach Ablauf der Aufbewahrung nur mit ausdrücklicher Sitzungs-Einstellung app.gobd_loeschen = 'ja'.
CREATE OR REPLACE FUNCTION buchhaltung_protokoll_schutz() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.gobd_loeschen', true), '') = 'ja' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Buchhaltungs-Protokoll ist unveränderbar (GoBD)';
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER buchhaltung_protokoll_schutz BEFORE UPDATE OR DELETE ON buchhaltung_protokoll FOR EACH ROW EXECUTE FUNCTION buchhaltung_protokoll_schutz();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION buchungen_festschreibung_schutz() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'festgeschrieben' THEN
    IF TG_OP = 'DELETE' AND coalesce(current_setting('app.gobd_loeschen', true), '') = 'ja' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Festgeschriebene Buchung kann nicht geändert werden – bitte stornieren (GoBD)';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER buchungen_festschreibung_schutz BEFORE UPDATE OR DELETE ON buchungen FOR EACH ROW EXECUTE FUNCTION buchungen_festschreibung_schutz();
