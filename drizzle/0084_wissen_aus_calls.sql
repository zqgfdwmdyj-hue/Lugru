ALTER TABLE "knowledge_entries" ADD COLUMN "call_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "call_zitat" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "wissen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "wissen_fehler" text;--> statement-breakpoint
CREATE INDEX "knowledge_call_idx" ON "knowledge_entries" USING btree ("tenant_id","call_id");