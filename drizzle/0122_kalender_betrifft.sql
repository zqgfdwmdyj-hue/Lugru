CREATE TABLE "kalender_betrifft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"uid" text NOT NULL,
	"betrifft" text NOT NULL,
	"gesetzt_von" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kalender_betrifft" ADD CONSTRAINT "kalender_betrifft_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kalender_betrifft_uq" ON "kalender_betrifft" USING btree ("tenant_id","uid");