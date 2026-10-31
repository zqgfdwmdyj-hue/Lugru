ALTER TABLE "memberships" ADD COLUMN "deaktiviert_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "deaktiviert_grund" text;