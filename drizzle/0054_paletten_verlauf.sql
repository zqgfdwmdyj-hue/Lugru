CREATE TABLE "pallet_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pallet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"day" date,
	"text" text NOT NULL,
	"user_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pallet_customers" ADD COLUMN "rate_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pallet_pickups" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pallet_pickups" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "pallet_statements" ADD COLUMN "invoiced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pallet_statements" ADD COLUMN "invoice_no" text;--> statement-breakpoint
ALTER TABLE "pallet_statements" ADD COLUMN "invoiced_total" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "pallet_statements" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pallets" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pallets" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "pallet_events" ADD CONSTRAINT "pallet_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_events" ADD CONSTRAINT "pallet_events_pallet_id_pallets_id_fk" FOREIGN KEY ("pallet_id") REFERENCES "public"."pallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pallet_events_pallet_idx" ON "pallet_events" USING btree ("pallet_id","created_at");