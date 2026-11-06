CREATE TABLE "abholungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dienst" text NOT NULL,
	"ort" text NOT NULL,
	"ort_name" text NOT NULL,
	"datum" date NOT NULL,
	"zeit_von" text,
	"zeit_bis" text,
	"pakete" integer NOT NULL,
	"paletten" integer DEFAULT 0 NOT NULL,
	"gewicht_kg" numeric,
	"hinweis" text,
	"status" text NOT NULL,
	"bestaetigung" text,
	"abhol_art" text,
	"kostenpflichtig" boolean,
	"fehler" text,
	"quelle" text DEFAULT 'seite' NOT NULL,
	"gebucht_von" uuid,
	"gebucht_von_name" text,
	"storniert_am" timestamp with time zone,
	"storniert_von_name" text,
	"antwort" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abholungen" ADD CONSTRAINT "abholungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abholungen" ADD CONSTRAINT "abholungen_gebucht_von_users_id_fk" FOREIGN KEY ("gebucht_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abholungen_datum_idx" ON "abholungen" USING btree ("tenant_id","datum");