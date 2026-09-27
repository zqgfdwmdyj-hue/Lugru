CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_customer_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"row_hash" text NOT NULL,
	"return_date" date NOT NULL,
	"order_id" text,
	"sku" text,
	"asin" text,
	"fnsku" text,
	"title" text,
	"quantity" integer NOT NULL,
	"fulfillment_center" text,
	"disposition" text,
	"reason" text,
	"status" text,
	"lpn" text,
	"customer_comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"fnsku" text,
	"asin" text,
	"title" text,
	"condition" text,
	"price" numeric(14, 4),
	"fulfillable" integer DEFAULT 0 NOT NULL,
	"unsellable" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"inbound_working" integer DEFAULT 0 NOT NULL,
	"inbound_shipped" integer DEFAULT 0 NOT NULL,
	"inbound_receiving" integer DEFAULT 0 NOT NULL,
	"researching" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"mfn_fulfillable" integer DEFAULT 0 NOT NULL,
	"unsellable_since" date,
	"snapshot_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_ledger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"row_hash" text NOT NULL,
	"event_date" date NOT NULL,
	"fnsku" text,
	"asin" text,
	"sku" text,
	"title" text,
	"event_type" text NOT NULL,
	"reference_id" text,
	"quantity" integer NOT NULL,
	"fulfillment_center" text,
	"disposition" text,
	"reason" text,
	"country" text,
	"reconciled_quantity" integer,
	"unreconciled_quantity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_reimbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"row_hash" text NOT NULL,
	"approval_date" date NOT NULL,
	"reimbursement_id" text NOT NULL,
	"case_id" text,
	"order_id" text,
	"reason" text,
	"sku" text,
	"fnsku" text,
	"asin" text,
	"condition" text,
	"currency" text,
	"amount_per_unit" numeric(14, 4),
	"amount_total" numeric(14, 4),
	"quantity_cash" integer DEFAULT 0 NOT NULL,
	"quantity_inventory" integer DEFAULT 0 NOT NULL,
	"quantity_total" integer DEFAULT 0 NOT NULL,
	"original_reimbursement_id" text,
	"original_reimbursement_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_removal_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_date" date NOT NULL,
	"order_id" text NOT NULL,
	"order_type" text,
	"order_status" text,
	"last_updated" date,
	"sku" text NOT NULL,
	"fnsku" text,
	"disposition" text DEFAULT '' NOT NULL,
	"requested_quantity" integer DEFAULT 0 NOT NULL,
	"cancelled_quantity" integer DEFAULT 0 NOT NULL,
	"disposed_quantity" integer DEFAULT 0 NOT NULL,
	"shipped_quantity" integer DEFAULT 0 NOT NULL,
	"in_process_quantity" integer DEFAULT 0 NOT NULL,
	"removal_fee" numeric(14, 4),
	"currency" text,
	"received_quantity" integer,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_removal_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"row_hash" text NOT NULL,
	"request_date" date,
	"order_id" text NOT NULL,
	"shipment_date" date,
	"sku" text,
	"fnsku" text,
	"disposition" text,
	"shipped_quantity" integer DEFAULT 0 NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"order_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"settlement_id" text NOT NULL,
	"row_hash" text NOT NULL,
	"transaction_type" text,
	"order_id" text,
	"adjustment_id" text,
	"shipment_id" text,
	"marketplace" text,
	"amount_type" text,
	"amount_description" text,
	"amount" numeric(14, 4) NOT NULL,
	"posted_date" date,
	"sku" text,
	"quantity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"settlement_id" text NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"deposit_date" timestamp with time zone,
	"total_amount" numeric(14, 4),
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"report_type" text NOT NULL,
	"file_name" text,
	"via" text DEFAULT 'upload' NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'detected' NOT NULL,
	"detection_key" text,
	"title" text NOT NULL,
	"sku" text,
	"fnsku" text,
	"asin" text,
	"lot_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_cost" numeric(14, 4),
	"expected_amount" numeric(14, 4),
	"reimbursed_amount" numeric(14, 4),
	"reference" text,
	"event_date" date,
	"deadline" date,
	"amazon_case_id" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_box_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"box_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"length_cm" numeric(6, 1),
	"width_cm" numeric(6, 1),
	"height_cm" numeric(6, 1),
	"weight_kg" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"lot_id" uuid,
	"product_id" uuid,
	"sku" text NOT NULL,
	"fnsku" text,
	"asin" text,
	"title" text,
	"planned_quantity" integer DEFAULT 0 NOT NULL,
	"scanned_quantity" integer DEFAULT 0 NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"item_id" uuid,
	"box_id" uuid,
	"code" text NOT NULL,
	"quantity" integer NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"amazon_shipment_id" text,
	"amazon_plan_id" text,
	"destination" text,
	"notes" text,
	"transmitted_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"external_item_id" text,
	"sku" text,
	"asin" text,
	"title" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price" numeric(14, 4),
	"lot_id" uuid
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"order_date" timestamp with time zone NOT NULL,
	"fulfillment" text DEFAULT 'FBM' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"external_status" text,
	"buyer_name" text,
	"ship_to" jsonb,
	"total" numeric(14, 4),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"ship_by" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"carrier" text,
	"tracking_number" text,
	"tracking_uploaded_at" timestamp with time zone,
	"tracking_upload_error" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parcels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid,
	"carrier" text DEFAULT 'DHL' NOT NULL,
	"product" text NOT NULL,
	"weight_kg" numeric(6, 3) NOT NULL,
	"tracking_number" text,
	"label_file_id" uuid,
	"status" text NOT NULL,
	"error" text,
	"is_return_label" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mailbox_id" uuid,
	"provider_message_id" text,
	"message_key" text NOT NULL,
	"from_address" text,
	"from_name" text,
	"subject" text,
	"received_at" timestamp with time zone NOT NULL,
	"snippet" text,
	"body_text" text,
	"category" text DEFAULT 'info' NOT NULL,
	"topic" text,
	"matched_rule" text,
	"references" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"task_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"integration_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lots" (
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"matched_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lots_invoice_id_lot_id_pk" PRIMARY KEY("invoice_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_source_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"kind" text NOT NULL,
	"supplier_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"file_name" text NOT NULL,
	"file_id" uuid,
	"source_key" text,
	"supplier_id" uuid,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"invoice_date" date,
	"invoice_number" text,
	"order_number" text,
	"total_gross" numeric(14, 4),
	"total_net" numeric(14, 4),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"text_excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"category" text DEFAULT 'sonstiges' NOT NULL,
	"description" text NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"expected" integer DEFAULT 0 NOT NULL,
	"counted" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"booked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"sku" text NOT NULL,
	"product_id" uuid,
	"external_id" text,
	"title" text NOT NULL,
	"description" text,
	"ean" text,
	"condition" text DEFAULT 'NEW' NOT NULL,
	"price" numeric(14, 4),
	"quantity" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "own_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"product_id" uuid,
	"quantity" integer DEFAULT 0 NOT NULL,
	"location" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"supplier_id" uuid,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_import_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feed_id" uuid NOT NULL,
	"supplier_sku" text NOT NULL,
	"ean" text,
	"asin" text,
	"title" text,
	"price" numeric(14, 4),
	"stock" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"external_id" text,
	"order_ref" text,
	"order_id" uuid,
	"customer" text,
	"amount" numeric(14, 4),
	"deadline" date,
	"template_id" uuid,
	"notes" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"order_ref" text NOT NULL,
	"order_id" uuid,
	"sku" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"status" text DEFAULT 'announced' NOT NULL,
	"condition" text,
	"refund_amount" numeric(14, 4),
	"tracking_number" text,
	"restocked" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"date" date NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"order_ref" text,
	"row_hash" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ean" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "length_cm" numeric(8, 1);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "width_cm" numeric(8, 1);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "height_cm" numeric(8, 1);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "prep_instructions" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_hazmat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "fba_fee" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "referral_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_customer_returns" ADD CONSTRAINT "amazon_customer_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_inventory" ADD CONSTRAINT "amazon_inventory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_ledger_events" ADD CONSTRAINT "amazon_ledger_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_reimbursements" ADD CONSTRAINT "amazon_reimbursements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_removal_orders" ADD CONSTRAINT "amazon_removal_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_removal_shipments" ADD CONSTRAINT "amazon_removal_shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_settlement_lines" ADD CONSTRAINT "amazon_settlement_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_settlements" ADD CONSTRAINT "amazon_settlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_imports" ADD CONSTRAINT "report_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_box_items" ADD CONSTRAINT "inbound_box_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_box_items" ADD CONSTRAINT "inbound_box_items_box_id_inbound_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."inbound_boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_box_items" ADD CONSTRAINT "inbound_box_items_item_id_inbound_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inbound_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_boxes" ADD CONSTRAINT "inbound_boxes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_boxes" ADD CONSTRAINT "inbound_boxes_shipment_id_inbound_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_items" ADD CONSTRAINT "inbound_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_items" ADD CONSTRAINT "inbound_items_shipment_id_inbound_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_items" ADD CONSTRAINT "inbound_items_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_items" ADD CONSTRAINT "inbound_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_scans" ADD CONSTRAINT "inbound_scans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_scans" ADD CONSTRAINT "inbound_scans_shipment_id_inbound_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_scans" ADD CONSTRAINT "inbound_scans_item_id_inbound_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inbound_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_scans" ADD CONSTRAINT "inbound_scans_box_id_inbound_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."inbound_boxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_scans" ADD CONSTRAINT "inbound_scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_label_file_id_files_id_fk" FOREIGN KEY ("label_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lots" ADD CONSTRAINT "invoice_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lots" ADD CONSTRAINT "invoice_lots_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lots" ADD CONSTRAINT "invoice_lots_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_source_rules" ADD CONSTRAINT "invoice_source_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_source_rules" ADD CONSTRAINT "invoice_source_rules_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_items" ADD CONSTRAINT "cash_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_stock" ADD CONSTRAINT "own_stock_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_stock" ADD CONSTRAINT "own_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_feeds" ADD CONSTRAINT "supplier_feeds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_feeds" ADD CONSTRAINT "supplier_feeds_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_feed_id_supplier_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."supplier_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_template_id_knowledge_entries_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_tenant_sha_idx" ON "files" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "returns_hash_uq" ON "amazon_customer_returns" USING btree ("tenant_id","row_hash");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "amazon_customer_returns" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "returns_lpn_idx" ON "amazon_customer_returns" USING btree ("tenant_id","lpn");--> statement-breakpoint
CREATE UNIQUE INDEX "amz_inv_sku_uq" ON "amazon_inventory" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_hash_uq" ON "amazon_ledger_events" USING btree ("tenant_id","row_hash");--> statement-breakpoint
CREATE INDEX "ledger_sku_idx" ON "amazon_ledger_events" USING btree ("tenant_id","sku","event_date");--> statement-breakpoint
CREATE INDEX "ledger_fnsku_idx" ON "amazon_ledger_events" USING btree ("tenant_id","fnsku");--> statement-breakpoint
CREATE UNIQUE INDEX "reimb_hash_uq" ON "amazon_reimbursements" USING btree ("tenant_id","row_hash");--> statement-breakpoint
CREATE INDEX "reimb_sku_idx" ON "amazon_reimbursements" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE INDEX "reimb_order_idx" ON "amazon_reimbursements" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "removal_order_uq" ON "amazon_removal_orders" USING btree ("tenant_id","order_id","sku","disposition");--> statement-breakpoint
CREATE UNIQUE INDEX "removal_ship_hash_uq" ON "amazon_removal_shipments" USING btree ("tenant_id","row_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "settle_line_uq" ON "amazon_settlement_lines" USING btree ("tenant_id","row_hash");--> statement-breakpoint
CREATE INDEX "settle_line_sku_idx" ON "amazon_settlement_lines" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE INDEX "settle_line_settlement_idx" ON "amazon_settlement_lines" USING btree ("tenant_id","settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_uq" ON "amazon_settlements" USING btree ("tenant_id","settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_detection_uq" ON "claims" USING btree ("tenant_id","detection_key");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "inbound_scans_shipment_idx" ON "inbound_scans" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "inbound_tenant_idx" ON "inbound_shipments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "order_items_sku_idx" ON "order_items" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_ext_uq" ON "orders" USING btree ("tenant_id","channel","external_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "parcels_order_idx" ON "parcels" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emails_key_uq" ON "emails" USING btree ("tenant_id","message_key");--> statement-breakpoint
CREATE INDEX "emails_received_idx" ON "emails" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_rules_uq" ON "invoice_source_rules" USING btree ("tenant_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_ext_uq" ON "invoices" USING btree ("tenant_id","source","external_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "cash_items_date_idx" ON "cash_items" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "count_line_uq" ON "inventory_count_lines" USING btree ("count_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_uq" ON "listings" USING btree ("tenant_id","channel","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "own_stock_sku_uq" ON "own_stock" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE INDEX "stock_mov_sku_idx" ON "stock_movements" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_uq" ON "supplier_offers" USING btree ("feed_id","supplier_sku");--> statement-breakpoint
CREATE INDEX "offers_ean_idx" ON "supplier_offers" USING btree ("tenant_id","ean");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "cases" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "customer_returns_status_idx" ON "customer_returns" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_hash_uq" ON "feedback" USING btree ("tenant_id","row_hash");