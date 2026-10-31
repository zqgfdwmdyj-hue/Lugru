ALTER TABLE "amazon_lagergebuehren" ADD COLUMN "laengste_seite_cm" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "amazon_lagergebuehren" ADD COLUMN "gewicht_kg" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "amazon_lagergebuehren" ADD COLUMN "uebergross" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "amazon_lagergebuehren" ADD COLUMN "gefahrgut" text;--> statement-breakpoint
ALTER TABLE "amazon_lagergebuehren" ADD COLUMN "rabatt" numeric(14, 4);--> statement-breakpoint
UPDATE "amazon_lagergebuehren" SET "uebergross" = true WHERE "groesse" ~* 'over\s*-?size|übergr|uebergr|bulky|sperrig';