ALTER TABLE "assistant_log" ADD COLUMN "auftrag" text;--> statement-breakpoint
ALTER TABLE "assistant_log" ADD COLUMN "ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_log" ADD COLUMN "stufe" text;--> statement-breakpoint
ALTER TABLE "assistant_log" ADD COLUMN "undo" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_log" ADD COLUMN "rueckgaengig_am" timestamp with time zone;