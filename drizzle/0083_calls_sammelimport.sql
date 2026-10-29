ALTER TABLE "calls" ADD COLUMN "art" text DEFAULT 'consultant' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "inhalt_kennung" text;--> statement-breakpoint
CREATE INDEX "calls_inhalt_idx" ON "calls" USING btree ("tenant_id","inhalt_kennung");