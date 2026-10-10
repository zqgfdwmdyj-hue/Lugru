ALTER TABLE "invoices" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stotax_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stotax_tried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stotax_error" text;