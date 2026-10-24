ALTER TABLE "files" ADD COLUMN "printed_rejected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_confirmed" boolean DEFAULT true NOT NULL;