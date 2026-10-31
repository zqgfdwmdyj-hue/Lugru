CREATE TABLE "sas_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"brand_key" text NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"note" text,
	"products" integer,
	"sales30" numeric(14, 2),
	"units30" integer,
	"invoices" integer,
	"supplier_offers" integer,
	"computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sas_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asin" text NOT NULL,
	"title" text,
	"min_discount_pct" numeric(6, 2),
	"deal_type" text,
	"status" text DEFAULT 'pruefen' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sas_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'sonstiges' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sas_items" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module" text DEFAULT 'sonstiges' NOT NULL,
	"waiting_on" text DEFAULT 'ich' NOT NULL,
	"template_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sas_program" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"consultant_name" text,
	"consultant_email" text,
	"pstam_name" text,
	"next_meeting" date,
	"deal_deadline" date,
	"pilot_status" text DEFAULT 'auswahl' NOT NULL,
	"pilot_submitted_at" date,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sas_brands" ADD CONSTRAINT "sas_brands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sas_deals" ADD CONSTRAINT "sas_deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sas_documents" ADD CONSTRAINT "sas_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sas_documents" ADD CONSTRAINT "sas_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sas_items" ADD CONSTRAINT "sas_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sas_items" ADD CONSTRAINT "sas_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sas_program" ADD CONSTRAINT "sas_program_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sas_brands_uq" ON "sas_brands" USING btree ("tenant_id","brand_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sas_deals_uq" ON "sas_deals" USING btree ("tenant_id","asin");--> statement-breakpoint
CREATE INDEX "sas_documents_tenant_idx" ON "sas_documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sas_items_tenant_idx" ON "sas_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sas_items_template_uq" ON "sas_items" USING btree ("tenant_id","template_key");