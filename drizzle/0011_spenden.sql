CREATE TABLE "donation_event_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price" numeric(14, 4),
	"price_note" text,
	"caption" text,
	"quantity" integer,
	"in_collage" boolean DEFAULT true NOT NULL,
	"in_flyer" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text DEFAULT 'Unsere Spendenempfehlungen' NOT NULL,
	"subtitle" text,
	"event_date" date NOT NULL,
	"event_time" text,
	"location" text,
	"note" text,
	"collage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donation_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"variant" text,
	"category" text DEFAULT 'Lebensmittel' NOT NULL,
	"price" numeric(14, 4),
	"image_file_id" uuid,
	"note" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "donation_event_items" ADD CONSTRAINT "donation_event_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_event_items" ADD CONSTRAINT "donation_event_items_event_id_donation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."donation_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_event_items" ADD CONSTRAINT "donation_event_items_product_id_donation_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."donation_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_events" ADD CONSTRAINT "donation_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_products" ADD CONSTRAINT "donation_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_products" ADD CONSTRAINT "donation_products_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "donation_event_items_uq" ON "donation_event_items" USING btree ("event_id","product_id");--> statement-breakpoint
CREATE INDEX "donation_event_items_product_idx" ON "donation_event_items" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "donation_events_date_idx" ON "donation_events" USING btree ("tenant_id","event_date");--> statement-breakpoint
CREATE INDEX "donation_products_name_idx" ON "donation_products" USING btree ("tenant_id","name");