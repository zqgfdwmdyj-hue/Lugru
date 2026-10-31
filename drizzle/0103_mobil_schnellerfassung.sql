CREATE TABLE "mobil_protokoll" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_id" uuid,
	"user_id" uuid,
	"endpunkt" text NOT NULL,
	"status" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schnell_eingaenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_id" uuid,
	"daten" jsonb NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"art" text,
	"ziel_id" text,
	"erledigt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobil_protokoll" ADD CONSTRAINT "mobil_protokoll_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobil_protokoll" ADD CONSTRAINT "mobil_protokoll_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobil_protokoll" ADD CONSTRAINT "mobil_protokoll_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schnell_eingaenge" ADD CONSTRAINT "schnell_eingaenge_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schnell_eingaenge" ADD CONSTRAINT "schnell_eingaenge_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schnell_eingaenge" ADD CONSTRAINT "schnell_eingaenge_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobil_protokoll_token_idx" ON "mobil_protokoll" USING btree ("token_id","created_at");--> statement-breakpoint
CREATE INDEX "mobil_protokoll_tenant_idx" ON "mobil_protokoll" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "schnell_eingaenge_user_idx" ON "schnell_eingaenge" USING btree ("tenant_id","user_id","status");