ALTER TABLE "mailboxes" ADD COLUMN "from_name" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "supplier_leads" ADD COLUMN "mail_from_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_leads" ADD COLUMN "mail_from" text;--> statement-breakpoint
ALTER TABLE "supplier_leads" ADD CONSTRAINT "supplier_leads_mail_from_id_mailboxes_id_fk" FOREIGN KEY ("mail_from_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;