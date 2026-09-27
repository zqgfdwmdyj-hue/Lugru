CREATE TABLE "research_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"title_key" text NOT NULL,
	"source" text,
	"published_at" timestamp with time zone,
	"snippet" text,
	"knowledge_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_items" ADD CONSTRAINT "research_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_url_uq" ON "research_items" USING btree ("tenant_id","url");--> statement-breakpoint
CREATE INDEX "research_title_idx" ON "research_items" USING btree ("tenant_id","title_key");--> statement-breakpoint
CREATE INDEX "research_topic_idx" ON "research_items" USING btree ("tenant_id","topic","created_at");