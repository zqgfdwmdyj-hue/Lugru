CREATE TABLE "mail_ausgang" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mailbox_id" uuid,
	"message_key" text NOT NULL,
	"an" text NOT NULL,
	"an_name" text,
	"betreff" text DEFAULT '' NOT NULL,
	"gesendet_am" timestamp with time zone NOT NULL,
	"snippet" text,
	"body_text" text,
	"absender" text,
	"absender_name" text,
	"antwort_auf" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email_id" uuid,
	"kontakt_id" uuid,
	"referenzen" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"nachfassen_am" text,
	"nachfass_task_id" uuid,
	"antwort_email_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_gesehen" (
	"tenant_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"ergebnis" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_kontakte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"adresse_hash" text NOT NULL,
	"adresse" text NOT NULL,
	"name" text,
	"art" text,
	"anrede" text,
	"bezug" text,
	"festgelegt_von" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "beantwortet_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "beantwortet_von" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "antwort_auf" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "ausgang_id" uuid;--> statement-breakpoint
ALTER TABLE "test_mails" ADD COLUMN "in_reply_to" text;--> statement-breakpoint
ALTER TABLE "mail_ausgang" ADD CONSTRAINT "mail_ausgang_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_ausgang" ADD CONSTRAINT "mail_ausgang_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_ausgang" ADD CONSTRAINT "mail_ausgang_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_ausgang" ADD CONSTRAINT "mail_ausgang_kontakt_id_mail_kontakte_id_fk" FOREIGN KEY ("kontakt_id") REFERENCES "public"."mail_kontakte"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_ausgang" ADD CONSTRAINT "mail_ausgang_nachfass_task_id_tasks_id_fk" FOREIGN KEY ("nachfass_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_ausgang" ADD CONSTRAINT "mail_ausgang_antwort_email_id_emails_id_fk" FOREIGN KEY ("antwort_email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_gesehen" ADD CONSTRAINT "mail_gesehen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_kontakte" ADD CONSTRAINT "mail_kontakte_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_kontakte" ADD CONSTRAINT "mail_kontakte_festgelegt_von_users_id_fk" FOREIGN KEY ("festgelegt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_ausgang_uq" ON "mail_ausgang" USING btree ("tenant_id","message_key");--> statement-breakpoint
CREATE INDEX "mail_ausgang_email_idx" ON "mail_ausgang" USING btree ("tenant_id","email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_gesehen_uq" ON "mail_gesehen" USING btree ("tenant_id","key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_kontakte_uq" ON "mail_kontakte" USING btree ("tenant_id","adresse_hash");