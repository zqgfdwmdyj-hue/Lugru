CREATE TABLE "market_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asin" text NOT NULL,
	"day" date NOT NULL,
	"price" numeric(14, 4),
	"sales_rank" integer,
	"monthly_sold" integer,
	"offers" integer
);
--> statement-breakpoint
CREATE TABLE "supplier_offer_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"day" date NOT NULL,
	"price" numeric(14, 4),
	"stock" integer
);
--> statement-breakpoint
ALTER TABLE "supplier_feeds" ADD COLUMN "prices_gross" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_feeds" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "supplier_feeds" ADD COLUMN "source_auth" text;--> statement-breakpoint
ALTER TABLE "supplier_feeds" ADD COLUMN "auto_pull" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_feeds" ADD COLUMN "pull_every_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_feeds" ADD COLUMN "last_pull_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_feeds" ADD COLUMN "last_pull_error" text;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "moq" integer;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "market_history" ADD CONSTRAINT "market_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offer_history" ADD CONSTRAINT "supplier_offer_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offer_history" ADD CONSTRAINT "supplier_offer_history_offer_id_supplier_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."supplier_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_hist_uq" ON "market_history" USING btree ("tenant_id","asin","day");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_hist_uq" ON "supplier_offer_history" USING btree ("offer_id","day");--> statement-breakpoint
CREATE INDEX "offer_hist_tenant_idx" ON "supplier_offer_history" USING btree ("tenant_id","day");--> statement-breakpoint
-- Startpunkt des Verlaufs: heutiger Stand aller vorhandenen Angebote.
INSERT INTO "supplier_offer_history" ("tenant_id", "offer_id", "day", "price", "stock") SELECT "tenant_id", "id", coalesce("updated_at", now())::date, "price", "stock" FROM "supplier_offers" ON CONFLICT DO NOTHING;
