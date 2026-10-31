CREATE TABLE "fahrten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quelle_id" text NOT NULL,
	"beginn" timestamp with time zone NOT NULL,
	"ende" timestamp with time zone,
	"start" text,
	"ziel" text,
	"km" numeric(8, 1) NOT NULL,
	"vorschlag" text NOT NULL,
	"art" text,
	"zweck" text,
	"bestaetigt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_meldungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"art" text NOT NULL,
	"text" text NOT NULL,
	"bezug" text,
	"schluessel" text NOT NULL,
	"status" text NOT NULL,
	"grund" text,
	"antwort" text,
	"ergebnis" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "telefon" text;--> statement-breakpoint
ALTER TABLE "lieferanten_profile" ADD COLUMN "adresse" text;--> statement-breakpoint
ALTER TABLE "lieferanten_profile" ADD COLUMN "telefon" text;--> statement-breakpoint
ALTER TABLE "fahrten" ADD CONSTRAINT "fahrten_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_meldungen" ADD CONSTRAINT "sms_meldungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fahrten_quelle_uq" ON "fahrten" USING btree ("tenant_id","quelle_id");--> statement-breakpoint
CREATE INDEX "fahrten_beginn_idx" ON "fahrten" USING btree ("tenant_id","beginn");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_meldungen_key_uq" ON "sms_meldungen" USING btree ("tenant_id","schluessel");--> statement-breakpoint
CREATE INDEX "sms_meldungen_ref_idx" ON "sms_meldungen" USING btree ("tenant_id","ref");