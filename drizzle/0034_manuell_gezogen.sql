ALTER TABLE "supplier_offers" ADD COLUMN "origin" text DEFAULT 'feed' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
-- Bisher gescannte Angebote erkennen: nur der Scan speichert die Währung.
UPDATE "supplier_offers" SET "origin" = 'scan', "scanned_at" = coalesce("last_seen_at", now()) WHERE "currency" IS NOT NULL;
