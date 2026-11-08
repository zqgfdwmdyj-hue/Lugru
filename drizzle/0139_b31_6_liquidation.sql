CREATE TABLE "bqool_liquidationen" (
	"tenant_id" uuid NOT NULL,
	"land" text NOT NULL,
	"sku" text NOT NULL,
	"grund" text NOT NULL,
	"regel_vorher" text,
	"min_gewuenscht" numeric(12, 2),
	"min_gesetzt" numeric(12, 2),
	"eff_min_vorher" numeric(12, 2),
	"break_even" numeric(12, 2),
	"verlust_bis" numeric(12, 2),
	"status" text DEFAULT 'vorgeschlagen' NOT NULL,
	"aktiv_seit" timestamp with time zone,
	"ueber_seit" date,
	"zurueck_vorgeschlagen_am" timestamp with time zone,
	"beendet_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bqool_liquidationen_tenant_id_land_sku_pk" PRIMARY KEY("tenant_id","land","sku")
);
--> statement-breakpoint
ALTER TABLE "bqool_listings" ADD COLUMN "regel_seit" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bqool_liquidationen" ADD CONSTRAINT "bqool_liquidationen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "bqool_listings" SET "regel_seit" = "eingelesen_am" WHERE "regel_seit" IS NULL;
