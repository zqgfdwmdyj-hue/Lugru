CREATE TABLE "bqool_laeufe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"ausloeser" text NOT NULL,
	"phase" text DEFAULT 'ist' NOT NULL,
	"ist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ist_am" timestamp with time zone,
	"export_id" uuid,
	"zusammenfassung" jsonb,
	"freigabe" text,
	"freigabe_von" text,
	"freigabe_am" timestamp with time zone,
	"erinnert_am" timestamp with time zone,
	"upload" jsonb,
	"upload_status" text,
	"upload_am" timestamp with time zone,
	"kontrolle_faellig_am" timestamp with time zone,
	"kontrolle_am" timestamp with time zone,
	"kontrolle" jsonb,
	"protokoll" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fehler" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bqool_laeufe" ADD CONSTRAINT "bqool_laeufe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bqool_laeufe_tenant_idx" ON "bqool_laeufe" USING btree ("tenant_id","created_at");