CREATE TABLE "sellerboard_aufrufe" (
	"tenant_id" uuid NOT NULL,
	"tag" date NOT NULL,
	"automatik" integer DEFAULT 0 NOT NULL,
	"hand" integer DEFAULT 0 NOT NULL,
	"quota_genutzt" integer,
	"quota_limit" integer,
	"quota_am" timestamp with time zone,
	"system_bei_quota" integer DEFAULT 0 NOT NULL,
	"uebersprungen" integer DEFAULT 0 NOT NULL,
	"limit_erreicht_am" timestamp with time zone,
	"daten_stand_bei_limit" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellerboard_aufrufe_tenant_id_tag_pk" PRIMARY KEY("tenant_id","tag")
);
--> statement-breakpoint
CREATE TABLE "sellerboard_plan" (
	"tenant_id" uuid NOT NULL,
	"laeufe" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pausiert_bis" timestamp with time zone,
	"obergrenze" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellerboard_plan_tenant_id_pk" PRIMARY KEY("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN "hinweis" text;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN "hinweis_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sellerboard_aufrufe" ADD CONSTRAINT "sellerboard_aufrufe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerboard_plan" ADD CONSTRAINT "sellerboard_plan_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;