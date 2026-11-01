import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId } from "./core";

// B24: Bildschirmfoto bei jedem Fehlschlag der Browser-Automatik (BQool, sellerboard, ArbitrageOne) – mit Seitentitel
// und Adresse (ohne Abfrageteil), nur für Inhaber unter /import/debug/<name>.png, nach 7 Tagen gelöscht. Das Bild liegt
// verschlüsselt in der Ablage.

export const automatikDebug = pgTable(
  "automatik_debug",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    dienst: text("dienst").notNull(),
    titel: text("titel"),
    url: text("url"),
    fehler: text("fehler"),
    ablage: text("ablage"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("automatik_debug_name_uq").on(t.tenantId, t.name), index("automatik_debug_zeit_idx").on(t.createdAt)],
);
