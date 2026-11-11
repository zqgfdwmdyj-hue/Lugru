ALTER TABLE "video_auftraege" ADD COLUMN "neu_motive" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "stil" text DEFAULT 'vollbild' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "figuren" text;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "bild_qualitaet" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "referenzen" jsonb DEFAULT '[]'::jsonb NOT NULL;