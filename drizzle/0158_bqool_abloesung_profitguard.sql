-- BQool wird als Repricer abgelöst, das Repricing läuft über ProfitGuard (ProfitPath).
-- 1. Reine BQool-Daten (Ist-Listen, Exporte, Kreisläufe, Berichte) werden NICHT gelöscht, sondern als archiv_bqool_*
--    umbenannt und schreibgeschützt (Trigger). Der Code liest sie nicht mehr.
-- 2. Die Soll-Strategie-Tabellen (Zuweisungen, Liquidationen, Pflege, Vorschläge, Gebühren) bleiben mit allen Daten
--    erhalten und heißen jetzt repricing_*. BQool-Regelnamen werden auf neutrale Strategien abgebildet; die alten
--    Werte liegen als Sicherung in archiv_bqool_*_vorher (für den Rollback).
-- 3. Einstellungen „bqool“ → „repricing“ (alter Stand bleibt als „archivBqool“), Zugangsdaten „bqool_web“ entfernt,
--    System-Aufgaben umgeschlüsselt, Wissen mit BQool-Bezug als „veraltet“ markiert.
-- Rollback: deploy/rollback/0158_bqool_abloesung_profitguard_down.sql (Anleitung dort).

-- ---- 1. BQool-Daten archivieren (schreibgeschützt) ------------------------------------------------------------------
ALTER TABLE "bqool_listings" RENAME TO "archiv_bqool_listings";--> statement-breakpoint
ALTER TABLE "bqool_exporte" RENAME TO "archiv_bqool_exporte";--> statement-breakpoint
ALTER TABLE "bqool_laeufe" RENAME TO "archiv_bqool_laeufe";--> statement-breakpoint
ALTER TABLE "bqool_berichte" RENAME TO "archiv_bqool_berichte";--> statement-breakpoint
ALTER TABLE "bqool_leistung" RENAME TO "archiv_bqool_leistung";--> statement-breakpoint
ALTER TABLE "bqool_tageswerte" RENAME TO "archiv_bqool_tageswerte";--> statement-breakpoint
ALTER TABLE "bqool_berichte_offen" RENAME TO "archiv_bqool_berichte_offen";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "archiv_bqool_nur_lesen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabelle % ist ein schreibgeschütztes BQool-Archiv (BQool wurde durch ProfitGuard abgelöst).', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['archiv_bqool_listings','archiv_bqool_exporte','archiv_bqool_laeufe','archiv_bqool_berichte','archiv_bqool_leistung','archiv_bqool_tageswerte','archiv_bqool_berichte_offen'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION archiv_bqool_nur_lesen()', t || '_nur_lesen', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION archiv_bqool_nur_lesen()', t || '_nur_lesen_truncate', t);
  END LOOP;
END $$;--> statement-breakpoint

-- ---- 2. Sicherung der Regelnamen, dann Strategie-Tabellen neutral benennen ------------------------------------------
CREATE TABLE "archiv_bqool_zuweisungen_vorher" AS SELECT "tenant_id", "land", "sku", "regel" FROM "bqool_zuweisungen";--> statement-breakpoint
CREATE TABLE "archiv_bqool_liquidationen_vorher" AS SELECT "tenant_id", "land", "sku", "regel_vorher", "rueckkehr_regel" FROM "bqool_liquidationen";--> statement-breakpoint
CREATE TABLE "archiv_bqool_vorschlaege_vorher" AS SELECT "id", "von_regel", "nach_regel" FROM "bqool_vorschlaege";--> statement-breakpoint
CREATE TABLE "archiv_bqool_gebuehren_vorher" AS SELECT "tenant_id", "land", "sku", "quelle" FROM "bqool_gebuehren";--> statement-breakpoint

