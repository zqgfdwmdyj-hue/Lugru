CREATE TABLE "video_clips" (
	"tenant_id" uuid NOT NULL,
	"clip_id" text NOT NULL,
	"pfad" text NOT NULL,
	"kanal_slug" text,
	"dauer" real DEFAULT 0 NOT NULL,
	"breite" integer DEFAULT 0 NOT NULL,
	"hoehe" integer DEFAULT 0 NOT NULL,
	"beschreibung" text DEFAULT '' NOT NULL,
	"schlagwoerter" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"einstellung" text,
	"brauchbar" boolean DEFAULT true NOT NULL,
	"grund" text,
	"abschnitt" jsonb,
	"quelle" text DEFAULT 'eigen' NOT NULL,
	"filmer" text,
	"benutzt" integer DEFAULT 0 NOT NULL,
	"zuletzt_benutzt" timestamp with time zone,
	"gesperrt" boolean DEFAULT false NOT NULL,
	"schlagwoerter_hand" jsonb,
	"beschreibung_hand" text,
	"vorschau" boolean DEFAULT false NOT NULL,
	"fehlt" boolean DEFAULT false NOT NULL,
	"gesehen_am" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_clips" ADD CONSTRAINT "video_clips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_clips_id" ON "video_clips" USING btree ("tenant_id","clip_id");--> statement-breakpoint
CREATE INDEX "video_clips_kanal" ON "video_clips" USING btree ("tenant_id","kanal_slug");