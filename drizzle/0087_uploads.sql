CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"dateiname" text NOT NULL,
	"groesse" integer DEFAULT 0 NOT NULL,
	"art" text,
	"ok" boolean NOT NULL,
	"zusammenfassung" text NOT NULL,
	"hinweise" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_idx" ON "uploads" USING btree ("tenant_id","created_at");