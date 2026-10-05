ALTER TABLE "amazon_removal_shipments" ADD COLUMN "last_event" text;--> statement-breakpoint
ALTER TABLE "amazon_removal_shipments" ADD COLUMN "last_event_at" date;--> statement-breakpoint
ALTER TABLE "amazon_removal_shipments" ADD COLUMN "source" text DEFAULT 'report' NOT NULL;