CREATE TABLE "artikel_zustand" (
	"tenant_id" uuid NOT NULL,
	"land" text DEFAULT '*' NOT NULL,
	"sku" text NOT NULL,
	"zustand" text NOT NULL,
	"quelle" text NOT NULL,
	"gesetzt_von" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artikel_zustand_tenant_id_land_sku_pk" PRIMARY KEY("tenant_id","land","sku")
);
--> statement-breakpoint
CREATE TABLE "bqool_sku_pflege" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"sku" text NOT NULL,
	"ueber_seit" date,
	"ohne_buybox_seit" date,
	"schnelldreher" boolean DEFAULT false NOT NULL,
	"schnell_quelle" text,
	"schnell_seit" timestamp with time zone,
	"schnell_bis" date,
	"aktivieren" boolean DEFAULT false NOT NULL,
	"bb_ueber_max_seit" date,
	"max_soll" numeric(12, 2),
	"check_zuletzt" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bqool_sku_pflege_tenant_id_land_sku_pk" PRIMARY KEY("tenant_id","land","sku")
);
--> statement-breakpoint
CREATE TABLE "bqool_vorschlaege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"sku" text NOT NULL,
	"art" text NOT NULL,
	"von_regel" text,
	"nach_regel" text,
	"min" numeric(12, 2),
	"gruende" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"daten" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"potenzial" numeric(12, 2),
	"status" text DEFAULT 'offen' NOT NULL,
	"spaeter_bis" date,
	"entschieden_am" timestamp with time zone,
	"entschieden_von" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bqool_liquidationen" ADD COLUMN "rueckkehr_grund" text;--> statement-breakpoint
ALTER TABLE "bqool_liquidationen" ADD COLUMN "rueckkehr_regel" text;--> statement-breakpoint
ALTER TABLE "bqool_liquidationen" ADD COLUMN "bis" date;--> statement-breakpoint
ALTER TABLE "bqool_liquidationen" ADD COLUMN "dauerhaft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bqool_liquidationen" ADD COLUMN "verlaengert" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bqool_liquidationen" ADD COLUMN "ablauf_gemeldet_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artikel_zustand" ADD CONSTRAINT "artikel_zustand_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bqool_sku_pflege" ADD CONSTRAINT "bqool_sku_pflege_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bqool_vorschlaege" ADD CONSTRAINT "bqool_vorschlaege_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bqool_vorschlaege_offen_idx" ON "bqool_vorschlaege" USING btree ("tenant_id","status","art");--> statement-breakpoint
CREATE INDEX "bqool_vorschlaege_sku_idx" ON "bqool_vorschlaege" USING btree ("tenant_id","land","sku","art");--> statement-breakpoint
UPDATE "bqool_liquidationen" SET "bis" = ("aktiv_seit" AT TIME ZONE 'Europe/Berlin')::date + 45 WHERE "bis" IS NULL AND "aktiv_seit" IS NOT NULL AND "status" <> 'beendet';
