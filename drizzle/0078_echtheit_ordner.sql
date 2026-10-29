CREATE TABLE "echtheit_belege" (
	"tenant_id" uuid NOT NULL,
	"marke_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"urteil" text NOT NULL,
	"manuell" boolean DEFAULT false NOT NULL,
	"geprueft_von" uuid,
	"geprueft_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "echtheit_belege_marke_id_invoice_id_pk" PRIMARY KEY("marke_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "echtheit_marken" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"marke" text NOT NULL,
	"marke_key" text NOT NULL,
	"aliase" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "echtheit_belege" ADD CONSTRAINT "echtheit_belege_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echtheit_belege" ADD CONSTRAINT "echtheit_belege_marke_id_echtheit_marken_id_fk" FOREIGN KEY ("marke_id") REFERENCES "public"."echtheit_marken"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echtheit_belege" ADD CONSTRAINT "echtheit_belege_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echtheit_belege" ADD CONSTRAINT "echtheit_belege_geprueft_von_users_id_fk" FOREIGN KEY ("geprueft_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echtheit_marken" ADD CONSTRAINT "echtheit_marken_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "echtheit_belege_tenant_idx" ON "echtheit_belege" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "echtheit_marken_uq" ON "echtheit_marken" USING btree ("tenant_id","marke_key");