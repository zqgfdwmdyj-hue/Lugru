CREATE TABLE "ebay_listing_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"source" text DEFAULT 'ebay' NOT NULL,
	"attempt_id" integer,
	"title" text NOT NULL,
	"image" text,
	"url" text,
	"sku" text,
	"price" numeric(14, 2),
	"quantity" integer,
	"variations" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'wartet' NOT NULL,
	"score" integer,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts" jsonb,
	"market" jsonb,
	"traffic" jsonb,
	"ai" jsonb,
	"applied" jsonb,
	"message" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ebay_listing_checks" ADD CONSTRAINT "ebay_listing_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_checks_uq" ON "ebay_listing_checks" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "ebay_listing_checks_status_idx" ON "ebay_listing_checks" USING btree ("tenant_id","status");