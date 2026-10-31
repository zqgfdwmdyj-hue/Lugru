ALTER TABLE "deal_eingaenge" ADD COLUMN "historisch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "lugru_deals_historie" SET "kanal" = btrim(regexp_replace("kanal", '\s+', ' ', 'g')) WHERE "kanal" IS NOT NULL AND "kanal" <> btrim(regexp_replace("kanal", '\s+', ' ', 'g'));--> statement-breakpoint
UPDATE "lugru_kanaele" SET "name" = btrim(regexp_replace("name", '\s+', ' ', 'g')) WHERE "name" IS NOT NULL AND "name" <> btrim(regexp_replace("name", '\s+', ' ', 'g'));
