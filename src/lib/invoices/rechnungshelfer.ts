import { z } from "zod";
import { computeB2b, looksLikeRc13bGoods, suggestTaxCase, type B2bInput } from "@/lib/ebay/invoices/b2b";

// „Rechnungshelfer“ (Discord-Ankaufserver, JSON-Export per Webhook): Aus dem gesendeten
// Rechnungsentwurf wird eine B2B-Rechnung im eigenen Nummernkreis. Der Käufer steht nicht im JSON –
// alle Rechnungen gehen an einen fest eingestellten Rechnungsempfänger (den Ankäufer).

const money = z.coerce.number().refine(Number.isFinite, "keine Zahl");
const day = z
  .string()
  .nullish()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined));

const Tracking = z.looseObject({
  tracking_number: z.coerce.string(),
  quantity: z.coerce.number().nullish(),
  service_date: day,
});

const Position = z.looseObject({
  product_name: z.string().trim().min(1, "Produktname fehlt"),
  quantity: z.coerce.number().positive("Menge fehlt"),
  net_unit_price: money,
  net_total: money.nullish(),
  tax_rate: z.coerce.number().nullish(),
  description: z.string().nullish(),
  trackings: z.array(Tracking).nullish(),
});

export const RechnungshelferDraft = z.looseObject({
  type: z.literal("invoice_draft"),
  created_at: z.string().nullish(),
  ticket: z.string().trim().min(1, "Ticket fehlt").max(120),
  payment_term: z.string().nullish(),
  payment_term_days: z.coerce.number().int().nullish(),
  invoice_date: day,
  due_date: day,
  is_reverse_charge: z.boolean().nullish(),
  cross_month: z.boolean().nullish(),
  region: z.string().nullish(),
  currency: z.string().nullish(),
  positions: z.array(Position).min(1, "keine Positionen").max(200),
  totals: z.looseObject({ net: money.nullish(), tax: money.nullish(), gross: money.nullish() }).nullish(),
  delivery: z.looseObject({ date: day, date_until: day }).nullish(),
  /** Wie der Entwurf ankam: Webhook (leer), eingefügter Text oder Screenshot (KI). */
  _source: z.enum(["text", "screenshot", "json"]).nullish(),
});
export type RechnungshelferDraft = z.infer<typeof RechnungshelferDraft>;

/** „Instant“/„sofort“ → 0, „60 Tage“ → 60; sonst die Angabe in Tagen. */
export function paymentDaysOf(d: Pick<RechnungshelferDraft, "payment_term" | "payment_term_days">): number | null {
  if (typeof d.payment_term_days === "number" && d.payment_term_days >= 0 && d.payment_term_days <= 365) return d.payment_term_days;
  const t = d.payment_term?.trim() ?? "";
  if (/instant|sofort|vorkasse|direkt/i.test(t)) return 0;
  const m = /(\d{1,3})\s*(tag|day)/i.exec(t);
  return m ? Math.min(365, Number(m[1])) : null;
}

const round = (n: number) => Math.round(n * 100) / 100;
const fmtDay = (iso: string) => iso.split("-").reverse().join(".");
const euro = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** Sendungen einer Position als Text: „900000000001 (3x)“. */
function shipmentsOf(p: RechnungshelferDraft["positions"][number]): string {
  if (p.description?.trim()) return p.description.trim();
  return (p.trackings ?? []).map((t) => `${t.tracking_number}${t.quantity ? ` (${t.quantity}x)` : ""}`).join(", ");
}

export type BuyerForDraft = B2bInput["buyer"];

export type DraftConversion = {
  input: B2bInput;
  /** Was vor dem Erstellen geprüft werden sollte – leer heißt: kann automatisch erstellt werden. */
  warnings: string[];
  /** Summen laut eigener Berechnung (zum Vergleich in der Übersicht). */
  totals: { net: number; gross: number };
};

/**
 * Entwurf → Eingabe für die B2B-Rechnung. Preise netto wie im Rechnungshelfer; Steuer rechnet das
 * eigene System (Steuerfall aus Land/USt-IdNr. des Kunden, § 13b für Handys/Tablets/Konsolen/Chips).
 */
