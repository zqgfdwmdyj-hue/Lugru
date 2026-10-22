CREATE TABLE "pallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"customer" text,
	"note" text,
	"in_at" date NOT NULL,
	"out_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pallets" ADD CONSTRAINT "pallets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pallets_open_code_uq" ON "pallets" USING btree ("tenant_id","code") WHERE "pallets"."out_at" is null;--> statement-breakpoint
CREATE INDEX "pallets_in_idx" ON "pallets" USING btree ("tenant_id","in_at");