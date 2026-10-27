// Hebel für Umsatz und Marge: aus den sellerboard-Werten der letzten 30 Tage, dem Bestand, dem gültigen EK
// im Seller-System und der Buy Box laut Keepa. Reine Logik (ohne DB/Netz).
//
// Die Wirkung ist getrennt ausgewiesen und hergeleitet:
//   contribution = erwarteter zusätzlicher Deckungsbeitrag je Monat
//   saving       = geschätzte Kostenersparnis je Monat
//   capital      = einmalig freisetzbares Kapital (kein Monatswert, nie in der Monatssumme)
// impact = contribution + saving (Grundlage für Sortierung und Summen).

export type HebelType = "verlust" | "marge" | "erstattungen" | "kaufquote" | "spielraum" | "ladenhueter" | "nachbestellen" | "ek_fehlt";
export type Channel = "amazon" | "ebay";

export const HEBEL_INFO: Record<HebelType, { label: string; plural: string; hint: string }> = {
  verlust: { label: "Verlustbringer", plural: "Verlustbringer", hint: "Produkte, die in 30 Tagen Geld gekostet haben." },
  marge: { label: "Marge zu niedrig", plural: "Produkte mit niedriger Marge", hint: "Verkaufen sich, verdienen aber zu wenig." },
  erstattungen: { label: "Viele Erstattungen", plural: "Produkte mit vielen Erstattungen", hint: "Rückgaben kosten Geld und Ranking." },
  kaufquote: { label: "Schwache Kaufquote", plural: "Produkte mit schwacher Kaufquote", hint: "Viele Besucher, wenige Käufe – Listing oder Preis prüfen." },
  spielraum: { label: "Preis-Spielraum", plural: "Produkte mit Preis-Spielraum", hint: "Gefragt oder günstiger als die Buy Box – Preis vorsichtig anheben." },
  ladenhueter: { label: "Ladenhüter", plural: "Ladenhüter", hint: "Viel Geld im Bestand, verkauft sich kaum." },
  nachbestellen: { label: "Nachbestellen", plural: "Produkte nachbestellen", hint: "Gewinnbringer, die bald ausverkauft sind." },
  ek_fehlt: { label: "EK fehlt", plural: "Produkte ohne EK", hint: "Ohne Einkaufspreis ist der Gewinn falsch." },
};

export type Thresholds = { marginMin: number; reachMax: number; refundMax: number };
/** Standard: Marge unter 10 % prüfen, Reichweite über 120 Tage = Ladenhüter, Erstattungen über 5 % auffällig. */
export const DEFAULT_THRESHOLDS: Thresholds = { marginMin: 10, reachMax: 120, refundMax: 5 };

export type StatInput = {
  channel: Channel; sku: string; name: string | null; asin: string | null; image: string | null; link: string | null;
  units: number; refunds: number; sales: number | null; netProfit: number | null;
  fees: number | null; productCosts: number | null; advertising: number | null; vat: number | null; refundCost: number | null;
  price: number | null; sessions: number | null; conversion: number | null;
  daysLeft: number | null; timeToReorder: string | null;
  /** sellerboard hat keinen EK abgezogen. */
  costMissing: boolean;
};
/** Bestand bei Amazon je SKU; `cost` = gültiger EK netto (gleicher Rechenweg wie überall), null = unbekannt. */
export type StockInput = { sku: string; name: string | null; asin: string | null; fbaStock: number; reserved?: number; inbound?: number; daysLeft: number | null; salesVelocity: number | null; cost: number | null };
/** Annahmen für Ladenhüter: Lagergebühr je Stück und Monat (Einstellungen) und Kapitalkosten pro Jahr. */
export type Assumptions = { storagePerUnitMonth: number; capitalRatePa: number };
export const DEFAULT_ASSUMPTIONS: Assumptions = { storagePerUnitMonth: 0.1, capitalRatePa: 0.08 };
export type BuyBox = { price: number | null; hasBuyBox: boolean | null; isAmazon: boolean };