export function convertDraft(d: RechnungshelferDraft, buyer: BuyerForDraft | null, opts: { defaultPaymentDays: number; kleinunternehmer: boolean; today: string }): DraftConversion {
  const warnings: string[] = [];
  if (/^discord-\d+$/.test(d.ticket)) warnings.push("Kein Ticket erkannt – bitte die Referenz (Ticket) im Formular ergänzen.");
  if (d._source === "screenshot") warnings.push("Aus Screenshot gelesen – Positionen, Mengen und Beträge bitte mit Discord vergleichen.");
  const rc = Boolean(d.is_reverse_charge);
  const lines: B2bInput["lines"] = d.positions.map((p) => {
    const ship = shipmentsOf(p);
    const rate = typeof p.tax_rate === "number" && [0, 7, 19].includes(p.tax_rate) ? p.tax_rate : 19;
    return {
      description: ship ? `${p.product_name} – Sendung ${ship}` : p.product_name,
      quantity: p.quantity,
      unit: "Stk",
      unitNet: round(p.net_unit_price),
      // Bei Reverse Charge schickt der Rechnungshelfer 0 % – den Satz bestimmt hier § 13b.
      vatRate: rc && rate === 0 ? 19 : rate,
      device: looksLikeRc13bGoods(p.product_name),
    };
  });

  if (rc && !lines.some((l) => l.device)) {
    for (const l of lines) l.device = true;
    warnings.push("Reverse Charge laut Rechnungshelfer, aber keine Position als Handy/Tablet/Konsole/Chip erkannt – alle Positionen als § 13b-Ware übernommen, bitte prüfen.");
  }

  // Zahlungsziel-Aufschlag: steckt er nur in der Summe, kommt er als eigene Position dazu.
  const positionsNet = round(lines.reduce((s, l) => s + round(l.quantity * l.unitNet), 0));
  const botNet = typeof d.totals?.net === "number" ? round(d.totals.net) : null;
  if (botNet !== null && botNet - positionsNet >= 0.01) {
    const diff = round(botNet - positionsNet);
    lines.push({ description: `Zahlungsziel-Aufschlag${d.payment_term ? ` (${d.payment_term})` : ""}`, quantity: 1, unit: "Stk", unitNet: diff, vatRate: lines[0]?.vatRate ?? 19, device: false });
    warnings.push(`Summe im Rechnungshelfer ${euro(diff)} höher als die Positionen – als „Zahlungsziel-Aufschlag“ übernommen, bitte prüfen.`);
  } else if (botNet !== null && positionsNet - botNet >= 0.01) {
    warnings.push(`Positionen ergeben ${euro(positionsNet)} netto, der Rechnungshelfer nennt ${euro(botNet)} – bitte prüfen.`);
  }

  // Leistungsdatum: Lieferzeitraum, sonst die Sendungsdaten, sonst das Rechnungsdatum.
  const shipDays = [...new Set(d.positions.flatMap((p) => (p.trackings ?? []).map((t) => t.service_date).filter((x): x is string => Boolean(x))))].sort();
  const serviceDate = d.delivery?.date ?? shipDays[0] ?? d.invoice_date ?? opts.today;
  const until = d.delivery?.date_until ?? shipDays[shipDays.length - 1];
  const serviceDateTo = until && until > serviceDate ? until : undefined;
  const perShipment = [...new Map(d.positions.flatMap((p) => (p.trackings ?? []).filter((t) => t.service_date).map((t) => [t.tracking_number, t.service_date!] as const))).entries()];
  const note = shipDays.length > 1 ? `Lieferungen: ${perShipment.map(([nr, date]) => `${nr} am ${fmtDay(date)}`).join(", ")}` : undefined;

  const days = paymentDaysOf(d);
  if (d.currency && d.currency.toUpperCase() !== "EUR") warnings.push(`Währung ${d.currency} – Rechnungen gehen nur in Euro.`);

  const country = buyer?.country ?? "DE";
  const input: B2bInput = {
    buyer: buyer ?? { name: "", street: "", zip: "", city: "", country: "DE" },
    taxCase: suggestTaxCase(country, buyer?.vatId),
    serviceDate,
    ...(serviceDateTo ? { serviceDateTo } : {}),
    paymentDays: days ?? opts.defaultPaymentDays,
    reference: `Ticket ${d.ticket.trim()}`,
    ...(note ? { note } : {}),
    rcWhole: rc,
    lines,
  };

  const own = computeB2b(input, opts.kleinunternehmer);
  if (d.is_reverse_charge === false && own.rc13b.applies) warnings.push(`Handys/Tablets/Konsolen/Chips zusammen ${euro(own.rc13b.deviceNet)} netto – laut Rechnungshelfer kein Reverse Charge. § 13b prüfen.`);
  if (rc && input.taxCase === "domestic" && !own.rc13b.applies) warnings.push("Reverse Charge laut Rechnungshelfer – bitte prüfen, ob § 13b greift.");
  const botGross = typeof d.totals?.gross === "number" ? round(d.totals.gross) : null;
  // Der Rechnungshelfer rundet je Position, hier wird die USt auf die Summe gerechnet → Cent-Differenzen sind normal.
  const tolerance = 0.01 + 0.005 * lines.length;
  if (botGross !== null && Math.abs(botGross - own.totalGross) > tolerance && input.taxCase === "domestic") {
    warnings.push(`Brutto laut Rechnungshelfer ${euro(botGross)}, eigene Berechnung ${euro(own.totalGross)} – bitte prüfen.`);
  }
  if (!buyer) warnings.push("Rechnungsempfänger noch nicht festgelegt.");
  return { input, warnings, totals: { net: own.totalNet, gross: own.totalGross } };
}