ALTER TABLE "bqool_zuweisungen" RENAME TO "repricing_zuweisungen";--> statement-breakpoint
ALTER TABLE "repricing_zuweisungen" RENAME CONSTRAINT "bqool_zuweisungen_tenant_id_land_sku_pk" TO "repricing_zuweisungen_tenant_id_land_sku_pk";--> statement-breakpoint
ALTER TABLE "repricing_zuweisungen" RENAME CONSTRAINT "bqool_zuweisungen_tenant_id_tenants_id_fk" TO "repricing_zuweisungen_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "bqool_liquidationen" RENAME TO "repricing_liquidationen";--> statement-breakpoint
ALTER TABLE "repricing_liquidationen" RENAME CONSTRAINT "bqool_liquidationen_tenant_id_land_sku_pk" TO "repricing_liquidationen_tenant_id_land_sku_pk";--> statement-breakpoint
ALTER TABLE "repricing_liquidationen" RENAME CONSTRAINT "bqool_liquidationen_tenant_id_tenants_id_fk" TO "repricing_liquidationen_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "bqool_sku_pflege" RENAME TO "repricing_sku_pflege";--> statement-breakpoint
ALTER TABLE "repricing_sku_pflege" RENAME CONSTRAINT "bqool_sku_pflege_tenant_id_land_sku_pk" TO "repricing_sku_pflege_tenant_id_land_sku_pk";--> statement-breakpoint
ALTER TABLE "repricing_sku_pflege" RENAME CONSTRAINT "bqool_sku_pflege_tenant_id_tenants_id_fk" TO "repricing_sku_pflege_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "bqool_vorschlaege" RENAME TO "repricing_vorschlaege";--> statement-breakpoint
ALTER TABLE "repricing_vorschlaege" RENAME CONSTRAINT "bqool_vorschlaege_pkey" TO "repricing_vorschlaege_pkey";--> statement-breakpoint
ALTER TABLE "repricing_vorschlaege" RENAME CONSTRAINT "bqool_vorschlaege_tenant_id_tenants_id_fk" TO "repricing_vorschlaege_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER INDEX "bqool_vorschlaege_offen_idx" RENAME TO "repricing_vorschlaege_offen_idx";--> statement-breakpoint
ALTER INDEX "bqool_vorschlaege_sku_idx" RENAME TO "repricing_vorschlaege_sku_idx";--> statement-breakpoint
ALTER TABLE "bqool_gebuehren" RENAME TO "repricing_gebuehren";--> statement-breakpoint
ALTER TABLE "repricing_gebuehren" RENAME CONSTRAINT "bqool_gebuehren_tenant_id_land_sku_quelle_pk" TO "repricing_gebuehren_tenant_id_land_sku_quelle_pk";--> statement-breakpoint
ALTER TABLE "repricing_gebuehren" RENAME CONSTRAINT "bqool_gebuehren_tenant_id_tenants_id_fk" TO "repricing_gebuehren_tenant_id_tenants_id_fk";--> statement-breakpoint
UPDATE "repricing_gebuehren" SET "quelle" = 'liste' WHERE "quelle" = 'bqool';--> statement-breakpoint

