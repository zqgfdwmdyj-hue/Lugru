CREATE TABLE "amazon_fbm_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"order_id" text NOT NULL,
	"order_date" date,
	"rma" text,
	"sku" text,
	"asin" text,
	"title" text,
	"request_date" date,
	"status" text,
	"label_type" text,
	"tracking" text,
	"delivery_date" date,
	"quantity" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"resolution" text,
	"order_amount" numeric(14, 4),
	"refunded_amount" numeric(14, 4),
	"safet_claim_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"row_hash" text NOT NULL,
	"date" date,
	"kind" text NOT NULL,
	"type" text,
	"settlement_id" text,
	"order_id" text,
	"sku" text,
	"description" text,
	"quantity" integer DEFAULT 0 NOT NULL,
	"channel" text DEFAULT '' NOT NULL,
	"product_sales" numeric(14, 4),
	"shipping_credits" numeric(14, 4),
	"selling_fees" numeric(14, 4),
	"fba_fees" numeric(14, 4),
	"total" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_fbm_returns" ADD CONSTRAINT "amazon_fbm_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_transactions" ADD CONSTRAINT "amazon_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amz_fbm_ret_uq" ON "amazon_fbm_returns" USING btree ("tenant_id","row_key");--> statement-breakpoint
CREATE INDEX "amz_fbm_ret_order_idx" ON "amazon_fbm_returns" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "amz_tx_hash_uq" ON "amazon_transactions" USING btree ("tenant_id","row_hash");--> statement-breakpoint
CREATE INDEX "amz_tx_order_idx" ON "amazon_transactions" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "amz_tx_kind_idx" ON "amazon_transactions" USING btree ("tenant_id","kind","date");