export type Hebel = {
  key: string; type: HebelType; channel: Channel; sku: string; name: string | null; asin: string | null; image: string | null; link: string | null;
  /** Monatliche Wirkung = contribution + saving (ohne freisetzbares Kapital). */
  impact: number;
  /** Erwarteter zusätzlicher Deckungsbeitrag je Monat. */
  contribution: number;
  /** Geschätzte Kostenersparnis je Monat. */
  saving: number;
  /** Einmalig freisetzbares Kapital (gebundener EK) – kein Monatswert. */
  capital: number;
  /** Herleitung mit Zahlen und Annahmen. */
  basis: string[];
  headline: string;
  action: string;
  facts: string[];
};

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2, minimumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });
const pct = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Gewinn mit dem gültigen EK aus dem Seller-System: Wo sellerboard keinen EK kennt, wird er abgezogen; wo
 * sellerboard einen anderen EK abgezogen hat, wird dessen Wert durch den gültigen ersetzt. null = EK unbekannt.
 */
export function correctedProfit(s: Pick<StatInput, "netProfit" | "units" | "costMissing"> & { productCosts?: number | null }, ownCost: number | null): number | null {
  if (s.netProfit === null) return null;
  if (ownCost === null) return s.costMissing ? null : s.netProfit;
  if (s.costMissing) return r2(s.netProfit - s.units * ownCost);
  if (s.productCosts === null || s.productCosts === undefined) return s.netProfit;
  return r2(s.netProfit + Math.abs(s.productCosts) - s.units * ownCost);
}

/** Anteil je zusätzlichem Euro Verkaufspreis, der an Gebühren und Umsatzsteuer geht. */
function variableShare(s: StatInput) {
  if (!s.sales || s.sales <= 0) return 0.35;
  const r = (Math.abs(s.fees ?? 0) * 0.6 + Math.abs(s.vat ?? 0)) / s.sales; // FBA-Pauschale ändert sich nicht mit dem Preis
  return Math.min(0.7, Math.max(0.1, r));
}

/** Nötige Preiserhöhung je Stück für die Zielmarge (null = nicht sinnvoll erreichbar). */
export function priceStep(sales: number, units: number, profit: number, varShare: number, targetPct: number): number | null {
  if (units <= 0 || sales <= 0) return null;
  const a = sales / units;
  const p = profit / units;
  const m = targetPct / 100;
  const denom = 1 - varShare - m;
  if (denom <= 0.1) return null;
  const d = (m * a - p) / denom;
  return d > 0 ? r2(d) : 0;
}

function perUnitAbs(v: number | null | undefined, units: number) {
  return v === null || v === undefined || units <= 0 ? null : r2(Math.abs(v) / units);
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export type HebelInput = {
  stats: StatInput[];
  stock: StockInput[];
  /** Gültiger EK je SKU aus dem Seller-System (ohne Werte, die selbst aus sellerboard stammen). */
  ownCost: Map<string, number>;
  buyBox: Map<string, BuyBox>;
  dismissed?: Set<string>;
  thresholds?: Thresholds;
  assumptions?: Assumptions;
  /** Auswertungszeitraum der 30-Tage-Werte (für die Herleitung). */
  period?: { from: string | null; to: string | null };
};

const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);

