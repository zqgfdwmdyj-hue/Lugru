CREATE TABLE "scan_eintraege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"modus" text DEFAULT 'laden' NOT NULL,
	"code" text NOT NULL,
	"asin" text,
	"titel" text,
	"shop_url" text,
	"preis" numeric(12, 2) NOT NULL,
	"netto" boolean DEFAULT false NOT NULL,
	"rueckverguetung" numeric(5, 2) DEFAULT 0 NOT NULL,
	"ek_netto" numeric(12, 2),
	"menge" integer,
	"ampel" text,
	"land" text,
	"gewinn_stueck" numeric(12, 2),
	"roi" numeric(8, 1),
	"roi_pa" numeric(8, 0),
	"empfohlene_menge" integer,
	"ergebnis" jsonb,
	"fehler" text,
	"offline" boolean DEFAULT false NOT NULL,
	"gescannt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"aktion" text,
	"liste_menge" integer,
	"liste_preis" numeric(12, 2),
	"liste_ort" text,
	"deal_eingang_id" uuid,
	"belege" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beleg_ablage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"hash" text NOT NULL,
	"dateiname" text NOT NULL,
	"groesse" integer DEFAULT 0 NOT NULL,
	"art" text,
	"status" text NOT NULL,
	"invoice_id" uuid,
	"dublette_von" uuid,
	"dublette_grund" text,
	"lieferant" text,
	"datum" text,
	"betrag" numeric(12, 2),
	"nummer" text,
	"ordner" text,
	"zielname" text,
	"pfad" text,
	"verschoben_am" timestamp with time zone,
	"loeschen_freigegeben_am" timestamp with time zone,
	"loeschen_freigegeben_von" uuid,
	"geloescht_am" timestamp with time zone,
	"meldung" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scan_eintraege" ADD CONSTRAINT "scan_eintraege_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_eintraege" ADD CONSTRAINT "scan_eintraege_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_ablage" ADD CONSTRAINT "beleg_ablage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_ablage" ADD CONSTRAINT "beleg_ablage_agent_id_druck_agenten_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."druck_agenten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_ablage" ADD CONSTRAINT "beleg_ablage_loeschen_freigegeben_von_users_id_fk" FOREIGN KEY ("loeschen_freigegeben_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_eintraege_tenant_idx" ON "scan_eintraege" USING btree ("tenant_id","gescannt_am");--> statement-breakpoint
CREATE INDEX "beleg_ablage_hash_idx" ON "beleg_ablage" USING btree ("tenant_id","hash");--> statement-breakpoint
CREATE INDEX "beleg_ablage_zeit_idx" ON "beleg_ablage" USING btree ("tenant_id","created_at");