CREATE TABLE "va_entwuerfe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"text_de" text NOT NULL,
	"text_va" text NOT NULL,
	"sprache" text DEFAULT 'en' NOT NULL,
	"herkunft" text DEFAULT 'watch' NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"fehler" text,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erledigt_am" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watch_rueckfragen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"art" text NOT NULL,
	"optionen" jsonb NOT NULL,
	"menge" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meldungen" ADD COLUMN "bezug" jsonb;--> statement-breakpoint
ALTER TABLE "va_entwuerfe" ADD CONSTRAINT "va_entwuerfe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_entwuerfe" ADD CONSTRAINT "va_entwuerfe_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_entwuerfe" ADD CONSTRAINT "va_entwuerfe_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_rueckfragen" ADD CONSTRAINT "watch_rueckfragen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_rueckfragen" ADD CONSTRAINT "watch_rueckfragen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "va_entwuerfe_status_idx" ON "va_entwuerfe" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "watch_rueckfragen_user_idx" ON "watch_rueckfragen" USING btree ("tenant_id","user_id","art","created_at");