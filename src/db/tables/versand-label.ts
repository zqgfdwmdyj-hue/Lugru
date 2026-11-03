import { index, integer, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, users } from "./core";
import { encryptedJson } from "./encrypted";

// DHL-Label aus Chat/Screenshot: je Label bzw. Vorlage eine Zeile (Protokoll: wer, wann, an wen, Kosten laut
// Preisliste). Die Empfängeradresse liegt verschlüsselt; der eingefügte Chat-Text und das Bild werden nicht gespeichert.

export type VersandEmpfaenger = { name: string; name2?: string; strasse: string; hausnummer: string; plz: string; ort: string; land: string; telefon?: string; email?: string; packstation?: string; postnummer?: string };

export const versandLabels = pgTable(
  "versand_labels",
  {
    id: id(),
    tenantId: tenantId(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    /** entwurf (vom iPhone geteilt, noch nicht fertig) | vorlage (ohne DHL gespeichert) | erstellt | fehler */
    status: text("status").notNull().default("vorlage"),
    kanal: text("kanal").notNull(),
    /** lugru (Standard) | zweiter (z. B. Wittmann & Grunert) */
    absender: text("absender").notNull().default("lugru"),
    produkt: text("produkt").notNull(),
    empfaenger: encryptedJson<VersandEmpfaenger>("empfaenger"),
    /** Felder, die beim Erkennen unsicher waren (gelb). */
    unsicher: jsonb("unsicher").$type<string[]>().notNull().default([]),
    gewichtKg: numeric("gewicht_kg"),
    masse: jsonb("masse").$type<{ l: number; b: number; h: number } | null>(),
    wert: numeric("wert"),
    services: jsonb("services").$type<{ versicherung?: number | null; alterssicht?: "A16" | "A18" | null }>().notNull().default({}),
    gefahrgut: jsonb("gefahrgut").$type<{ lq?: boolean; un?: string; klasse?: string; mengeJePackstueck?: string; lithium?: "UN3481" | "UN3091" | null } | null>(),
    artikel: text("artikel"),
    sku: text("sku"),
    menge: integer("menge").notNull().default(1),
    preis: numeric("preis"),
    zahlungsart: text("zahlungsart"),
    sendungsnummer: text("sendungsnummer"),
    labelFileId: uuid("label_file_id"),
    orderId: uuid("order_id"),
    /** Kosten laut hinterlegter DHL-Preisliste (€ netto); leer = Preis nicht hinterlegt. */
    kosten: numeric("kosten"),
    fehler: text("fehler"),
    hinweise: jsonb("hinweise").$type<string[]>().notNull().default([]),
  },
  (t) => [index("versand_labels_tenant_idx").on(t.tenantId, t.createdAt)],
);
