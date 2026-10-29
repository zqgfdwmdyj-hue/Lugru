CREATE TABLE "bank_salden" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bereich" text NOT NULL,
	"user_id" uuid,
	"konto" text DEFAULT '' NOT NULL,
	"datum" date NOT NULL,
	"saldo" numeric(14, 4) NOT NULL,
	"quelle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_umsaetze" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bereich" text NOT NULL,
	"user_id" uuid,
	"schluessel" text NOT NULL,
	"konto" text,
	"buchungstag" date NOT NULL,
	"valuta" date,
	"betrag" numeric(14, 4) NOT NULL,
	"waehrung" text DEFAULT 'EUR' NOT NULL,
	"gegenpartei" text,
	"zweck" text,
	"buchungstext" text,
	"glaeubiger_id" text,
	"mandat" text,
	"gruppe" text NOT NULL,
	"kategorie" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_salden" ADD CONSTRAINT "bank_salden_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_umsaetze" ADD CONSTRAINT "bank_umsaetze_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_salden_uq" ON "bank_salden" USING btree ("tenant_id","bereich","konto","datum");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_umsaetze_uq" ON "bank_umsaetze" USING btree ("tenant_id","bereich","schluessel");--> statement-breakpoint
CREATE INDEX "bank_umsaetze_tag_idx" ON "bank_umsaetze" USING btree ("tenant_id","bereich","buchungstag");