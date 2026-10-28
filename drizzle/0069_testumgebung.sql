CREATE TABLE "test_mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"text" text,
	"attachments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_mails" ADD CONSTRAINT "test_mails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_mails_idx" ON "test_mails" USING btree ("tenant_id","created_at");