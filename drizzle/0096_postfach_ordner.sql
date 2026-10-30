ALTER TABLE "emails" ADD COLUMN "an" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "ordner" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "ordner" jsonb;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "nur_abruf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "fehler_art" text;