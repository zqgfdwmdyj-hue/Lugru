ALTER TABLE "tasks" ADD COLUMN "board_column" text;--> statement-breakpoint
ALTER TABLE "supplier_leads" ADD COLUMN "follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_leads" ADD COLUMN "on_board" boolean DEFAULT false NOT NULL;