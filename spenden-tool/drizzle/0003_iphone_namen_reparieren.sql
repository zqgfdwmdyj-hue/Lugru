-- Produkte, die beim Hochladen vom iPhone die Datei-Kennung (z. B. „21b33d03 b668 4e79 ab60 841d27e9d8bc“)
-- als Namen bekommen haben: erkannten KI-Namen übernehmen, sonst wieder als „Neues Produkt“ markieren.
UPDATE "products" p SET
  "name" = COALESCE(
    (SELECT c."recognized_name" FROM "price_checks" c
      WHERE c."product_id" = p."id" AND c."status" = 'done' AND c."recognized_name" IS NOT NULL
      ORDER BY c."created_at" DESC LIMIT 1),
    'Neues Produkt'),
  "variant" = COALESCE(p."variant",
    (SELECT c."recognized_variant" FROM "price_checks" c
      WHERE c."product_id" = p."id" AND c."status" = 'done' AND c."recognized_name" IS NOT NULL
      ORDER BY c."created_at" DESC LIMIT 1)),
  "updated_at" = now()
WHERE p."name" ~* '^[0-9a-f]{8} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{12}$';
