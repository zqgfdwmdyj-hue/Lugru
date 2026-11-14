-- Rollback der Migration 0156 (BQool-Ablösung → ProfitGuard).
--
-- Nur zusammen mit dem alten Code-Stand benutzen (Commit vor der BQool-Ablösung), sonst fehlen dem Code die Tabellen.
-- Ablauf auf dem Server:
--   1. Datenbank sichern:            bash /opt/seller-system/deploy/backup.sh
--   2. Rollback ausführen:           docker compose exec -T db psql -U seller -d seller -v ON_ERROR_STOP=1 < deploy/rollback/0156_bqool_abloesung_profitguard_down.sql
--   3. Alten Code-Stand einspielen und neu starten.
--
-- Nicht wiederherstellbar: die gelöschten BQool-Zugangsdaten (Anbindung „BQool – Anmeldung“) – bei Bedarf neu eintragen.
-- Verloren gehen ProfitGuard-Importe und -Exporte (Tabellen profitguard_*). Soll-Strategien, Liquidationen, Pflege und
-- Vorschläge bleiben erhalten; die BQool-Regelnamen werden aus der Sicherung zurückgeschrieben.

BEGIN;

DROP TABLE IF EXISTS "profitguard_listings";
DROP TABLE IF EXISTS "profitguard_exporte";

-- Regelnamen aus der Sicherung (Zeilen, die nach der Migration neu dazukamen, behalten den neutralen Namen).
UPDATE "repricing_zuweisungen" z SET "regel" = v."regel" FROM "archiv_bqool_zuweisungen_vorher" v WHERE v."tenant_id" = z."tenant_id" AND v."land" = z."land" AND v."sku" = z."sku";
UPDATE "repricing_liquidationen" l SET "regel_vorher" = v."regel_vorher", "rueckkehr_regel" = v."rueckkehr_regel" FROM "archiv_bqool_liquidationen_vorher" v WHERE v."tenant_id" = l."tenant_id" AND v."land" = l."land" AND v."sku" = l."sku";
UPDATE "repricing_vorschlaege" x SET "von_regel" = v."von_regel", "nach_regel" = v."nach_regel" FROM "archiv_bqool_vorschlaege_vorher" v WHERE v."id" = x."id";
UPDATE "repricing_gebuehren" SET "quelle" = 'bqool' WHERE "quelle" = 'liste';

ALTER TABLE "repricing_zuweisungen" RENAME CONSTRAINT "repricing_zuweisungen_tenant_id_land_sku_pk" TO "bqool_zuweisungen_tenant_id_land_sku_pk";
ALTER TABLE "repricing_zuweisungen" RENAME CONSTRAINT "repricing_zuweisungen_tenant_id_tenants_id_fk" TO "bqool_zuweisungen_tenant_id_tenants_id_fk";
ALTER TABLE "repricing_zuweisungen" RENAME TO "bqool_zuweisungen";
ALTER TABLE "repricing_liquidationen" RENAME CONSTRAINT "repricing_liquidationen_tenant_id_land_sku_pk" TO "bqool_liquidationen_tenant_id_land_sku_pk";
ALTER TABLE "repricing_liquidationen" RENAME CONSTRAINT "repricing_liquidationen_tenant_id_tenants_id_fk" TO "bqool_liquidationen_tenant_id_tenants_id_fk";
ALTER TABLE "repricing_liquidationen" RENAME TO "bqool_liquidationen";
ALTER TABLE "repricing_sku_pflege" RENAME CONSTRAINT "repricing_sku_pflege_tenant_id_land_sku_pk" TO "bqool_sku_pflege_tenant_id_land_sku_pk";
ALTER TABLE "repricing_sku_pflege" RENAME CONSTRAINT "repricing_sku_pflege_tenant_id_tenants_id_fk" TO "bqool_sku_pflege_tenant_id_tenants_id_fk";
ALTER TABLE "repricing_sku_pflege" RENAME TO "bqool_sku_pflege";
ALTER TABLE "repricing_vorschlaege" RENAME CONSTRAINT "repricing_vorschlaege_pkey" TO "bqool_vorschlaege_pkey";
ALTER TABLE "repricing_vorschlaege" RENAME CONSTRAINT "repricing_vorschlaege_tenant_id_tenants_id_fk" TO "bqool_vorschlaege_tenant_id_tenants_id_fk";
ALTER INDEX "repricing_vorschlaege_offen_idx" RENAME TO "bqool_vorschlaege_offen_idx";
ALTER INDEX "repricing_vorschlaege_sku_idx" RENAME TO "bqool_vorschlaege_sku_idx";
ALTER TABLE "repricing_vorschlaege" RENAME TO "bqool_vorschlaege";
ALTER TABLE "repricing_gebuehren" RENAME CONSTRAINT "repricing_gebuehren_tenant_id_land_sku_quelle_pk" TO "bqool_gebuehren_tenant_id_land_sku_quelle_pk";
ALTER TABLE "repricing_gebuehren" RENAME CONSTRAINT "repricing_gebuehren_tenant_id_tenants_id_fk" TO "bqool_gebuehren_tenant_id_tenants_id_fk";
ALTER TABLE "repricing_gebuehren" RENAME TO "bqool_gebuehren";

