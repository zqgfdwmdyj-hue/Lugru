CREATE TABLE "ebay_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"ref" text NOT NULL,
	"target" text NOT NULL,
	"title" text,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'wartet' NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ebay_transfers" ADD CONSTRAINT "ebay_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_transfers_uq" ON "ebay_transfers" USING btree ("tenant_id","source","ref","target");--> statement-breakpoint
CREATE INDEX "ebay_transfers_status_idx" ON "ebay_transfers" USING btree ("tenant_id","status");