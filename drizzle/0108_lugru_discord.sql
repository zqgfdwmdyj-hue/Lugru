CREATE TABLE "lugru_kanaele" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kanal_id" text NOT NULL,
	"name" text,
	"guild_id" text,
	"cursor" text,
	"historie_vor" text,
	"historie_fertig" boolean DEFAULT false NOT NULL,
	"historie_bis" timestamp with time zone,
	"gelesen" integer DEFAULT 0 NOT NULL,
	"erkannt" integer DEFAULT 0 NOT NULL,
	"reaktionen_am" timestamp with time zone,
	"tief_abgleich_am" timestamp with time zone,
	"letzter_lauf" timestamp with time zone,
	"fehler" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ALTER COLUMN "extern_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "quelle" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "discord_kanal_id" text;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "discord_nachricht_id" text;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "discord_guild_id" text;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "asin_unsicher" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "shop" text;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "shop_url" text;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "ek_netto" boolean;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "max_menge" integer;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "reaktionen" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "ausverkauft_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "eingang_id" uuid;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "ampel" text;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "keepa" jsonb;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "gekauft_erkannt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lugru_deals_historie" ADD COLUMN "gekauft_erkannt_ref" text;--> statement-breakpoint
ALTER TABLE "lugru_kanaele" ADD CONSTRAINT "lugru_kanaele_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lugru_kanaele_uq" ON "lugru_kanaele" USING btree ("tenant_id","kanal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lugru_deals_historie_discord_uq" ON "lugru_deals_historie" USING btree ("tenant_id","discord_nachricht_id");--> statement-breakpoint
CREATE INDEX "lugru_deals_historie_gepostet_idx" ON "lugru_deals_historie" USING btree ("tenant_id","gepostet_am");