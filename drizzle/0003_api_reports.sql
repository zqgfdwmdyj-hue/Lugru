CREATE TABLE "api_report_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"report_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api_report_requests" ADD CONSTRAINT "api_report_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_report_uq" ON "api_report_requests" USING btree ("tenant_id","report_id");--> statement-breakpoint
CREATE INDEX "api_report_status_idx" ON "api_report_requests" USING btree ("tenant_id","status");