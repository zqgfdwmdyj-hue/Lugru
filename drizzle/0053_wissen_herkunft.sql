ALTER TABLE "knowledge_entries" ADD COLUMN "origin" text DEFAULT 'notiz' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "verified_by" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Vorhandene Einträge einordnen: automatische Recherche, mitgelieferte Anleitungen (ohne Bearbeiter), sonst eigene Notizen.
UPDATE "knowledge_entries" SET "origin" = 'recherche' WHERE 'recherche' = ANY("tags") OR "category" = 'Recherche';--> statement-breakpoint
UPDATE "knowledge_entries" SET "origin" = 'anleitung' WHERE "origin" = 'notiz' AND "updated_by" IS NULL;
