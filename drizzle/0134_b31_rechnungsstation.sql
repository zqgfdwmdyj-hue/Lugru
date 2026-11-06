CREATE TABLE "beleg_stapel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quelle" text NOT NULL,
	"name" text NOT NULL,
	"gestartet_von" uuid,
	"gestartet_von_name" text,
	"beendet_am" timestamp with time zone,
	"aufgabe_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stapel_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ampel" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "pruef_gruende" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "positionen" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ust" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "zahlungsart" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "faellig_am" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "zuordnung" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "zugeordnet_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "seiten" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bild_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "aufgenommen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "geprueft_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "geprueft_von_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "drive_datei_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "drive_fehler" text;--> statement-breakpoint
ALTER TABLE "beleg_stapel" ADD CONSTRAINT "beleg_stapel_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beleg_stapel" ADD CONSTRAINT "beleg_stapel_gestartet_von_users_id_fk" FOREIGN KEY ("gestartet_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beleg_stapel_idx" ON "beleg_stapel" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_stapel_id_beleg_stapel_id_fk" FOREIGN KEY ("stapel_id") REFERENCES "public"."beleg_stapel"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_stapel_idx" ON "invoices" USING btree ("stapel_id");