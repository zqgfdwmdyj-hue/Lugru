CREATE TABLE "lernschleife_fragen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"monat" text NOT NULL,
	"schluessel" text NOT NULL,
	"asin" text,
	"skus" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"titel" text,
	"units" integer,
	"umsatz" real,
	"gewinn" real,
	"marge" real,
	"marke" text,
	"kategorie" text,
	"quelle" text,
	"angebote" integer,
	"letzter_einkauf" text,
	"antwort" text,
	"gruende" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"freitext" text,
	"beantwortet_am" timestamp with time zone,
	"beantwortet_von" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lernschleife_fragen" ADD CONSTRAINT "lernschleife_fragen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lernschleife_fragen" ADD CONSTRAINT "lernschleife_fragen_beantwortet_von_users_id_fk" FOREIGN KEY ("beantwortet_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lernschleife_uq" ON "lernschleife_fragen" USING btree ("tenant_id","monat","schluessel");--> statement-breakpoint
CREATE INDEX "lernschleife_tenant_idx" ON "lernschleife_fragen" USING btree ("tenant_id","created_at");