ALTER TABLE "suppliers" ADD COLUMN "sku_kuerzel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "gehoert_zu" uuid;--> statement-breakpoint
-- B15.12: Bestehende Einträge, die nur aus SKU-Kürzeln entstanden sind (kein Name, nirgends als Lieferant benutzt),
-- als Kürzel markieren. Nichts wird gelöscht; Chargen behalten ihre Zuordnung.
UPDATE "suppliers" s SET "sku_kuerzel" = true
WHERE s."name" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "invoices" i WHERE i."supplier_id" = s."id")
  AND NOT EXISTS (SELECT 1 FROM "purchase_orders" p WHERE p."supplier_id" = s."id")
  AND NOT EXISTS (SELECT 1 FROM "supplier_feeds" f WHERE f."supplier_id" = s."id")
  AND NOT EXISTS (SELECT 1 FROM "deals" d WHERE d."supplier_id" = s."id")
  AND NOT EXISTS (SELECT 1 FROM "lieferanten_profile" lp WHERE lp."supplier_id" = s."id")
  AND NOT EXISTS (SELECT 1 FROM "supplier_leads" sl WHERE sl."supplier_id" = s."id");
