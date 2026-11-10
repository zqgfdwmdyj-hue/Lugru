CREATE TABLE "abverkauf_anfragen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kampagne_id" uuid NOT NULL,
	"anschreiben_code" text,
	"firma" text NOT NULL,
	"ust_id" text,
	"ust_id_ok" boolean DEFAULT false NOT NULL,
	"kontakt" text,
	"wunsch" text,
	"menge" text,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abverkauf_briefe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"anschreiben_id" uuid,
	"charge_id" uuid,
	"anbieter" text NOT NULL,
	"modus" text NOT NULL,
	"testbrief" boolean DEFAULT false NOT NULL,
	"externe_id" text,
	"status" text NOT NULL,
	"status_text" text,
	"seiten" integer DEFAULT 1 NOT NULL,
	"kosten_netto" numeric(10, 2),
	"freigegeben_von" uuid,
	"status_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abverkauf_kampagnen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"zielgruppe" text NOT NULL,
	"code" text NOT NULL,
	"positionen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filter" jsonb NOT NULL,
	"brieftext" text NOT NULL,
	"aufschlag_prozent" numeric(6, 2) DEFAULT 10 NOT NULL,
	"mindest_restlaufzeit_monate" integer DEFAULT 6 NOT NULL,
	"nachfass_tage" integer,
	"offene_punkte" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_von" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_ablage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"datei_id" text NOT NULL,
	"dateiname" text NOT NULL,
	"hash" text,
	"art" text NOT NULL,
	"vorschlag" text NOT NULL,
	"zustand" text DEFAULT 'vorschlag' NOT NULL,
	"invoice_id" uuid,
	"dublette_von" text,
	"dublette_grund" text,
	"lieferant" text,
	"datum" text,
	"betrag" numeric(12, 2),
	"nummer" text,
	"ziel_ordner" text,
	"ziel_name" text,
	"freigegeben_am" timestamp with time zone,
	"freigegeben_von" uuid,
	"ausgefuehrt_am" timestamp with time zone,
	"loeschen_freigegeben_am" timestamp with time zone,
	"loeschen_freigegeben_von" uuid,
	"papierkorb_am" timestamp with time zone,
	"meldung" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abverkauf_anschreiben" ADD COLUMN "adelprep_beilage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "abverkauf_anschreiben" ADD COLUMN "kampagne_id" uuid;--> statement-breakpoint
ALTER TABLE "abverkauf_anschreiben" ADD COLUMN "nachfass_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "adelprep" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "abverkauf_leads" ADD COLUMN "groesse" text;--> statement-breakpoint
ALTER TABLE "abverkauf_anfragen" ADD CONSTRAINT "abverkauf_anfragen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_briefe" ADD CONSTRAINT "abverkauf_briefe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_briefe" ADD CONSTRAINT "abverkauf_briefe_freigegeben_von_users_id_fk" FOREIGN KEY ("freigegeben_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_kampagnen" ADD CONSTRAINT "abverkauf_kampagnen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abverkauf_kampagnen" ADD CONSTRAINT "abverkauf_kampagnen_erstellt_von_users_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_ablage" ADD CONSTRAINT "drive_ablage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_ablage" ADD CONSTRAINT "drive_ablage_freigegeben_von_users_id_fk" FOREIGN KEY ("freigegeben_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_ablage" ADD CONSTRAINT "drive_ablage_loeschen_freigegeben_von_users_id_fk" FOREIGN KEY ("loeschen_freigegeben_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abverkauf_anfragen_idx" ON "abverkauf_anfragen" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "abverkauf_briefe_idx" ON "abverkauf_briefe" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "abverkauf_briefe_anschreiben" ON "abverkauf_briefe" USING btree ("tenant_id","anschreiben_id");--> statement-breakpoint
CREATE UNIQUE INDEX "abverkauf_kampagnen_code" ON "abverkauf_kampagnen" USING btree ("code");--> statement-breakpoint
CREATE INDEX "abverkauf_kampagnen_idx" ON "abverkauf_kampagnen" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_ablage_datei" ON "drive_ablage" USING btree ("tenant_id","datei_id");--> statement-breakpoint
CREATE INDEX "drive_ablage_zustand" ON "drive_ablage" USING btree ("tenant_id","zustand");--> statement-breakpoint
CREATE INDEX "drive_ablage_hash" ON "drive_ablage" USING btree ("tenant_id","hash");