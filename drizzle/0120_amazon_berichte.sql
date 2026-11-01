CREATE TABLE "amazon_gestrandet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"art" text NOT NULL,
	"sku" text NOT NULL,
	"asin" text,
	"fnsku" text,
	"titel" text,
	"status" text,
	"grund" text,
	"seit" date,
	"auto_entfernung" date,
	"menge" integer DEFAULT 0 NOT NULL,
	"preis" numeric(14, 4),
	"aktion" text,
	"abgerufen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_kontozustand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"marktplatz" text NOT NULL,
	"land" text,
	"ahr_status" text,
	"ahr_score" integer,
	"werte" jsonb NOT NULL,
	"verstoesse" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stufe" text NOT NULL,
	"gruende" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"abgerufen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_zusatzgebuehren" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"art" text NOT NULL,
	"row_key" text NOT NULL,
	"monat" text NOT NULL,
	"datum" date,
	"sku" text,
	"asin" text,
	"fnsku" text,
	"sendung" text,
	"titel" text,
	"menge" integer,
	"betrag" numeric(14, 4) NOT NULL,
	"waehrung" text DEFAULT 'EUR' NOT NULL,
	"land" text,
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_gestrandet" ADD CONSTRAINT "amazon_gestrandet_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_kontozustand" ADD CONSTRAINT "amazon_kontozustand_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_zusatzgebuehren" ADD CONSTRAINT "amazon_zusatzgebuehren_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amazon_gestrandet_uq" ON "amazon_gestrandet" USING btree ("tenant_id","art","sku");--> statement-breakpoint
CREATE INDEX "amazon_kontozustand_idx" ON "amazon_kontozustand" USING btree ("tenant_id","marktplatz","abgerufen_am");--> statement-breakpoint
CREATE UNIQUE INDEX "amazon_zusatzgebuehren_uq" ON "amazon_zusatzgebuehren" USING btree ("tenant_id","row_key");--> statement-breakpoint
CREATE INDEX "amazon_zusatzgebuehren_monat_idx" ON "amazon_zusatzgebuehren" USING btree ("tenant_id","monat");