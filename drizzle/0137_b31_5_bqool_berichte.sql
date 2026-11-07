CREATE TABLE "bqool_berichte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"art" text NOT NULL,
	"land" text NOT NULL,
	"zeitraum_tage" integer DEFAULT 0 NOT NULL,
	"stichtag" text NOT NULL,
	"von" text,
	"bis" text,
	"zeilen" integer DEFAULT 0 NOT NULL,
	"buybox_anteil" numeric(6, 2),
	"sales" numeric(14, 2),
	"profit" numeric(14, 2),
	"datei" text,
	"via" text DEFAULT 'upload' NOT NULL,
	"land_quelle" text,
	"eingelesen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bqool_berichte_offen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"art" text NOT NULL,
	"datei" text NOT NULL,
	"zeitraum_tage" integer DEFAULT 0 NOT NULL,
	"stichtag" text NOT NULL,
	"daten" jsonb NOT NULL,
	"vorschlag" text,
	"begruendung" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bqool_leistung" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"sku" text NOT NULL,
	"zeitraum_tage" integer NOT NULL,
	"stichtag" text NOT NULL,
	"asin" text,
	"titel" text,
	"regel" text,
	"sales" numeric(14, 2),
	"orders" numeric(14, 2),
	"units" numeric(14, 2),
	"profit" numeric(14, 2),
	"bb_wins" numeric(14, 2),
	"lowest_win" numeric(14, 2),
	"at_min" numeric(14, 2),
	"at_max" numeric(14, 2),
	"below_min" numeric(14, 2),
	"avg_offers" numeric(14, 2),
	"avg_position" numeric(14, 2),
	"reprice" numeric(14, 2),
	"price_up" numeric(14, 2),
	"price_down" numeric(14, 2),
	"price_changes" numeric(14, 2),
	"bb_lost_amazon" numeric(14, 2),
	"bb_lost_fba" numeric(14, 2),
	"bb_lost_fbm" numeric(14, 2),
	"zusatz" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eingelesen_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bqool_leistung_tenant_id_land_sku_zeitraum_tage_stichtag_pk" PRIMARY KEY("tenant_id","land","sku","zeitraum_tage","stichtag")
);
--> statement-breakpoint
CREATE TABLE "bqool_tageswerte" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"tag" text NOT NULL,
	"sales" numeric(14, 2),
	"sales_fba" numeric(14, 2),
	"sales_fbm" numeric(14, 2),
	"orders" numeric(14, 2),
	"units" numeric(14, 2),
	"profit" numeric(14, 2),
	"bb_wins" numeric(14, 2),
	"zusatz" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"datei" text,
	"eingelesen_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bqool_tageswerte_tenant_id_land_tag_pk" PRIMARY KEY("tenant_id","land","tag")
);
--> statement-breakpoint
ALTER TABLE "bqool_berichte" ADD CONSTRAINT "bqool_berichte_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bqool_berichte_offen" ADD CONSTRAINT "bqool_berichte_offen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bqool_leistung" ADD CONSTRAINT "bqool_leistung_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bqool_tageswerte" ADD CONSTRAINT "bqool_tageswerte_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bqool_berichte_uq" ON "bqool_berichte" USING btree ("tenant_id","art","land","zeitraum_tage","stichtag");--> statement-breakpoint
CREATE INDEX "bqool_berichte_tenant_idx" ON "bqool_berichte" USING btree ("tenant_id","eingelesen_am");--> statement-breakpoint
CREATE INDEX "bqool_berichte_offen_tenant_idx" ON "bqool_berichte_offen" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "bqool_leistung_stichtag_idx" ON "bqool_leistung" USING btree ("tenant_id","stichtag");