CREATE TABLE "discord_chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kanal_id" text NOT NULL,
	"nachricht_id" text NOT NULL,
	"autor" text,
	"autor_id" text,
	"text" text NOT NULL,
	"gesendet_am" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_chat_stand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kanal_id" text NOT NULL,
	"name" text NOT NULL,
	"rhythmus" text NOT NULL,
	"letzte_id" text,
	"letzte_zusammenfassung" timestamp with time zone,
	"gewarnt" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rechtsfaelle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quelle" text NOT NULL,
	"asana_gid" text,
	"asana_url" text,
	"titel" text NOT NULL,
	"aktenzeichen" text,
	"gegenstand" text,
	"bereich" text NOT NULL,
	"firma" text,
	"status" text DEFAULT 'offen' NOT NULL,
	"am_zug" text DEFAULT 'unklar' NOT NULL,
	"naechste_frist" date,
	"frist_text" text,
	"letzter_stand" text,
	"letzte_bewegung" timestamp with time zone,
	"abgeschlossen" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rechtsfall_eintraege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fall_id" uuid NOT NULL,
	"art" text NOT NULL,
	"text" text NOT NULL,
	"datum" timestamp with time zone NOT NULL,
	"quelle_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_chat" ADD CONSTRAINT "discord_chat_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_chat_stand" ADD CONSTRAINT "discord_chat_stand_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rechtsfaelle" ADD CONSTRAINT "rechtsfaelle_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rechtsfall_eintraege" ADD CONSTRAINT "rechtsfall_eintraege_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rechtsfall_eintraege" ADD CONSTRAINT "rechtsfall_eintraege_fall_id_rechtsfaelle_id_fk" FOREIGN KEY ("fall_id") REFERENCES "public"."rechtsfaelle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_chat_nachricht_uq" ON "discord_chat" USING btree ("tenant_id","nachricht_id");--> statement-breakpoint
CREATE INDEX "discord_chat_kanal_idx" ON "discord_chat" USING btree ("tenant_id","kanal_id","gesendet_am");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_chat_stand_uq" ON "discord_chat_stand" USING btree ("tenant_id","kanal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rechtsfaelle_asana_uq" ON "rechtsfaelle" USING btree ("tenant_id","asana_gid");--> statement-breakpoint
CREATE INDEX "rechtsfaelle_bereich_idx" ON "rechtsfaelle" USING btree ("tenant_id","bereich");--> statement-breakpoint
CREATE UNIQUE INDEX "rechtsfall_eintraege_ref_uq" ON "rechtsfall_eintraege" USING btree ("tenant_id","quelle_ref");--> statement-breakpoint
CREATE INDEX "rechtsfall_eintraege_fall_idx" ON "rechtsfall_eintraege" USING btree ("tenant_id","fall_id","datum");