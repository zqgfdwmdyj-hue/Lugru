CREATE TABLE "uebersetzungen" (
	"tenant_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"nach" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uebersetzungen_tenant_id_hash_nach_pk" PRIMARY KEY("tenant_id","hash","nach")
);
--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "anleitung_en" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "anleitung_en_freigegeben" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "title_en" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sprache" text;--> statement-breakpoint
ALTER TABLE "va_nachrichten" ADD COLUMN "original" text;--> statement-breakpoint
ALTER TABLE "va_nachrichten" ADD COLUMN "sprache" text;--> statement-breakpoint
ALTER TABLE "uebersetzungen" ADD CONSTRAINT "uebersetzungen_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;