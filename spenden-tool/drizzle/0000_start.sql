CREATE TABLE "event_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price" numeric(12, 2),
	"price_note" text,
	"caption" text,
	"quantity" integer,
	"in_collage" boolean DEFAULT true NOT NULL,
	"in_flyer" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recognized_name" text,
	"recognized_variant" text,
	"recognized_category" text,
	"offers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lowest_price" numeric(12, 2),
	"suggested_price" numeric(12, 2),
	"summary" text,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"searches" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"variant" text,
	"category" text DEFAULT 'Lebensmittel' NOT NULL,
	"price" numeric(12, 2),
	"image_file_id" uuid,
	"note" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_checks" ADD CONSTRAINT "price_checks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_items_uq" ON "event_items" USING btree ("event_id","product_id");--> statement-breakpoint
CREATE INDEX "event_items_product_idx" ON "event_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "events_date_idx" ON "events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "files_sha_idx" ON "files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "price_checks_product_idx" ON "price_checks" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "products" USING btree ("name");