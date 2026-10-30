// Abschnitt 10 „Kaufen mit einem Tap“ – reine Logik: Budget-Grenzen, Direktlink zum Angebot, Kauf-Meldung,
// Bestellbestätigung aus einer Mail lesen. Es gibt bewusst KEINEN automatischen Kauf: Kauf-Bots verstoßen gegen die
// Nutzungsbedingungen von Amazon und der meisten Shops (Risiko für Käufer- und verknüpftes Verkäuferkonto).

const eur = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const eur0 = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;

export type Budget = { jeDeal: number; jeTag: number; jeWoche: number };
export type BudgetPruefung = { ok: boolean; hinweis: string | null; restWoche: number | null; restTag: number | null };

/**
 * Budget-Grenzen (0 = keine Grenze). Kapital = empfohlene Menge × EK netto des Deals; verbraucht = schon gekaufte
 * Deals heute bzw. in dieser Woche. Darüber wird der Deal höchstens Gelb.
 */
export function budgetPruefen(kapital: number | null, b: Budget, verbraucht: { tag: number; woche: number }): BudgetPruefung {
  const restWoche = b.jeWoche > 0 ? Math.max(0, Math.round((b.jeWoche - verbraucht.woche) * 100) / 100) : null;
  const restTag = b.jeTag > 0 ? Math.max(0, Math.round((b.jeTag - verbraucht.tag) * 100) / 100) : null;
  if (kapital === null || !(kapital > 0)) return { ok: true, hinweis: null, restWoche, restTag };
  if (b.jeDeal > 0 && kapital > b.jeDeal) return { ok: false, hinweis: `Budget: ${eur0(kapital)} über der Grenze je Deal (${eur0(b.jeDeal)}).`, restWoche, restTag };
  if (restTag !== null && kapital > restTag) return { ok: false, hinweis: `Budget: heute noch ${eur0(restTag)} frei (Grenze ${eur0(b.jeTag)}/Tag).`, restWoche, restTag };
  if (restWoche !== null && kapital > restWoche) return { ok: false, hinweis: `Budget: diese Woche noch ${eur0(restWoche)} frei (Grenze ${eur0(b.jeWoche)}/Woche).`, restWoche, restTag };
  return { ok: true, hinweis: null, restWoche, restTag };
}

const TLD: Record<string, string> = { DE: "de", FR: "fr", IT: "it", ES: "es", NL: "nl", BE: "com.be", PL: "pl", SE: "se", UK: "co.uk", GB: "co.uk", IE: "ie" };
export const amazonSeite = (asin: string, land: string | null) => `https://www.amazon.${TLD[(land ?? "DE").toUpperCase()] ?? "de"}/dp/${asin}`;

/**
 * Direktlink zum Angebot: erster Shop-Link aus der Nachricht (kein Amazon-Link, kein Kurz-Tracking von Discord/WhatsApp),
 * sonst die Amazon-Produktseite im besten Land.
 */
export function angebotsLink(rohtext: string, asin: string | null, land: string | null): string | null {
  for (const m of rohtext.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (/(^|\.)amazon\.|amzn\.|discord(app)?\.com|wa\.me|whatsapp\.com|keepa\.com|profitpath/.test(host)) continue;
    return url;
  }
  return asin ? amazonSeite(asin, land) : null;
}

export type KaufZeile = { titel: string | null; name: string | null; ekNetto: number | null; bestesLand: string | null; roi: number | null; gewinn: number | null; empfohlen: number | null; kapitalbedarf: number | null; maxEk: { land: string; ek: number }[]; gueltigBis: string | null };

/** Kauf-Meldung bei Grün: Menge, max. EK, Restbudget der Woche, Ablauf des Deals. */
export function kaufText(z: KaufZeile, o: { restWoche: number | null; wert?: number | null }): string {
  const teile = [`🟢 ${(z.titel ?? z.name ?? "Deal").slice(0, 40)}`];
  if (z.ekNetto !== null) teile.push(`EK ${eur(z.ekNetto)}`);
  if (z.bestesLand && z.roi !== null) teile.push(`${z.bestesLand}: ROI ${Math.round(z.roi)} %${z.gewinn !== null ? `, ${eur(z.gewinn)}/Stk` : ""}`);
  if (z.empfohlen) teile.push(`Empf. ${z.empfohlen} Stk${z.kapitalbedarf ? ` (${eur0(z.kapitalbedarf)})` : ""}`);
  if (z.maxEk[0]) teile.push(`max. EK ${eur(z.maxEk[0].ek)}`);
  if (o.restWoche !== null) teile.push(`Budget Woche noch ${eur0(o.restWoche)}`);
  if (z.gueltigBis) teile.push(`gültig bis ${z.gueltigBis}`);
  if (o.wert !== null && o.wert !== undefined) teile.push(`passt zu dir ${o.wert}/100`);
  return teile.join(" · ");
}

