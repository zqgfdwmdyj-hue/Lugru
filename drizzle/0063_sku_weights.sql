CREATE TABLE "sku_weights" (
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"grams" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_weights_tenant_id_sku_pk" PRIMARY KEY("tenant_id","sku")
);
--> statement-breakpoint
ALTER TABLE "sku_weights" ADD CONSTRAINT "sku_weights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;