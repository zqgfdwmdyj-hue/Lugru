CREATE TABLE "amazon_removal_shipment_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"tracking_number" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_removal_shipment_marks" ADD CONSTRAINT "amazon_removal_shipment_marks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "removal_ship_mark_uq" ON "amazon_removal_shipment_marks" USING btree ("tenant_id","order_id","tracking_number");