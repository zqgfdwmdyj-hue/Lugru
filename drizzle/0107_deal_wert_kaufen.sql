CREATE TABLE "lugru_deals_historie" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"extern_id" bigint NOT NULL,
	"asin" text NOT NULL,
	"titel" text,
	"quellmarkt" text,
	"zielmarkt" text,
	"ek_eur" numeric(14, 4),
	"vk_eur" numeric(14, 4),
	"gewinn_eur" numeric(14, 4),
	"marge_prozent" real,
	"verkaeufe_monat" integer,
	"gruppe" text,
	"kanal" text,
	"status" text,
	"kaeufe" integer DEFAULT 0 NOT NULL,
	"nicht_verfuegbar" integer DEFAULT 0 NOT NULL,
	"reaktionen_am" timestamp with time zone,
	"gepostet_am" timestamp with time zone NOT NULL,
	"bewaehrt" boolean,
	"bewaehrt_grund" text,
	"aktualisiert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "daumen" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "daumen_grund" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "daumen_weg" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "daumen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "gekauft_menge" integer;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "gekauft_preis" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "gekauft_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "gekauft_weg" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "gekauft_ref" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "discord_ref" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "ergebnis" jsonb;--> statement-breakpoint
ALTER TABLE "meldungen" ADD COLUMN "aktionen" jsonb;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD CONSTRAINT "lugru_deals_historie_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lugru_deals_historie_uq" ON "lugru_deals_historie" USING btree ("tenant_id","extern_id");--> statement-breakpoint
CREATE INDEX "lugru_deals_historie_asin_idx" ON "lugru_deals_historie" USING btree ("tenant_id","asin");