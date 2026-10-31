CREATE TABLE "watch_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid,
	"practice" boolean DEFAULT false NOT NULL,
	"condition" text DEFAULT 'gebraucht' NOT NULL,
	"maker" text NOT NULL,
	"model" text,
	"reference" text,
	"year" integer,
	"watch_set" text DEFAULT 'ohne' NOT NULL,
	"status" text DEFAULT 'beobachtet' NOT NULL,
	"tax_mode" text DEFAULT 'privat' NOT NULL,
	"source" text,
	"url" text,
	"ask_price" numeric(12, 2),
	"buy_price" numeric(12, 2),
	"buy_date" date,
	"costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_sell" numeric(12, 2),
	"sell_price" numeric(12, 2),
	"sell_date" date,
	"channel" text,
	"fee_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"fee_fixed" numeric(10, 2) DEFAULT 0 NOT NULL,
	"shipping" numeric(10, 2) DEFAULT 0 NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"lessons" text,
	"reject_reason" text,
	"ai_feedback" text,
	"ai_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_learn" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"best_correct" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_learn_tenant_id_user_id_lesson_pk" PRIMARY KEY("tenant_id","user_id","lesson")
);
--> statement-breakpoint
CREATE TABLE "watch_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid,
	"reference" text NOT NULL,
	"ref_key" text NOT NULL,
	"label" text,
	"kind" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"day" date NOT NULL,
	"condition" text DEFAULT 'gebraucht' NOT NULL,
	"full_set" boolean DEFAULT false NOT NULL,
	"source" text,
	"url" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_deals" ADD CONSTRAINT "watch_deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_deals" ADD CONSTRAINT "watch_deals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_deals" ADD CONSTRAINT "watch_deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_learn" ADD CONSTRAINT "watch_learn_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_learn" ADD CONSTRAINT "watch_learn_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_prices" ADD CONSTRAINT "watch_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_prices" ADD CONSTRAINT "watch_prices_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_prices" ADD CONSTRAINT "watch_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_deals_tenant_idx" ON "watch_deals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "watch_prices_ref_idx" ON "watch_prices" USING btree ("tenant_id","ref_key","day");