CREATE TABLE "pallet_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pallet_id" uuid,
	"customer" text NOT NULL,
	"day" date NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pallet_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"price_per_month" numeric(14, 4),
	"free_days" integer,
	"mode" text,
	"in_fee" numeric(14, 4),
	"out_fee" numeric(14, 4),
	"monthly_mail" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pallet_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pallet_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pallet_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer" text NOT NULL,
	"month" text NOT NULL,
	"recipient" text,
	"total" numeric(14, 4),
	"sent_at" timestamp with time zone,
	"auto" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pallets" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "pallets" ADD COLUMN "contents" text;--> statement-breakpoint
ALTER TABLE "pallets" ADD COLUMN "weight_kg" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "pallet_charges" ADD CONSTRAINT "pallet_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_charges" ADD CONSTRAINT "pallet_charges_pallet_id_pallets_id_fk" FOREIGN KEY ("pallet_id") REFERENCES "public"."pallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_customers" ADD CONSTRAINT "pallet_customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_photos" ADD CONSTRAINT "pallet_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_photos" ADD CONSTRAINT "pallet_photos_pallet_id_pallets_id_fk" FOREIGN KEY ("pallet_id") REFERENCES "public"."pallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_photos" ADD CONSTRAINT "pallet_photos_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pallet_statements" ADD CONSTRAINT "pallet_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pallet_charges_day_idx" ON "pallet_charges" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "pallet_customers_name_uq" ON "pallet_customers" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "pallet_photos_pallet_idx" ON "pallet_photos" USING btree ("pallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pallet_statements_uq" ON "pallet_statements" USING btree ("tenant_id",lower("customer"),"month");