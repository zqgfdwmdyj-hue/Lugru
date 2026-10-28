CREATE TABLE "sas_brand_evidence" (
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sas_brand_evidence_brand_id_invoice_id_pk" PRIMARY KEY("brand_id","invoice_id")
);
--> statement-breakpoint
ALTER TABLE "sas_brands" ADD COLUMN "sales_rows" integer;--> statement-breakpoint
ALTER TABLE "sas_brands" ADD COLUMN "invoices_confirmed" integer;--> statement-breakpoint
ALTER TABLE "sas_brands" ADD COLUMN "invoices_unsure" integer;--> statement-breakpoint
ALTER TABLE "sas_brand_evidence" ADD CONSTRAINT "sas_brand_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sas_brand_evidence" ADD CONSTRAINT "sas_brand_evidence_brand_id_sas_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."sas_brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sas_brand_evidence" ADD CONSTRAINT "sas_brand_evidence_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sas_brand_evidence" ADD CONSTRAINT "sas_brand_evidence_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sas_brand_evidence_tenant_idx" ON "sas_brand_evidence" USING btree ("tenant_id");