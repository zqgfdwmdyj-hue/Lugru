ALTER TABLE "brands" ADD COLUMN "box_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "last_box_run_at" timestamp with time zone;