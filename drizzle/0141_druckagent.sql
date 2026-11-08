CREATE TABLE "druck_agenten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_anfang" text NOT NULL,
	"angelegt_von" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deaktiviert_am" timestamp with time zone,
	"deaktiviert_grund" text,
	"letzter_kontakt" timestamp with time zone,
	"geraet" text,
	"os" text,
	"version" text,
	"system_start" timestamp with time zone,
	"letzter_druck" timestamp with time zone,
	"drucker" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"medien" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"einstellungen" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offline_gemeldet_am" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "druck_auftraege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vorlage" text NOT NULL,
	"titel" text NOT NULL,
	"drucker" text NOT NULL,
	"medium" text NOT NULL,
	"anzahl" integer DEFAULT 1 NOT NULL,
	"seiten" integer DEFAULT 1 NOT NULL,
	"seite" text,
	"status" text DEFAULT 'wartet' NOT NULL,
	"meldung" text,
	"erstellt_von" uuid,
	"agent_id" uuid,
	"daten" "bytea",
	"vorschau" "bytea",
	"sha256" text,
	"eingabe" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"erneut_von" uuid,
	"datei_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"abgeholt_am" timestamp with time zone,
	"gedruckt_am" timestamp with time zone,
	"push_gemeldet_am" timestamp with time zone,
	"versuche" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "druck_dateien" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"art" text NOT NULL,
	"seiten" integer DEFAULT 0 NOT NULL,
	"etiketten" integer DEFAULT 0 NOT NULL,
	"raster" text,
	"sendungsnummer" text,
	"inbound_shipment_id" uuid,
	"inhalt" "bytea",
	"hochgeladen_von" uuid,
	"ueber_agent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "druck_agenten" ADD CONSTRAINT "druck_agenten_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "druck_agenten" ADD CONSTRAINT "druck_agenten_angelegt_von_users_id_fk" FOREIGN KEY ("angelegt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "druck_auftraege" ADD CONSTRAINT "druck_auftraege_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "druck_auftraege" ADD CONSTRAINT "druck_auftraege_erstellt_von_users_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "druck_auftraege" ADD CONSTRAINT "druck_auftraege_agent_id_druck_agenten_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."druck_agenten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "druck_dateien" ADD CONSTRAINT "druck_dateien_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "druck_dateien" ADD CONSTRAINT "druck_dateien_hochgeladen_von_users_id_fk" FOREIGN KEY ("hochgeladen_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "druck_agenten_tenant_idx" ON "druck_agenten" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "druck_agenten_token_idx" ON "druck_agenten" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "druck_auftraege_tenant_idx" ON "druck_auftraege" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "druck_dateien_tenant_idx" ON "druck_dateien" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "druck_dateien_sendung_idx" ON "druck_dateien" USING btree ("tenant_id","sendungsnummer");