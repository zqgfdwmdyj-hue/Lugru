CREATE TABLE "invoice_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text DEFAULT 'rechnungshelfer' NOT NULL,
	"ticket" text NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"payload" jsonb NOT NULL,
	"customer_id" uuid,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"invoice_id" integer,
	"invoice_number" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_drafts" ADD CONSTRAINT "invoice_drafts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_drafts_status_idx" ON "invoice_drafts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "invoice_drafts_ticket_idx" ON "invoice_drafts" USING btree ("tenant_id","ticket");