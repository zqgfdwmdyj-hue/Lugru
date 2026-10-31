CREATE TABLE "bqool_exporte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"laender" jsonb NOT NULL,
	"nur_aenderungen" boolean NOT NULL,
	"zeilen" jsonb NOT NULL,
	"anzahl" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uebertragung" text,
	"protokoll" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bqool_zuweisungen" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"sku" text NOT NULL,
	"regel" text NOT NULL,
	"untergrenze" numeric(12, 2),
	"quelle" text NOT NULL,
	"freigegeben" boolean DEFAULT true NOT NULL,
	"grund" text,
	"datei" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bqool_zuweisungen_tenant_id_land_sku_pk" PRIMARY KEY("tenant_id","land","sku")
);
--> statement-breakpoint
ALTER TABLE "bqool_exporte" ADD CONSTRAINT "bqool_exporte_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bqool_zuweisungen" ADD CONSTRAINT "bqool_zuweisungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bqool_exporte_tenant_idx" ON "bqool_exporte" USING btree ("tenant_id","created_at");