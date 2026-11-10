CREATE TABLE "abverkauf_anschreiben" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"charge_id" uuid,
	"preisliste_id" uuid,
	"kanal" text NOT NULL,
	"code" text NOT NULL,
	"betreff" text NOT NULL,
	"text" text NOT NULL,
	"ki" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'entwurf' NOT NULL,
	"fehler" text,
	"freigegeben_am" timestamp with time zone,
	"versendet_am" timestamp with time zone,
	"antwort_am" timestamp with time zone,
	"umsatz" numeric(12, 2),
	"marge" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abverkauf_chargen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nr" integer NOT NULL,
	"kanal" text NOT NULL,
	"preisliste_id" uuid,
	"freigegeben_am" timestamp with time zone DEFAULT now() NOT NULL,
	"freigegeben_von" uuid,
	"versendet_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abverkauf_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"firma" text NOT NULL,
	"strasse" text,
	"plz" text,
	"ort" text,
	"land" text DEFAULT 'DE' NOT NULL,
	"kategorie" text,
	"email" text,
	"email_quelle" text,
	"website" text,
	"quelle" text NOT NULL,
	"quelle_datum" text NOT NULL,
	"status" text DEFAULT 'neu' NOT NULL,
	"kontaktweg" text DEFAULT 'brief' NOT NULL,
	"rechtsgrundlage" text NOT NULL,
	"zweck" text NOT NULL,
	"einwilligung" text,
	"bestandskunde" boolean DEFAULT false NOT NULL,
	"loeschen_am" text NOT NULL,
	"schluessel" text NOT NULL,
	"import_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abverkauf_preislisten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aufschlag_prozent" numeric(6, 2) NOT NULL,
	"staffeln" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"positionen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"erstellt_von" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abverkauf_sperrliste" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schluessel" text NOT NULL,
	"grund" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abverkauf_anschreiben" ADD CONSTRAINT "abverkauf_anschreiben_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_chargen" ADD CONSTRAINT "abverkauf_chargen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_chargen" ADD CONSTRAINT "abverkauf_chargen_freigegeben_von_users_id_fk" FOREIGN KEY ("freigegeben_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD CONSTRAINT "abverkauf_leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_preislisten" ADD CONSTRAINT "abverkauf_preislisten_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_preislisten" ADD CONSTRAINT "abverkauf_preislisten_erstellt_von_users_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_sperrliste" ADD CONSTRAINT "abverkauf_sperrliste_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "abverkauf_anschreiben_code" ON "abverkauf_anschreiben" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "abverkauf_anschreiben_lead" ON "abverkauf_anschreiben" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "abverkauf_chargen_idx" ON "abverkauf_chargen" USING btree ("tenant_id","nr");--> statement-breakpoint
CREATE UNIQUE INDEX "abverkauf_leads_schluessel" ON "abverkauf_leads" USING btree ("tenant_id","schluessel");--> statement-breakpoint
CREATE INDEX "abverkauf_leads_status" ON "abverkauf_leads" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "abverkauf_preislisten_idx" ON "abverkauf_preislisten" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "abverkauf_sperrliste_key" ON "abverkauf_sperrliste" USING btree ("tenant_id","schluessel");