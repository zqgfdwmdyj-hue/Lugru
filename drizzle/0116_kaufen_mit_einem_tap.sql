CREATE TABLE "shop_profil" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kuerzel" text NOT NULL,
	"name" text NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"link_art" text DEFAULT 'produktseite' NOT NULL,
	"link_muster" text,
	"hinweis" text,
	"payback" text,
	"aktiv" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aktualisiert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "kauf_nr" integer;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "kauf" jsonb;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "kauf_vorbereitet_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "kauf_vorbereitet_menge" integer;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "kauf_erinnert_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_profil" ADD CONSTRAINT "shop_profil_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_profil_uq" ON "shop_profil" USING btree ("tenant_id","kuerzel");--> statement-breakpoint
CREATE INDEX "deal_eingaenge_kauf_nr_idx" ON "deal_eingaenge" USING btree ("tenant_id","kauf_nr");--> statement-breakpoint
-- Kaufen mit einem Tap §4: keine Budgetgrenze je Deal/Tag/Woche – gespeicherte Grenzen auf 0 (= Standard) zurück.
UPDATE "tenants" SET "settings" = "settings" #- '{dealEingang,budgetJeDeal}' #- '{dealEingang,budgetJeTag}' #- '{dealEingang,budgetJeWoche}' WHERE "settings" ? 'dealEingang';
