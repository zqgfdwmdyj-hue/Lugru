CREATE TABLE "automatik_debug" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dienst" text NOT NULL,
	"titel" text,
	"url" text,
	"fehler" text,
	"ablage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automatik_debug" ADD CONSTRAINT "automatik_debug_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automatik_debug_name_uq" ON "automatik_debug" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "automatik_debug_zeit_idx" ON "automatik_debug" USING btree ("created_at");