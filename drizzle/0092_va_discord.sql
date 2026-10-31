CREATE TABLE "va_nachrichten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"discord_id" text NOT NULL,
	"kanal_id" text NOT NULL,
	"thread_id" text,
	"von" text NOT NULL,
	"text" text NOT NULL,
	"art" text NOT NULL,
	"anfrage" jsonb,
	"task_id" uuid,
	"ludwig_task_id" uuid,
	"auto_beantwortet" boolean DEFAULT false NOT NULL,
	"antwort" text,
	"beantwortet_am" timestamp with time zone,
	"datei_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gesendet_am" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "va_stand" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"kanal_cursor" text,
	"letzter_abgleich" timestamp with time zone,
	"letzter_fehler" text
);
--> statement-breakpoint
CREATE TABLE "va_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"art" text NOT NULL,
	"task_id" uuid,
	"thread_id" text NOT NULL,
	"start_nachricht_id" text,
	"cursor" text,
	"status" text DEFAULT 'offen' NOT NULL,
	"frage_reaktion" boolean DEFAULT false NOT NULL,
	"letzte_erinnerung" date,
	"erledigt_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "va_nachrichten" ADD CONSTRAINT "va_nachrichten_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_nachrichten" ADD CONSTRAINT "va_nachrichten_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_nachrichten" ADD CONSTRAINT "va_nachrichten_ludwig_task_id_tasks_id_fk" FOREIGN KEY ("ludwig_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_stand" ADD CONSTRAINT "va_stand_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_threads" ADD CONSTRAINT "va_threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_threads" ADD CONSTRAINT "va_threads_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "va_nachrichten_discord_uq" ON "va_nachrichten" USING btree ("tenant_id","discord_id");--> statement-breakpoint
CREATE INDEX "va_nachrichten_zeit_idx" ON "va_nachrichten" USING btree ("tenant_id","gesendet_am");--> statement-breakpoint
CREATE UNIQUE INDEX "va_threads_thread_uq" ON "va_threads" USING btree ("tenant_id","thread_id");--> statement-breakpoint
CREATE INDEX "va_threads_status_idx" ON "va_threads" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "va_threads_task_idx" ON "va_threads" USING btree ("tenant_id","task_id");