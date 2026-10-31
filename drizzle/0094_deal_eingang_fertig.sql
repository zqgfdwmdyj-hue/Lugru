CREATE TABLE "deal_eingang_kanaele" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kanal_id" text NOT NULL,
	"name" text,
	"cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meldungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"titel" text NOT NULL,
	"text" text NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_abos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"geraet" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fehler_am" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_werte" (
	"schluessel" text PRIMARY KEY NOT NULL,
	"wert" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "quelle_ref" text;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD COLUMN "angebote" jsonb;--> statement-breakpoint
ALTER TABLE "deal_eingang_kanaele" ADD CONSTRAINT "deal_eingang_kanaele_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meldungen" ADD CONSTRAINT "meldungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meldungen" ADD CONSTRAINT "meldungen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_abos" ADD CONSTRAINT "push_abos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_abos" ADD CONSTRAINT "push_abos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_eingang_kanaele_uq" ON "deal_eingang_kanaele" USING btree ("tenant_id","kanal_id");--> statement-breakpoint
CREATE INDEX "meldungen_user_idx" ON "meldungen" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_abos_endpoint_uq" ON "push_abos" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_abos_user_idx" ON "push_abos" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_eingaenge_ref_uq" ON "deal_eingaenge" USING btree ("tenant_id","quelle_ref");