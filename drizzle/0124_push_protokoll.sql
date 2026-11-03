ALTER TABLE "meldungen" ADD COLUMN "art" text DEFAULT 'sonstiges' NOT NULL;--> statement-breakpoint
ALTER TABLE "meldungen" ADD COLUMN "kritisch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meldungen" ADD COLUMN "zustand" text DEFAULT 'gesendet' NOT NULL;--> statement-breakpoint
ALTER TABLE "meldungen" ADD COLUMN "push_gesendet" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meldungen" ADD COLUMN "push_fehler" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meldungen" ADD COLUMN "discord" boolean;--> statement-breakpoint
ALTER TABLE "meldungen" ADD COLUMN "zugestellt_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meldungen" ADD COLUMN "nur_abo_id" uuid;--> statement-breakpoint
ALTER TABLE "push_abos" ADD COLUMN "fehler_anzahl" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "push_abos" ADD COLUMN "abgelaufen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_abos" ADD COLUMN "ok_am" timestamp with time zone;