CREATE TABLE "ek_importe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"dateiname" text NOT NULL,
	"quelle" text NOT NULL,
	"roh" jsonb NOT NULL,
	"zeilen" jsonb NOT NULL,
	"anzahl" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'vorschau' NOT NULL,
	"uebernommen_am" timestamp with time zone,
	"sellerboard" text DEFAULT 'offen' NOT NULL,
	"sellerboard_protokoll" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"geprueft_am" timestamp with time zone,
	"pruefung" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ek_importe" ADD CONSTRAINT "ek_importe_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ek_importe" ADD CONSTRAINT "ek_importe_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ek_importe_tenant_idx" ON "ek_importe" USING btree ("tenant_id","created_at");