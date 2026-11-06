-- Wunsch 06.11.: WhatsApp und von Hand angelegte Aufträge haben keinen Kanal, dem man den Versand melden könnte.
-- Bestehende offene „Meldungen“ dort als von Hand erledigt markieren (nichts wird gelöscht).
UPDATE "orders" SET "tracking_uploaded_at" = now(), "tracking_upload_manuell" = true, "tracking_upload_error" = NULL
WHERE "channel" IN ('manual', 'whatsapp') AND "tracking_uploaded_at" IS NULL AND ("tracking_number" IS NOT NULL OR "tracking_upload_error" IS NOT NULL);
