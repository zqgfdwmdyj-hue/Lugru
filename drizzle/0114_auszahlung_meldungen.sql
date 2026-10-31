CREATE TABLE "amazon_auszahlung_meldungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email_id" uuid,
	"kennung" text NOT NULL,
	"betrag" numeric(14, 4),
	"waehrung" text DEFAULT 'EUR' NOT NULL,
	"marktplatz" text,
	"konto_endung" text,
	"gemeldet_am" timestamp with time zone NOT NULL,
	"erwartet_von" date NOT NULL,
	"erwartet_bis" date NOT NULL,
	"vorgang_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_auszahlung_meldungen" ADD CONSTRAINT "amazon_auszahlung_meldungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_auszahlung_meldungen" ADD CONSTRAINT "amazon_auszahlung_meldungen_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amazon_auszahlung_meldungen_uq" ON "amazon_auszahlung_meldungen" USING btree ("tenant_id","kennung");--> statement-breakpoint
CREATE INDEX "amazon_auszahlung_meldungen_erwartet_idx" ON "amazon_auszahlung_meldungen" USING btree ("tenant_id","erwartet_bis");