DROP TABLE "archiv_bqool_zuweisungen_vorher";
DROP TABLE "archiv_bqool_liquidationen_vorher";
DROP TABLE "archiv_bqool_vorschlaege_vorher";
DROP TABLE "archiv_bqool_gebuehren_vorher";

-- Archiv wieder beschreibbar und unter dem alten Namen.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['listings','exporte','laeufe','berichte','leistung','tageswerte','berichte_offen'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'archiv_bqool_' || t || '_nur_lesen', 'archiv_bqool_' || t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'archiv_bqool_' || t || '_nur_lesen_truncate', 'archiv_bqool_' || t);
    EXECUTE format('ALTER TABLE %I RENAME TO %I', 'archiv_bqool_' || t, 'bqool_' || t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS "archiv_bqool_nur_lesen"();

UPDATE "verlust_ausnahmen" SET "grund" = 'BQool-Liquidation' || substr("grund", 22) WHERE "grund" LIKE 'Repricing-Liquidation%';
UPDATE "tenants" SET "settings" = ("settings" - 'repricing' - 'archivBqool') || jsonb_build_object('bqool', "settings"->'archivBqool') WHERE "settings" ? 'archivBqool';
UPDATE "tasks" SET "system_key" = 'bqool-' || substr("system_key", 11), "link" = replace("link", '/repricer/profitguard', '/repricer/bqool')
  WHERE "system_key" IN ('repricing-abgleich', 'repricing-zustand-pruefen', 'repricing-leiter', 'repricing-rueckkehr', 'repricing-liquidation-ablauf')
    AND NOT EXISTS (SELECT 1 FROM "tasks" t2 WHERE t2."tenant_id" = "tasks"."tenant_id" AND t2."system_key" = 'bqool-' || substr("tasks"."system_key", 11));
UPDATE "knowledge_entries" SET
  "title" = regexp_replace("title", '^\[veraltet\] ', ''),
  "body" = regexp_replace("body", '^Veraltet: BQool wurde als Repricer durch ProfitGuard \(ProfitPath\) abgelöst – Angaben zu BQool gelten nicht mehr\.\n\n', ''),
  "tags" = array_remove(array_remove("tags", 'bqool-veraltet'), 'veraltet')
  WHERE 'bqool-veraltet' = ANY("tags");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks','uploads','meldungen','amazon_todos','sellerboard_sku_stats','zeitbloecke'] LOOP
    EXECUTE format($f$UPDATE %I SET "link" = replace("link", '/repricer/profitguard', '/repricer/bqool') WHERE "link" LIKE '%%/repricer/profitguard%%'$f$, t);
  END LOOP;
END $$;

DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794646735876;

COMMIT;
