CREATE TABLE "video_fotos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kanal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"typ" text NOT NULL,
	"groesse" integer NOT NULL,
	"hash" text NOT NULL,
	"ohne_personen" boolean DEFAULT false NOT NULL,
	"genutzt_auftrag" uuid,
	"genutzt_am" timestamp with time zone,
	"hochgeladen_von" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "art" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "geplant_fuer" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "story" jsonb;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "ig_status" text;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "ig_media_id" text;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "ig_versuche" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "ig_fehler" text;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "ig_naechster_versuch" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_auftraege" ADD COLUMN "gepostet_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "plattform" text DEFAULT 'youtube' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "tempo" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "instagram" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "instagram_token" text;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "instagram_user_id" text;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "instagram_konto" text;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "instagram_token_bis" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_kanaele" ADD COLUMN "instagram_verbunden_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_fotos" ADD CONSTRAINT "video_fotos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_fotos" ADD CONSTRAINT "video_fotos_kanal_id_video_kanaele_id_fk" FOREIGN KEY ("kanal_id") REFERENCES "public"."video_kanaele"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_fotos" ADD CONSTRAINT "video_fotos_hochgeladen_von_users_id_fk" FOREIGN KEY ("hochgeladen_von") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_fotos_kanal" ON "video_fotos" USING btree ("tenant_id","kanal_id");--> statement-breakpoint
CREATE INDEX "video_auftraege_geplant" ON "video_auftraege" USING btree ("tenant_id","art","geplant_fuer");