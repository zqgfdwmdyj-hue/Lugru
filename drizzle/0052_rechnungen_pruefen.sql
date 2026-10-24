ALTER TABLE "invoices" ADD COLUMN "doc_type" text DEFAULT 'rechnung' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "checks" jsonb DEFAULT '{}'::jsonb NOT NULL;