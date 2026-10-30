ALTER TABLE "amazon_todos" ADD COLUMN "skus" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "amazon_todos" ADD COLUMN "marktplatz" text;--> statement-breakpoint
ALTER TABLE "amazon_todos" ADD COLUMN "link" text;