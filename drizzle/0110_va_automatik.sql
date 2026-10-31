CREATE TABLE "va_automatik" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"typ" text NOT NULL,
	"bezug_id" uuid NOT NULL,
	"kategorie" text NOT NULL,
	"ziel" text NOT NULL,
	"grund" text NOT NULL,
	"modus" text NOT NULL,
	"status" text NOT NULL,
	"titel" text NOT NULL,
	"betrag" numeric(14, 4),
	"frist" date,
	"thread_id" text,
	"fehler" text,
	"am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "va_stand" ADD COLUMN "uebersicht_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "va_threads" ADD COLUMN "claim_id" uuid;--> statement-breakpoint
ALTER TABLE "va_threads" ADD COLUMN "auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "va_threads" ADD COLUMN "eintraege" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "va_threads" ADD COLUMN "ludwig_info_am" date;--> statement-breakpoint
ALTER TABLE "va_threads" ADD COLUMN "verpasst_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "va_automatik" ADD CONSTRAINT "va_automatik_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "va_automatik_schluessel_uq" ON "va_automatik" USING btree ("tenant_id","schluessel");--> statement-breakpoint
CREATE INDEX "va_automatik_am_idx" ON "va_automatik" USING btree ("tenant_id","am");--> statement-breakpoint
ALTER TABLE "va_threads" ADD CONSTRAINT "va_threads_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "va_threads_claim_idx" ON "va_threads" USING btree ("tenant_id","claim_id");