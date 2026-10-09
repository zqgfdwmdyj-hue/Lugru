CREATE TABLE "cog_exports" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"exported_at" timestamp with time zone NOT NULL,
	"costs" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cog_exports" ADD CONSTRAINT "cog_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;