CREATE TABLE "zeitbloecke" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"art" text NOT NULL,
	"titel" text NOT NULL,
	"wochentage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ganztags" boolean DEFAULT true NOT NULL,
	"von_zeit" text,
	"bis_zeit" text,
	"gueltig_von" date,
	"gueltig_bis" date,
	"stunden" numeric(4, 1),
	"link" text,
	"aktiv" boolean DEFAULT true NOT NULL,
	"sortierung" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "anleitung" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "anleitung_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "zeitbloecke" ADD CONSTRAINT "zeitbloecke_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zeitbloecke" ADD CONSTRAINT "zeitbloecke_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zeitbloecke_tenant_idx" ON "zeitbloecke" USING btree ("tenant_id","art");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;