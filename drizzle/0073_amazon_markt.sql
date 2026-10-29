CREATE TABLE "amazon_buybox" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"asin" text NOT NULL,
	"eltern_asin" text,
	"sku" text,
	"von" text,
	"bis" text,
	"sitzungen" numeric(14, 0),
	"seitenaufrufe" numeric(14, 0),
	"buybox_prozent" numeric(14, 2),
	"kaufquote_prozent" numeric(14, 2),
	"einheiten" numeric(14, 0),
	"umsatz" numeric(14, 2),
	"waehrung" text,
	"abgerufen_am" timestamp with time zone NOT NULL,
	CONSTRAINT "amazon_buybox_tenant_id_land_asin_pk" PRIMARY KEY("tenant_id","land","asin")
);
--> statement-breakpoint
CREATE TABLE "amazon_lageralter" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"fnsku" text,
	"titel" text,
	"verfuegbar" numeric(14, 0),
	"alter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stueck_mit_aufschlag" numeric(14, 0),
	"aufschlag_geschaetzt" numeric(14, 2),
	"lagerkosten_naechster_monat" numeric(14, 2),
	"empfehlung" text,
	"gesundheit" text,
	"waehrung" text,
	"stichtag" text,
	"abgerufen_am" timestamp with time zone NOT NULL,
	CONSTRAINT "amazon_lageralter_tenant_id_land_sku_pk" PRIMARY KEY("tenant_id","land","sku")
);
--> statement-breakpoint
CREATE TABLE "amazon_listungen" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"titel" text,
	"preis" numeric(14, 2),
	"menge" numeric(14, 0),
	"status" text,
	"versand" text,
	"erstellt" text,
	"abgerufen_am" timestamp with time zone NOT NULL,
	CONSTRAINT "amazon_listungen_tenant_id_land_sku_pk" PRIMARY KEY("tenant_id","land","sku")
);
--> statement-breakpoint
ALTER TABLE "amazon_buybox" ADD CONSTRAINT "amazon_buybox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_lageralter" ADD CONSTRAINT "amazon_lageralter_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_listungen" ADD CONSTRAINT "amazon_listungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amazon_listungen_asin_idx" ON "amazon_listungen" USING btree ("tenant_id","asin");