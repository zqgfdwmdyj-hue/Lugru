ALTER TABLE "files" ADD COLUMN "printed_status" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "printed_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "printed_price_text" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "printed_price_box" jsonb;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "printed_scanned_at" timestamp with time zone;