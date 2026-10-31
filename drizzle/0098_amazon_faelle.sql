CREATE TABLE "amazon_einordnung_regeln" (
	"tenant_id" uuid NOT NULL,
	"muster" text NOT NULL,
	"bereich" text NOT NULL,
	"phase" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amazon_einordnung_regeln_tenant_id_muster_pk" PRIMARY KEY("tenant_id","muster")
);
--> statement-breakpoint
CREATE TABLE "amazon_vorgaenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bereich" text NOT NULL,
	"phase" text NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"dringlichkeit" text DEFAULT 'grau' NOT NULL,
	"unsicher" boolean DEFAULT false NOT NULL,
	"titel" text NOT NULL,
	"fallnummer" text,
	"marktplatz" text,
	"marke" text,
	"asins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skus" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bestellnummer" text,
	"shipment_id" text,
	"betrag" numeric(14, 4),
	"frist" date,
	"ablehnungsgruende" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verlangt" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"zustaendig" text,
	"task_id" uuid,
	"paket" jsonb,
	"runden" integer DEFAULT 0 NOT NULL,
	"erste_mail_am" timestamp with time zone NOT NULL,
	"letzte_mail_am" timestamp with time zone NOT NULL,
	"gemeldet_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amazon_vorgang_eintraege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vorgang_id" uuid NOT NULL,
	"email_id" uuid,
	"art" text NOT NULL,
	"phase" text,
	"text" text NOT NULL,
	"von" text,
	"am" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_einordnung_regeln" ADD CONSTRAINT "amazon_einordnung_regeln_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_vorgaenge" ADD CONSTRAINT "amazon_vorgaenge_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_vorgaenge" ADD CONSTRAINT "amazon_vorgaenge_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_vorgang_eintraege" ADD CONSTRAINT "amazon_vorgang_eintraege_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_vorgang_eintraege" ADD CONSTRAINT "amazon_vorgang_eintraege_vorgang_id_amazon_vorgaenge_id_fk" FOREIGN KEY ("vorgang_id") REFERENCES "public"."amazon_vorgaenge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_vorgang_eintraege" ADD CONSTRAINT "amazon_vorgang_eintraege_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amazon_vorgaenge_status_idx" ON "amazon_vorgaenge" USING btree ("tenant_id","status","frist");--> statement-breakpoint
CREATE INDEX "amazon_vorgaenge_fall_idx" ON "amazon_vorgaenge" USING btree ("tenant_id","fallnummer");--> statement-breakpoint
CREATE INDEX "amazon_vorgang_eintraege_idx" ON "amazon_vorgang_eintraege" USING btree ("tenant_id","vorgang_id","am");--> statement-breakpoint
CREATE UNIQUE INDEX "amazon_vorgang_mail_uq" ON "amazon_vorgang_eintraege" USING btree ("tenant_id","email_id");