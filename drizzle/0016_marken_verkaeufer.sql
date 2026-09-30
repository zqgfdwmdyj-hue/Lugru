ALTER TABLE "brands" ADD COLUMN "seller_name" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "seller_id" text;--> statement-breakpoint
UPDATE "brands" SET "seller_name" = 'Wittmann und Kulu GmbH' WHERE "name" = 'Grulu' AND "seller_name" IS NULL;
