ALTER TABLE "brands" ADD COLUMN "vat_rate" numeric(5, 2) DEFAULT '19' NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "market" jsonb;--> statement-breakpoint
-- Marke heißt Grulu (vorher als „Kulu“ angelegt); Lebensmittel mit 7 % USt.
UPDATE "brands" SET "name" = 'Grulu', "vat_rate" = '7' WHERE "name" = 'Kulu' AND NOT EXISTS (SELECT 1 FROM "brands" b2 WHERE b2."tenant_id" = "brands"."tenant_id" AND b2."name" = 'Grulu');
