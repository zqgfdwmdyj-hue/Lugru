CREATE TABLE "pallet_pickups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer" text,
	"day" date NOT NULL,
	"picked_by" text NOT NULL,
	"plate" text,
	"note" text,
	"pallet_ids" jsonb NOT NULL,
	"codes" jsonb NOT NULL,
	"signature_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pallet_pickups" ADD CONSTRAINT "pallet_pickups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_pickups" ADD CONSTRAINT "pallet_pickups_signature_file_id_files_id_fk" FOREIGN KEY ("signature_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pallet_pickups_day_idx" ON "pallet_pickups" USING btree ("tenant_id","day");