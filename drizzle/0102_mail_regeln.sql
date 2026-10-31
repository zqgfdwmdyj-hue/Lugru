CREATE TABLE "mail_regeln" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"absender" text,
	"betreff" text,
	"thema" text,
	"aktion" text NOT NULL,
	"zustaendig_id" uuid,
	"aktiv" boolean DEFAULT true NOT NULL,
	"treffer" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "regel_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_regeln" ADD CONSTRAINT "mail_regeln_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_regeln" ADD CONSTRAINT "mail_regeln_zustaendig_id_users_id_fk" FOREIGN KEY ("zustaendig_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_regeln_tenant_idx" ON "mail_regeln" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_regel_id_mail_regeln_id_fk" FOREIGN KEY ("regel_id") REFERENCES "public"."mail_regeln"("id") ON DELETE set null ON UPDATE no action;