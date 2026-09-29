CREATE TABLE "amazon_mail_seen" (
	"tenant_id" uuid NOT NULL,
	"message_key" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amazon_mail_seen_tenant_id_message_key_pk" PRIMARY KEY("tenant_id","message_key")
);
--> statement-breakpoint
CREATE TABLE "amazon_todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_key" text NOT NULL,
	"email_id" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"sender" text,
	"subject" text,
	"category" text DEFAULT 'sonstiges' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"deadline" date,
	"asins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"body_short" text,
	"status" text DEFAULT 'open' NOT NULL,
	"info_only" boolean DEFAULT false NOT NULL,
	"note" text,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_mail_seen" ADD CONSTRAINT "amazon_mail_seen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_todos" ADD CONSTRAINT "amazon_todos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_todos" ADD CONSTRAINT "amazon_todos_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amazon_todos_key_uq" ON "amazon_todos" USING btree ("tenant_id","message_key");--> statement-breakpoint
CREATE INDEX "amazon_todos_status_idx" ON "amazon_todos" USING btree ("tenant_id","status","deadline");