export function computeHebel(input: HebelInput): Hebel[] {
  const T = input.thresholds ?? DEFAULT_THRESHOLDS;
  const A = input.assumptions ?? DEFAULT_ASSUMPTIONS;
  const span = input.period?.from && input.period?.to ? `${dmy(input.period.from)} – ${dmy(input.period.to)}` : "letzte 30 Tage";
  const out: Hebel[] = [];
  const base = (s: StatInput, type: HebelType) => ({ key: `${type}:${s.channel}:${s.sku}`, type, channel: s.channel, sku: s.sku, name: s.name, asin: s.asin, image: s.image, link: s.link });
  const money = (o: { contribution?: number; saving?: number; capital?: number; basis: string[] }) => {
    const contribution = r2(Math.max(0, o.contribution ?? 0));
    const saving = r2(Math.max(0, o.saving ?? 0));
    return { contribution, saving, capital: r2(Math.max(0, o.capital ?? 0)), impact: r2(contribution + saving), basis: o.basis };
  };

  // Vergleichswert Kaufquote: Mittel der eigenen Amazon-Produkte mit genug Besuchern.
  const convs = input.stats.filter((s) => s.channel === "amazon" && (s.sessions ?? 0) >= 300 && s.conversion !== null && s.conversion > 0).map((s) => s.conversion!);
  const bench = convs.length >= 5 ? median(convs)! : 8;

  for (const s of input.stats) {
    const S = s.sales ?? 0;
    const U = s.units;
    if (U <= 0 || S <= 0) continue;
    const own = input.ownCost.get(s.sku) ?? null;
    const P = correctedProfit(s, own);
    const sbEk = s.costMissing ? null : perUnitAbs(s.productCosts, U);
    const swapped = own !== null && !s.costMissing && sbEk !== null && Math.abs(sbEk - own) > Math.max(0.01, Math.max(sbEk, own) * 0.02);
    const bb = s.asin ? input.buyBox.get(s.asin) : undefined;
    const vs = variableShare(s);
    const perUnit = (v: number | null) => (v === null ? null : r2(v / U));

    if (P === null) {
      out.push({ ...base(s, "ek_fehlt"), ...money({ basis: [`${U} Stück verkauft (${span}), weder im Seller-System noch in sellerboard ein EK – Gewinn nicht berechenbar.`] }), headline: `Kein EK hinterlegt – ${U} verkauft, ${eur(S)} Umsatz, Gewinn unbekannt`, action: "EK im Seller-System eintragen (Produkt → Chargen & Einkauf) – dann stimmen Gewinn, Nachbestellung und Hebel.", facts: [`${U} Stück in 30 Tagen`] });
      continue;
    }
    const m = (P / S) * 100;
    const a = S / U;
    const ek = own ?? sbEk;
    const facts = [
      `Ø Preis ${eur(a)}`,
      `Gebühren ${eur(Math.abs(perUnit(s.fees) ?? 0))}/Stück`,
      ek !== null ? `EK ${eur(ek)}/Stück${own !== null ? " (Seller-System)" : " (sellerboard)"}${swapped ? ` statt ${eur(sbEk!)} in sellerboard` : ""}` : "EK ?",
      ...(s.advertising && s.advertising < 0 ? [`Werbung ${eur(Math.abs(perUnit(s.advertising)!))}/Stück`] : []),
      `Gewinn ${eur(P / U)}/Stück · Marge ${pct(m)}`,
    ];

    // 1) Verlust
    if (U >= 3 && P < 0) {
      const step = priceStep(S, U, P, vs, T.marginMin);
      const target = step !== null ? r2(a + step) : null;
      const overBuyBox = bb?.price && target !== null && target > bb.price * 1.02;
      const ads = s.advertising && S > 0 ? Math.abs(s.advertising) / S : 0;
      const action = [
        overBuyBox
          ? `Für ${T.marginMin} % Marge wären ca. ${eur(target!)} nötig – über der Buy Box (${eur(bb!.price!)}). Einkaufspreis senken, anders anbieten oder auslaufen lassen.`
          : step !== null
            ? `Preis um ca. ${eur(step)} auf ${eur(target!)} anheben (Ziel ${T.marginMin} % Marge) – oder günstiger einkaufen.`
            : "Einkauf und Gebühren prüfen – mit Preiserhöhung allein kaum zu retten.",
        ...(ads > 0.15 ? [`Werbung frisst ${pct(ads * 100)} vom Umsatz – Kampagne prüfen.`] : []),
      ].join(" ");
      out.push({
        ...base(s, "verlust"),
        ...money({ contribution: -P, basis: [`Ergebnis ${span}: ${eur(P)} bei ${U} verkauften Stück.`, `Wird Preis oder EK so angepasst, dass mindestens ±0 € bleibt, fällt dieser Verlust weg: +${eur(-P)} Deckungsbeitrag je Monat.`, "Annahme: Absatz bleibt gleich."] }),
        headline: `${eur(P)} in 30 Tagen (${U} verkauft)`,
        action,
        facts,
      });
    }
    // 2) Marge zu niedrig
    else if (U >= 10 && m < T.marginMin) {
      const step = priceStep(S, U, P, vs, T.marginMin);
      out.push({
        ...base(s, "marge"),
        ...money({ contribution: (T.marginMin / 100) * S - P, basis: [`Umsatz ${span}: ${eur(S)} × Zielmarge ${T.marginMin} % = ${eur((T.marginMin / 100) * S)} Gewinn.`, `Heute: ${eur(P)} → Differenz ${eur((T.marginMin / 100) * S - P)} zusätzlicher Deckungsbeitrag je Monat.`, "Annahme: Absatz bleibt bei höherem Preis bzw. besserem EK gleich."] }),
        headline: `Marge ${pct(m)} – ${eur(P)} Gewinn auf ${eur(S)} Umsatz`,
        action: step ? `Preis um ca. ${eur(step)} auf ${eur(a + step)} anheben bringt ${T.marginMin} % Marge${bb?.price && a + step > bb.price * 1.02 ? ` – liegt aber über der Buy Box (${eur(bb.price)}); dann eher EK verhandeln` : ""}.` : "EK verhandeln oder Gebühren senken (Verpackung/Größe).",
        facts,
      });
    }

    // 3) Erstattungen
    const q = (s.refunds / U) * 100;
    if (U >= 10 && s.refunds >= 2 && q > T.refundMax) {
      const known = s.refundCost !== null && s.refundCost < 0;
      const cost = known ? Math.abs(s.refundCost!) : r2(s.refunds * a * 0.3);
      const perRefund = cost / s.refunds;
      const excess = s.refunds - (T.refundMax / 100) * U;
      out.push({
        ...base(s, "erstattungen"),
        ...money({
          saving: excess * perRefund,
          basis: [
            `${s.refunds} Erstattungen bei ${U} Verkäufen (${span}) = ${pct(q)}; Kosten ${eur(cost)}${known ? " laut sellerboard" : " (geschätzt: 30 % des Preises je Erstattung)"} = ${eur(perRefund)} je Erstattung.`,
            `Ziel höchstens ${T.refundMax} % = ${((T.refundMax / 100) * U).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Erstattungen → ${excess.toLocaleString("de-DE", { maximumFractionDigits: 1 })} weniger × ${eur(perRefund)} = ${eur(excess * perRefund)} Kostenersparnis je Monat.`,
          ],
        }),
        headline: `Erstattungen ${pct(q)} (${s.refunds} von ${U}) – ${eur(cost)} Kosten`,
        action: "Rücksendegründe ansehen (Retouren), Beschreibung und Bilder schärfen, Qualität/Variante prüfen.",
        facts,
      });
    }

    const pu = P / U;
    // 4) Kaufquote (nur Amazon, mit Besucherzahlen)
    if (s.channel === "amazon" && (s.sessions ?? 0) >= 300 && s.conversion !== null && s.conversion < bench * 0.6 && pu > 0) {
      const extra = ((s.sessions ?? 0) * (bench - s.conversion)) / 100;
      const bbNote = bb?.price && s.price && s.price > bb.price + 0.01 ? ` Buy Box liegt bei ${eur(bb.price)} – du bist ${eur(s.price - bb.price)} teurer.` : bb?.isAmazon ? " Die Buy Box hält Amazon." : "";
      out.push({ ...base(s, "kaufquote"), ...money({ contribution: extra * pu, basis: [`${(s.sessions ?? 0).toLocaleString("de-DE")} Besuche × (${pct(bench)} − ${pct(s.conversion)}) = ${extra.toLocaleString("de-DE", { maximumFractionDigits: 1 })} zusätzliche Verkäufe, wenn die Kaufquote das Mittel deiner Produkte erreicht.`, `× ${eur(pu)} Gewinn je Stück = ${eur(extra * pu)} Deckungsbeitrag je Monat.`] }), headline: `Kaufquote ${pct(s.conversion)} bei ${(s.sessions ?? 0).toLocaleString("de-DE")} Besuchen (deine Produkte im Mittel ${pct(bench)})`, action: `Bilder, Titel, Preis und Bewertungen prüfen.${bbNote}`, facts });
    }

    // 5) Preis-Spielraum: günstiger als die Buy Box, oder gefragt bei knapper Reichweite
    if (s.channel === "amazon" && U >= 5 && m >= 0) {
      const gap = bb?.price && s.price ? r2(bb.price - s.price) : 0;
      if (gap > 0.05 && gap / s.price! > 0.02) {
        out.push({ ...base(s, "spielraum"), ...money({ contribution: U * gap * (1 - vs), basis: [`${U} Stück × ${eur(gap)} höherer Preis × ${pct((1 - vs) * 100)} (was nach Gebühren und Umsatzsteuer bleibt) = ${eur(U * gap * (1 - vs))} je Monat.`, "Annahme: Absatz bleibt gleich – Preis schrittweise anheben und beobachten."] }), headline: `Du bist ${eur(gap)} günstiger als die Buy Box (${eur(bb!.price!)})`, action: `Preis schrittweise Richtung ${eur(bb!.price!)} anheben und Absatz beobachten.`, facts });
      } else if (U >= 10 && s.daysLeft !== null && s.daysLeft > 0 && s.daysLeft <= 21 && s.timeToReorder !== "NO") {
        out.push({ ...base(s, "spielraum"), ...money({ contribution: 0.03 * S * (1 - vs), basis: [`3 % höherer Preis auf ${eur(S)} Umsatz × ${pct((1 - vs) * 100)} nach Gebühren und Umsatzsteuer = ${eur(0.03 * S * (1 - vs))} je Monat.`, "Annahme: Absatz bleibt bis zum Nachschub gleich."] }), headline: `Läuft gut, Bestand reicht nur ${s.daysLeft} Tage`, action: "Preis um 3–5 % anheben – verkauft weniger schnell aus und bringt mehr je Stück, bis Nachschub da ist.", facts });
      }
    }

    // 7) Nachbestellen: Gewinnbringer, die bald weg sind
    if (P > 0 && (s.timeToReorder ?? "").toUpperCase() === "YES") {
      const days = Math.max(0, s.daysLeft ?? 0);
      const lost = (P / 30) * Math.max(0, 30 - days);
      if (lost >= 1) out.push({ ...base(s, "nachbestellen"), link: `/einkauf/vorschlaege?q=${encodeURIComponent(s.sku)}#sellerboard`, ...money({ contribution: lost, basis: [`Gewinn ${span}: ${eur(P)} = ${eur(P / 30)} je Tag.`, `Bestand reicht ${days} Tage → ${30 - days} Tage ohne Ware im nächsten Monat × ${eur(P / 30)} = ${eur(lost)} entgangener Deckungsbeitrag, wenn nicht nachbestellt wird.`] }), headline: `Noch ${days} Tage Bestand – ${eur(P / 30)} Gewinn je Tag`, action: "Jetzt nachbestellen (Einkauf → Bestellvorschläge), sonst fehlt der Gewinn bis zur nächsten Lieferung.", facts });
    }
  }

  // 6) Ladenhüter aus dem Bestand (auch ohne Verkäufe in 30 Tagen) – bewertet mit dem gültigen EK.
  for (const st of input.stock) {
    const units = st.fbaStock + (st.reserved ?? 0) + (st.inbound ?? 0);
    if (units <= 0 || st.fbaStock <= 0 || st.cost === null) continue;
    const value = r2(st.cost * units);
    if (value < 50) continue;
    const noSales = st.daysLeft !== null && st.daysLeft >= 900;
    const reach = st.salesVelocity !== null && st.salesVelocity > 0 ? Math.round(st.fbaStock / st.salesVelocity) : null;
    const days = noSales ? null : (st.daysLeft ?? reach);
    if (days !== null && days <= T.reachMax) continue;
    const storage = units * A.storagePerUnitMonth;
    const interest = (value * A.capitalRatePa) / 12;
    out.push({
      key: `ladenhueter:amazon:${st.sku}`,
      type: "ladenhueter",
      channel: "amazon",
      sku: st.sku,
      name: st.name,
      asin: st.asin,
      image: null,
      link: st.asin ? `https://www.amazon.de/dp/${st.asin}` : null,
      ...money({
        saving: storage + interest,
        capital: value,
        basis: [
          `Gebunden: ${units} Stück × EK ${eur(st.cost)} = ${eur(value)} – freisetzbar beim Abverkauf (einmalig, kein Monatswert).`,
          `Lagergebühr: ${units} Stück × ${eur(A.storagePerUnitMonth)} je Stück und Monat (Annahme aus Einstellungen) = ${eur(storage)}.`,
          `Kapitalkosten: ${eur(value)} × ${pct(A.capitalRatePa * 100)} im Jahr ÷ 12 = ${eur(interest)} (Annahme).`,
          `Kostenersparnis je Monat nach Abverkauf: ${eur(storage + interest)}. Ein Preisnachlass senkt den Erlös – nicht eingerechnet.`,
        ],
      }),
      headline: `${eur(value)} gebunden – ${days === null ? "keine Verkäufe in den letzten 30 Tagen" : `Reichweite ${days} Tage`} (${units} Stück)`,
      action: "Abverkauf planen: Preis senken oder Coupon, zusätzlich auf eBay anbieten; ab 181 Tagen Lagerzeit kommen Langzeit-Lagergebühren dazu.",
      facts: [[`${st.fbaStock} verkaufbar`, st.reserved ? `${st.reserved} reserviert` : null, st.inbound ? `${st.inbound} unterwegs` : null].filter(Boolean).join(" · ")],
    });
  }

  const dismissed = input.dismissed ?? new Set<string>();
  return out.filter((h) => !dismissed.has(h.key)).sort((x, y) => y.impact - x.impact || y.capital - x.capital);
}

