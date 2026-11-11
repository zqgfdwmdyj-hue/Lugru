CREATE TABLE "abverkauf_lead_laeufe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quelle" text NOT NULL,
	"status" text DEFAULT 'laeuft' NOT NULL,
	"neu" integer DEFAULT 0 NOT NULL,
	"zusammengefuehrt" integer DEFAULT 0 NOT NULL,
	"verworfen" integer DEFAULT 0 NOT NULL,
	"kosten" numeric(10, 2) DEFAULT 0 NOT NULL,
	"waehrung" text DEFAULT 'EUR' NOT NULL,
	"budget" numeric(10, 2),
	"meldung" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"beendet_am" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "rechtsform" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "ust_id" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "register_nr" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "marken" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "mitarbeiter" integer;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "anzahl_asins" integer;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "letzte_aktivitaet" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "impressum_url" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "impressum_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "impressum_hinweis" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "punkte" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "prioritaet" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "empf_ziel" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "empf_beilage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "markierungen" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "ausschluss" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "konflikt_freigabe" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "bewertet_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "letzter_brief_am" text;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "verlauf" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "abverkauf_lead_laeufe" ADD CONSTRAINT "abverkauf_lead_laeufe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abverkauf_lead_laeufe_idx" ON "abverkauf_lead_laeufe" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "abverkauf_leads_prio" ON "abverkauf_leads" USING btree ("tenant_id","prioritaet");