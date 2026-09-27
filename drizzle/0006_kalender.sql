CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"calendar_name" text NOT NULL,
	"uid" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"day" date NOT NULL,
	"location" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"uid" text NOT NULL,
	"href" text NOT NULL,
	"etag" text,
	"hash" text NOT NULL,
	"date" date NOT NULL,
	"title" text NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_uq" ON "calendar_events" USING btree ("tenant_id","uid","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_day_idx" ON "calendar_events" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_items_key_uq" ON "calendar_items" USING btree ("tenant_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_items_uid_uq" ON "calendar_items" USING btree ("tenant_id","uid");