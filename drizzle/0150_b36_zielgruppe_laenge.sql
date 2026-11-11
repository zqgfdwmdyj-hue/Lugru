ALTER TABLE "video_auftraege" ADD COLUMN "vorlage" text;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "vorlage_art" text;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "zielgruppe" text;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "laenge_min" integer DEFAULT 16 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "laenge_max" integer DEFAULT 20 NOT NULL;