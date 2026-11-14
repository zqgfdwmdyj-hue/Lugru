ALTER TABLE "video_clips" ADD COLUMN "art" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_worker" ADD COLUMN "clip_ordner" jsonb;--> statement-breakpoint
ALTER TABLE "video_worker" ADD COLUMN "clip_pruefen_ab" timestamp with time zone;