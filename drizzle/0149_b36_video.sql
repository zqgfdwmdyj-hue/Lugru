CREATE TABLE "video_auftraege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kanal_id" uuid NOT NULL,
	"thema" text NOT NULL,
	"vidiq_keywords" text,
	"vidiq_titel" text,
	"hinweis" text,
	"start_ab" timestamp with time zone,
	"status" text DEFAULT 'wartet' NOT NULL,
	"schritt" text DEFAULT 'research' NOT NULL,
	"schritte" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"freigabe_offen" text,
	"freigegeben" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gliederung" jsonb,
	"quellen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skript" jsonb,
	"paket" jsonb,
	"woerter" integer,
	"dauer_sek" integer,
	"kosten_schaetzung" numeric(10, 2),
	"kosten_ist" numeric(10, 4) DEFAULT 0 NOT NULL,
	"kosten_positionen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dateien" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hochladen" boolean DEFAULT false NOT NULL,
	"youtube_id" text,
	"youtube_status" text,
	"wiederholen" text,
	"worker_id" uuid,
	"zuletzt_vom_worker" timestamp with time zone,
	"aufraeumen" boolean DEFAULT false NOT NULL,
	"erstellt_von" uuid,
	"fertig_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_kanaele" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"sprache" text DEFAULT 'de' NOT NULL,
	"themenbereich" text,
	"stimme_id" text,
	"bildstil" text,
	"sicherheitsstufe" text DEFAULT 'normal' NOT NULL,
	"musik" text,
	"freigaben" jsonb DEFAULT '{"gliederung":true,"skript":true,"vorschau":true}'::jsonb NOT NULL,
	"youtube_token" text,
	"youtube_kanal" text,
	"youtube_verbunden_am" timestamp with time zone,
	"aktiv" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_worker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_anfang" text NOT NULL,
	"angelegt_von" uuid,
	"deaktiviert_am" timestamp with time zone,
	"zuletzt_gesehen" timestamp with time zone,
	"version" text,
	"frei_gb" numeric(8, 1),
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD CONSTRAINT "video_auftraege_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD CONSTRAINT "video_auftraege_kanal_id_video_kanaele_id_fk" FOREIGN KEY ("kanal_id") REFERENCES "public"."video_kanaele"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD CONSTRAINT "video_auftraege_erstellt_von_users_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD CONSTRAINT "video_kanaele_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_worker" ADD CONSTRAINT "video_worker_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_worker" ADD CONSTRAINT "video_worker_angelegt_von_users_id_fk" FOREIGN KEY ("angelegt_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_auftraege_status" ON "video_auftraege" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "video_auftraege_kanal" ON "video_auftraege" USING btree ("tenant_id","kanal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_kanaele_slug" ON "video_kanaele" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "video_worker_token" ON "video_worker" USING btree ("token_hash");