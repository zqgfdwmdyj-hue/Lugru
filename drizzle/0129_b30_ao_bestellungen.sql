ALTER TABLE "purchase_order_items" ADD COLUMN "externer_schluessel" text;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "externer_status" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "quelle" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "externe_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "poi_extern_uq" ON "purchase_order_items" USING btree ("tenant_id","externer_schluessel") WHERE "purchase_order_items"."externer_schluessel" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "po_extern_uq" ON "purchase_orders" USING btree ("tenant_id","quelle","externe_id") WHERE "purchase_orders"."externe_id" is not null;