// ---- Bestellbestätigung per Mail ---------------------------------------------------------------------------------

export type Bestellung = { shop: string; bestellnr: string | null; positionen: { asin: string | null; titel: string | null; menge: number; preis: number | null }[] };

const BETREFF = /(bestellbest[äa]tigung|ihre (amazon\.[a-z.]+ )?bestellung|^bestellt:|bestellung (eingegangen|erhalten|best[äa]tigt)|order confirm|your (amazon\.[a-z.]+ )?order|order (received|placed)|confirmation de (votre )?commande|conferma (dell'?)?ordine|confirmaci[oó]n (de(l)? )?pedido|bevestiging van (je |uw )?bestelling|potwierdzenie zam[oó]wienia)/i;
const ABSAGE = /(storniert|stornierung|cancel|annul|versandbest[äa]tigung|wurde versandt|has shipped|shipped|r[üu]cksendung|refund|erstattung|rechnung|invoice)/i;
const zahl = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Shop aus der Absender-Domain („bestellung@shop-xy.de“ → „shop-xy.de“; Amazon → „Amazon“). */
export function shopAus(von: string): string {
  const voll = (von.match(/@([a-z0-9.-]+)/i)?.[1] ?? von).toLowerCase();
  // Technische Vorsilbe nur abschneiden, wenn danach noch eine Domain übrig bleibt („news.shop.de“ → „shop.de“).
  const kurz = voll.replace(/^(mail|email|e-mail|noreply|no-reply|news|info|order|orders|shop|bestellung|service)\./, "");
  const d = kurz.includes(".") ? kurz : voll;
  return /(^|\.)amazon\./.test(d) ? "Amazon" : d;
}

/**
 * Ist das eine Bestellbestätigung (Amazon oder Shop)? Liest ASINs aus Produktlinks, Mengen („Menge: 60“, „60 x“,
 * „Qty 60“) und Preise. Versand-, Storno- und Rechnungsmails zählen nicht.
 */
export function bestellbestaetigung(m: { von: string; betreff: string; text: string }): Bestellung | null {
  if (!BETREFF.test(m.betreff) || ABSAGE.test(m.betreff)) return null;
  const text = m.text.slice(0, 50_000);
  const bestellnr = text.match(/(?:bestell(?:nummer|nr\.?)|order\s*(?:#|number|no\.?)|n°\s*de\s*commande|numero\s*(?:d'?)?ordine|n[uú]mero\s*de\s*pedido)\s*:?\s*([A-Z0-9][A-Z0-9-]{4,})/i)?.[1] ?? m.betreff.match(/\b(\d{3}-\d{7}-\d{7})\b/)?.[1] ?? null;
  const asins = [...new Set([...text.matchAll(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})\b/g)].map((x) => x[1]))];
  const mengen = [...text.matchAll(/(?:menge|anzahl|st[üu]ckzahl|qty|quantity|quantit[éea]|cantidad)\s*:?\s*(\d{1,5})\b|\b(\d{1,5})\s*(?:x|×|stk\.?|st[üu]ck)\s/gi)].map((x) => Number(x[1] ?? x[2])).filter((n) => n > 0);
  const preise = [...text.matchAll(/(?:je|pro|à|each|per unit|einzelpreis|st[üu]ckpreis|prix unitaire|prezzo unitario)\s*:?\s*(?:EUR|€)?\s*(\d{1,6}(?:[.,]\d{3})*[.,]\d{2})/gi)].map((x) => zahl(x[1]));
  const positionen = (asins.length ? asins : [null]).map((asin, i) => ({ asin, titel: null, menge: mengen[i] ?? mengen[0] ?? 1, preis: preise[i] ?? preise[0] ?? null }));
  if (!asins.length && !mengen.length && !bestellnr) return null;
  return { shop: shopAus(m.von), bestellnr, positionen };
}

/** Wie gut passt eine Bestell-Position zu einer Deal-Zeile? ASIN sicher; sonst gemeinsame Wörter im Titel. */
export function passtZuDeal(p: { asin: string | null; titel: string | null }, z: { asin: string | null; titel: string | null; name: string | null }, mailText: string): boolean {
  if (p.asin && z.asin) return p.asin === z.asin;
  if (z.asin && mailText.includes(z.asin)) return true;
  const woerter = (s: string | null) => new Set((s ?? "").toLowerCase().split(/[^a-z0-9äöüß]+/).filter((w) => w.length >= 4));
  const a = woerter(z.titel ?? z.name);
  if (a.size < 2) return false;
  const t = mailText.toLowerCase();
  let treffer = 0;
  for (const w of a) if (t.includes(w)) treffer++;
  return treffer >= Math.min(3, a.size);
}
