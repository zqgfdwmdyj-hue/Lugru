CREATE TABLE "call_punkte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"art" text NOT NULL,
	"text" text NOT NULL,
	"verantwortlich" text,
	"frist" date,
	"zitat" text,
	"position" integer,
	"status" text DEFAULT 'vorschlag' NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"titel" text NOT NULL,
	"datum" date NOT NULL,
	"quelle" text NOT NULL,
	"quelle_ref" text,
	"transkript" text NOT NULL,
	"auswertung" text DEFAULT 'offen' NOT NULL,
	"auswertung_fehler" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_punkte" ADD CONSTRAINT "call_punkte_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_punkte" ADD CONSTRAINT "call_punkte_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_punkte" ADD CONSTRAINT "call_punkte_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_punkte_call_idx" ON "call_punkte" USING btree ("tenant_id","call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_quelle_uq" ON "calls" USING btree ("tenant_id","quelle_ref");--> statement-breakpoint
CREATE INDEX "calls_datum_idx" ON "calls" USING btree ("tenant_id","datum");