export type HebelSummary = { type: HebelType; count: number; impact: number; contribution: number; saving: number; capital: number };

export function summarize(list: Hebel[]): HebelSummary[] {
  const m = new Map<HebelType, HebelSummary>();
  for (const h of list) {
    const cur = m.get(h.type) ?? { type: h.type, count: 0, impact: 0, contribution: 0, saving: 0, capital: 0 };
    cur.count++;
    cur.impact = r2(cur.impact + h.impact);
    cur.contribution = r2(cur.contribution + h.contribution);
    cur.saving = r2(cur.saving + h.saving);
    cur.capital = r2(cur.capital + h.capital);
    m.set(h.type, cur);
  }
  return [...m.values()].sort((a, b) => b.impact - a.impact || b.capital - a.capital);
}

/** Summen über alle Arten: Monatswirkung (Deckungsbeitrag + Ersparnis) und freisetzbares Kapital getrennt. */
export function totals(summary: HebelSummary[]) {
  return summary.reduce((t, s) => ({ impact: r2(t.impact + s.impact), contribution: r2(t.contribution + s.contribution), saving: r2(t.saving + s.saving), capital: r2(t.capital + s.capital) }), { impact: 0, contribution: 0, saving: 0, capital: 0 });
}

/** Sammelaufgabe je Hebel-Art: Titel nur mit Anzahl (ändert sich selten), Beträge in den Notizen. */
export function hebelTask(sum: HebelSummary, top: Hebel[]): { title: string; notes: string } | null {
  const n = sum.count;
  const one = n === 1;
  const lines = top.slice(0, 3).map((h) => `• ${h.name ?? h.sku}: ${h.headline}`);
  const money = sum.impact > 0 ? `Wirkung zusammen ca. ${eur(sum.impact)} im Monat.` : "";
  const titles: Record<HebelType, string | null> = {
    verlust: `${n} Verlustbringer prüfen – Preis oder Einkauf anpassen`,
    marge: `${n} ${one ? "Produkt" : "Produkte"} mit zu niedriger Marge prüfen`,
    erstattungen: `${n} ${one ? "Produkt" : "Produkte"} mit vielen Erstattungen prüfen`,
    kaufquote: `${n} ${one ? "Listing" : "Listings"} mit schwacher Kaufquote verbessern`,
    spielraum: `${n} ${one ? "Preis" : "Preise"} anheben (Preis-Spielraum)`,
    ladenhueter: `${n} ${one ? "Ladenhüter" : "Ladenhüter"} abverkaufen`,
    nachbestellen: null, // eigene Sammelaufgabe „jetzt nachbestellen“ gibt es schon
    ek_fehlt: `EK für ${n} ${one ? "verkauftes Produkt" : "verkaufte Produkte"} nachtragen`,
  };
  const title = titles[sum.type];
  if (!title) return null;
  return { title, notes: [money, ...lines].filter(Boolean).join("\n") };
}
