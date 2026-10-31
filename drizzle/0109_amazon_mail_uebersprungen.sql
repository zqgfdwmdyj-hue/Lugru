CREATE TABLE "amazon_mail_uebersprungen" (
	"tenant_id" uuid NOT NULL,
	"email_id" uuid NOT NULL,
	"grund" text NOT NULL,
	"am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amazon_mail_uebersprungen_tenant_id_email_id_pk" PRIMARY KEY("tenant_id","email_id")
);
--> statement-breakpoint
ALTER TABLE "amazon_mail_uebersprungen" ADD CONSTRAINT "amazon_mail_uebersprungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_mail_uebersprungen" ADD CONSTRAINT "amazon_mail_uebersprungen_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;