ALTER TABLE "files" ADD COLUMN "printed_reader" integer;--> statement-breakpoint
UPDATE "files" SET "printed_reader" = 1 WHERE "printed_status" = 'done';
