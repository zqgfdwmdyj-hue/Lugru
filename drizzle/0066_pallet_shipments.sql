CREATE TABLE "pallet_shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"old_date" date,
	"new_date" date,
	"status" text,
	"notice" boolean DEFAULT false NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"user_id" uuid,
	"user_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pallet_shipment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"show_photos" boolean DEFAULT true NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pallet_shipment_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pallet_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"customer" text,
	"title" text NOT NULL,
	"place" text,
	"carrier" text NOT NULL,
	"carrier_name" text,
	"tracking_no" text,
	"tracking_url" text,
	"pallet_count" integer,
	"carton_count" integer,
	"planned_date" date,
	"planned_time" text,
	"first_date" date,
	"status" text DEFAULT 'geplant' NOT NULL,
	"location" text,
	"delivered_at" timestamp with time zone,
	"note" text,
	"tracked_at" timestamp with time zone,
	"track_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pallet_shipment_events" ADD CONSTRAINT "pallet_shipment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipment_events" ADD CONSTRAINT "pallet_shipment_events_shipment_id_pallet_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."pallet_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipment_events" ADD CONSTRAINT "pallet_shipment_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipment_links" ADD CONSTRAINT "pallet_shipment_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipment_links" ADD CONSTRAINT "pallet_shipment_links_shipment_id_pallet_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."pallet_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipment_links" ADD CONSTRAINT "pallet_shipment_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipment_photos" ADD CONSTRAINT "pallet_shipment_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipment_photos" ADD CONSTRAINT "pallet_shipment_photos_shipment_id_pallet_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."pallet_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipment_photos" ADD CONSTRAINT "pallet_shipment_photos_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipments" ADD CONSTRAINT "pallet_shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_shipments" ADD CONSTRAINT "pallet_shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pallet_shipment_events_idx" ON "pallet_shipment_events" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "pallet_shipment_notices_idx" ON "pallet_shipment_events" USING btree ("tenant_id","notice","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pallet_shipment_links_hash_uq" ON "pallet_shipment_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pallet_shipment_links_ship_idx" ON "pallet_shipment_links" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "pallet_shipment_photos_idx" ON "pallet_shipment_photos" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "pallet_shipments_tenant_idx" ON "pallet_shipments" USING btree ("tenant_id","status","planned_date");