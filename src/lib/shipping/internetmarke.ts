// Anfrage an die INTERNETMARKE (Deutsche Post) zusammenbauen und Fehler lesbar machen – reine Logik, testbar.

import type { Address } from "@/db/tables/core";
import { toIso3 } from "./countries";

/** Warensendung laut Produkt-/Preisliste der Post (PPL): 290 = bis 1.000 g, 331 = bis 2.000 g. */
export const WARENSENDUNG = { productCode: 290, priceCents: 270, maxGrams: 1000 } as const;

export type ImLabel = { ref: string; to: Address };

type ImAddress = { name: string; additionalName?: string; addressLine1: string; addressLine2?: string; postalCode: string; city: string; country: string };

const cut = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Anschrift im Format der Internetmarke (Name höchstens 50 Zeichen, Straße mit Hausnummer in einer Zeile). */
export function imAddress(a: Address): ImAddress {
  const name = cut(a.name1, 50);
  const line1 = cut([a.street, a.houseNo].filter(Boolean).join(" "), 50);
  if (!name || !line1 || !a.zip || !a.city) throw new Error("Anschrift unvollständig (Name, Straße, PLZ, Ort).");
  const extra = cut(a.name2, 50);
  return { name, ...(extra ? { additionalName: extra } : {}), addressLine1: line1, postalCode: cut(a.zip, 10), city: cut(a.city, 50), country: toIso3(a.country) };
}

/** Position auf dem Bogen: Etiketten von links nach rechts, dann nach unten, dann nächste Seite. */
export function labelPosition(index: number, labelX: number, labelY: number): { page: number; labelX: number; labelY: number } {
  const perPage = Math.max(1, labelX) * Math.max(1, labelY);
  const inPage = index % perPage;
  return { page: Math.floor(index / perPage) + 1, labelX: (inPage % Math.max(1, labelX)) + 1, labelY: Math.floor(inPage / Math.max(1, labelX)) + 1 };
}

/** Rumpf für POST /app/shoppingcart/pdf: alle Sendungen mit Anschrift (Adresszone), Summe in Cent. */
export function imCheckoutBody(o: { shopOrderId: string; sender: Address; labels: ImLabel[]; productCode: number; priceCents: number; pageFormat: { id: number; labelX: number; labelY: number } }) {
  const sender = imAddress(o.sender);
  return {
    type: "AppShoppingCartPDFRequest",
    shopOrderId: o.shopOrderId,
    total: o.priceCents * o.labels.length,
    createManifest: false,
    createShippingList: "0",
    dpi: "DPI300",
    pageFormatId: o.pageFormat.id,
    positions: o.labels.map((l, i) => ({
      productCode: o.productCode,
      voucherLayout: "ADDRESS_ZONE",
      address: { sender, receiver: imAddress(l.to) },
      position: labelPosition(i, o.pageFormat.labelX, o.pageFormat.labelY),
      positionType: "AppShoppingCartPDFPosition",
    })),
  };
}

/** Fehlertext aus der Antwort der Post (statusCode/title/detail, teils description/message). */
export function imError(status: number, json: unknown): string {
  if (json && typeof json === "object") {
    const j = json as Record<string, unknown>;
    const parts = [j.title, j.detail, j.description, j.message, j.error_description].filter((x): x is string => typeof x === "string" && x.trim() !== "");
    if (parts.length) return `${status} ${[...new Set(parts)].join(" – ")}`;
  }
  if (typeof json === "string" && json.trim()) return `${status} ${json.trim().slice(0, 200)}`;
  return String(status);
}
