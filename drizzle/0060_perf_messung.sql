ALTER TABLE "job_runs" ADD COLUMN "last_duration_ms" integer;--> statement-breakpoint
CREATE INDEX "emails_open_category_idx" ON "emails" USING btree ("tenant_id","category") WHERE archived = false;