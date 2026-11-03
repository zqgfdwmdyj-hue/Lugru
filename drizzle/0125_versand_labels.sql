CREATE TABLE "versand_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'vorlage' NOT NULL,
	"kanal" text NOT NULL,
	"absender" text DEFAULT 'lugru' NOT NULL,
	"produkt" text NOT NULL,
	"empfaenger" jsonb,
	"unsicher" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gewicht_kg" numeric,
	"masse" jsonb,
	"wert" numeric,
	"services" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gefahrgut" jsonb,
	"artikel" text,
	"sku" text,
	"menge" integer DEFAULT 1 NOT NULL,
	"preis" numeric,
	"zahlungsart" text,
	"sendungsnummer" text,
	"label_file_id" uuid,
	"order_id" uuid,
	"kosten" numeric,
	"fehler" text,
	"hinweise" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "versand_labels" ADD CONSTRAINT "versand_labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versand_labels" ADD CONSTRAINT "versand_labels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "versand_labels_tenant_idx" ON "versand_labels" USING btree ("tenant_id","created_at");