CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"zweck" text DEFAULT 'deal_eingang' NOT NULL,
	"token_hash" text NOT NULL,
	"anfang" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_eingaenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"weg" text NOT NULL,
	"token_id" uuid,
	"quelle" text,
	"rohtext" text NOT NULL,
	"datei_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"datei_namen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inhalt_kennung" text NOT NULL,
	"pruefung" text DEFAULT 'offen' NOT NULL,
	"fehler" text,
	"status" text DEFAULT 'neu' NOT NULL,
	"grund" text,
	"ampel" text,
	"zusammenfassung" text,
	"zeilen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ohne_ki" boolean DEFAULT false NOT NULL,
	"preisliste_id" uuid,
	"b2b_deal_id" uuid,
	"bestellung_id" uuid,
	"push_am" timestamp with time zone,
	"geprueft_am" timestamp with time zone,
	"entschieden_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD CONSTRAINT "deal_eingaenge_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_eingaenge" ADD CONSTRAINT "deal_eingaenge_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_uq" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "deal_eingaenge_tenant_idx" ON "deal_eingaenge" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "deal_eingaenge_quelle_idx" ON "deal_eingaenge" USING btree ("tenant_id","quelle");--> statement-breakpoint
CREATE INDEX "deal_eingaenge_kennung_idx" ON "deal_eingaenge" USING btree ("tenant_id","inhalt_kennung");