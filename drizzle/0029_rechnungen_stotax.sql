CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"street" text NOT NULL,
	"zip" text NOT NULL,
	"city" text NOT NULL,
	"country" text DEFAULT 'DE' NOT NULL,
	"vat_id" text,
	"email" text,
	"customer_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ebay_invoices" ADD COLUMN "stotax_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ebay_invoices" ADD COLUMN "stotax_tried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ebay_invoices" ADD COLUMN "stotax_error" text;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_name_uq" ON "customers" USING btree ("tenant_id","name");