CREATE TABLE "deal_bestellmails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"supplier_id" uuid,
	"bestellung_id" uuid,
	"an" text NOT NULL,
	"kopie_an" text,
	"betreff" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'entwurf' NOT NULL,
	"fehler" text,
	"message_id" text,
	"gesendet_am" timestamp with time zone,
	"gesendet_von" uuid,
	"antwort_id" uuid,
	"antwort_am" timestamp with time zone,
	"sendungsnummer" text,
	"rechnung_erhalten" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lieferanten_profile" ADD COLUMN "ansprechpartner" text;--> statement-breakpoint
ALTER TABLE "lieferanten_profile" ADD COLUMN "zahlungsweg" text;--> statement-breakpoint
ALTER TABLE "lieferanten_profile" ADD COLUMN "rechnung_mit_ean" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "lieferanten_profile" ADD COLUMN "deal_quellen" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "daumen_gruende" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "daumen_freitext" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "daumen_frage_ref" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "daumen_frage_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "verpackung" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "ean_abweichend" boolean;--> statement-breakpoint
ALTER TABLE "deal_bestellmails" ADD CONSTRAINT "deal_bestellmails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_bestellmails" ADD CONSTRAINT "deal_bestellmails_deal_id_deal_eingaenge_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal_eingaenge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_bestellmails" ADD CONSTRAINT "deal_bestellmails_gesendet_von_users_id_fk" FOREIGN KEY ("gesendet_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_bestellmails" ADD CONSTRAINT "deal_bestellmails_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_bestellmails_deal_idx" ON "deal_bestellmails" USING btree ("tenant_id","deal_id");--> statement-breakpoint
CREATE INDEX "deal_bestellmails_bestellung_idx" ON "deal_bestellmails" USING btree ("tenant_id","bestellung_id");--> statement-breakpoint
CREATE INDEX "deal_bestellmails_msg_idx" ON "deal_bestellmails" USING btree ("tenant_id","message_id");