-- BQool-Regelname → neutrale Strategie (Standard, Abverkauf, Liquidation, Schnelldreher). Der Schnelldreher-Regelname
-- stand je Mandant in den Einstellungen (leiter.schnell.regel).
CREATE FUNCTION "pg_temp"."strategie_neutral"(regel text, schnell text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN regel IS NULL OR btrim(regel) = '' THEN regel
    WHEN lower(regel) LIKE '%liquidation%' OR lower(regel) LIKE 'ai win%' THEN 'Liquidation'
    WHEN lower(regel) LIKE 'abverkauf%' THEN 'Abverkauf'
    WHEN (schnell IS NOT NULL AND lower(btrim(regel)) = lower(btrim(schnell))) OR lower(regel) LIKE '%schnell%' THEN 'Schnelldreher'
    ELSE 'Standard'
  END
$$;--> statement-breakpoint
UPDATE "repricing_zuweisungen" z SET "regel" = pg_temp.strategie_neutral(z."regel", t."settings"->'bqool'->'leiter'->'schnell'->>'regel') FROM "tenants" t WHERE t."id" = z."tenant_id";--> statement-breakpoint
UPDATE "repricing_liquidationen" l SET "regel_vorher" = pg_temp.strategie_neutral(l."regel_vorher", t."settings"->'bqool'->'leiter'->'schnell'->>'regel'), "rueckkehr_regel" = pg_temp.strategie_neutral(l."rueckkehr_regel", t."settings"->'bqool'->'leiter'->'schnell'->>'regel') FROM "tenants" t WHERE t."id" = l."tenant_id";--> statement-breakpoint
UPDATE "repricing_vorschlaege" v SET "von_regel" = pg_temp.strategie_neutral(v."von_regel", t."settings"->'bqool'->'leiter'->'schnell'->>'regel'), "nach_regel" = pg_temp.strategie_neutral(v."nach_regel", t."settings"->'bqool'->'leiter'->'schnell'->>'regel') FROM "tenants" t WHERE t."id" = v."tenant_id";--> statement-breakpoint
-- Offene Vorschläge, die nur für BQool galten (Datei-Upload, Min-Reset), sind gegenstandslos.
UPDATE "repricing_vorschlaege" SET "status" = 'veraltet', "updated_at" = now() WHERE "status" IN ('offen', 'spaeter') AND "art" IN ('check_11');--> statement-breakpoint

-- ---- 3. ProfitGuard-Ist und -Exporte ---------------------------------------------------------------------------------
CREATE TABLE "profitguard_listings" (
	"tenant_id" uuid NOT NULL,
	"marktplatz" text NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"titel" text,
	"preis" numeric(12, 2),
	"min" numeric(12, 2),
	"max" numeric(12, 2),
	"strategie" text,
	"im_repricing" boolean,
	"buybox_preis" numeric(12, 2),
	"eigene_buybox" boolean,
	"buybox_anteil" numeric(6, 2),
	"bestand" numeric(12, 0),
	"zusatz" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"datei" text,
	"eingelesen_am" timestamp with time zone NOT NULL,
	"strategie_seit" timestamp with time zone,
	CONSTRAINT "profitguard_listings_tenant_id_marktplatz_sku_pk" PRIMARY KEY("tenant_id","marktplatz","sku")
);--> statement-breakpoint
CREATE TABLE "profitguard_exporte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"laender" jsonb NOT NULL,
	"nur_aenderungen" boolean NOT NULL,
	"zeilen" jsonb NOT NULL,
	"anzahl" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"importiert_am" timestamp with time zone,
	"importiert_von" text,
	"protokoll" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "profitguard_listings" ADD CONSTRAINT "profitguard_listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profitguard_exporte" ADD CONSTRAINT "profitguard_exporte_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profitguard_asin_idx" ON "profitguard_listings" USING btree ("tenant_id","asin");--> statement-breakpoint
CREATE INDEX "profitguard_exporte_tenant_idx" ON "profitguard_exporte" USING btree ("tenant_id","created_at");--> statement-breakpoint

-- ---- 4. Einstellungen, Zugangsdaten, Aufgaben, Wissen ---------------------------------------------------------------
UPDATE "tenants" SET "settings" = ("settings" - 'bqool') || jsonb_build_object('repricing', "settings"->'bqool', 'archivBqool', "settings"->'bqool') WHERE "settings" ? 'bqool';--> statement-breakpoint
-- Automatische Verlust-Stopp-Ausnahmen der Liquidation heißen neutral.
UPDATE "verlust_ausnahmen" SET "grund" = 'Repricing-Liquidation' || substr("grund", 18) WHERE "grund" LIKE 'BQool-Liquidation%';--> statement-breakpoint
-- BQool-Zugangsdaten (Browser-Anmeldung, verschlüsselt) werden entfernt – nicht wiederherstellbar.
DELETE FROM "integrations" WHERE "provider" = 'bqool_web';--> statement-breakpoint
UPDATE "tasks" SET "system_key" = 'repricing-' || substr("system_key", 7), "title" = replace(replace(replace("title", 'BQool Regel-Leiter', 'Regel-Leiter'), 'BQool-Abgleich', 'ProfitGuard-Abgleich'), 'BQool:', 'Repricing:'), "link" = replace(replace("link", '/repricer/bqool', '/repricer/profitguard'), '#bqool-liste', '#abgleich')
  WHERE "system_key" IN ('bqool-abgleich', 'bqool-zustand-pruefen', 'bqool-leiter', 'bqool-rueckkehr', 'bqool-liquidation-ablauf');--> statement-breakpoint
UPDATE "tasks" SET "status" = 'done', "completed_at" = now(), "notes" = coalesce("notes", '') || E'\n\nErledigt: BQool wurde durch ProfitGuard abgelöst.'
  WHERE "status" = 'open' AND ("system_key" IN ('bqool-freigabe', 'bqool-nachkontrolle', 'bqool-upload-fehler') OR "system_key" LIKE 'automatik-bqool-%');--> statement-breakpoint
-- Gespeicherte Links auf entfernte Seiten (BQool-Dateien, Leistung) zeigen auf die neuen Repricer-Seiten.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks','uploads','meldungen','amazon_todos','sellerboard_sku_stats','zeitbloecke'] LOOP
    EXECUTE format($f$UPDATE %I SET "link" = replace(replace(replace("link", '/repricer/bqool', '/repricer/profitguard'), '/repricer/leistung', '/repricer'), '#bqool-liste', '#abgleich') WHERE "link" LIKE '%%/repricer/bqool%%' OR "link" LIKE '%%/repricer/leistung%%' OR "link" LIKE '%%#bqool-liste%%'$f$, t);
  END LOOP;
END $$;--> statement-breakpoint
UPDATE "knowledge_entries" SET
  "title" = '[veraltet] ' || "title",
  "body" = E'Veraltet: BQool wurde als Repricer durch ProfitGuard (ProfitPath) abgelöst – Angaben zu BQool gelten nicht mehr.\n\n' || "body",
  "tags" = array_append(array_append("tags", 'veraltet'), 'bqool-veraltet')
  WHERE ("title" ILIKE '%bqool%' OR "body" ILIKE '%bqool%' OR 'bqool' = ANY("tags")) AND NOT ('bqool-veraltet' = ANY("tags"));
