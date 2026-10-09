CREATE TABLE "supplier_lead_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'laeuft' NOT NULL,
	"message" text,
	"found" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "supplier_leads" ADD COLUMN "findings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_leads" ADD COLUMN "vat_id" text;--> statement-breakpoint
ALTER TABLE "supplier_lead_searches" ADD CONSTRAINT "supplier_lead_searches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_lead_searches_idx" ON "supplier_lead_searches" USING btree ("tenant_id","created_at");--> statement-breakpoint
UPDATE "supplier_leads" SET "findings" = jsonb_build_array(jsonb_build_object('source','lucid','label','Verpackungsregister','detail',coalesce("register_number",''),'brand',coalesce("search_brands"->>0,''),'at',to_char("created_at" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))) WHERE "source" = 'lucid' AND "findings" = '[]'::jsonb;
