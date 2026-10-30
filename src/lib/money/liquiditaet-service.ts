import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { kontostand, letzterImport, umsaetzeSeit, wiederkehrend } from "@/lib/bank/service";
import { termineBis } from "@/lib/bank/logic";
import { ekFuerMenge } from "@/lib/b2b/eingabe";
import { angelegteAsins, sellerboardReorder } from "@/lib/purchasing/reorder";
import { kapitalbedarf } from "@/lib/purchasing/reorder-logic";
import { getSettings } from "@/lib/settings";
import { ampelJeSku } from "./kapital-service";
import { addMonthsIso, projectPayouts, weekStart } from "./cashflow";
import { kontostandAlter, liquiditaetWochen, steuerPosten, wareneinkaufPlan, woechentlich, type LiqWoche, type Posten } from "./liquiditaet";

// Liquiditätsvorschau: sammelt alle Zu- und Abflüsse der nächsten Wochen aus den vorhandenen Daten und rechnet
// Woche für Woche den Kontostand gegen die Mindestreserve. Jede Quelle meldet, ob sie Daten hatte.

export type Quelle = { name: string; status: "ok" | "keine_daten" | "aus" | "veraltet"; hinweis?: string };
export type Liquiditaet = { wochen: LiqWoche[]; start: number | null; startStand: string | null; kontostandAlterTage: number | null; startQuelle: "bank" | "hand" | null; reserve: number; quellen: Quelle[]; posten: Posten[]; szenario: Posten | null; ohneSzenario: LiqWoche[] | null };

export async function liquiditaet(tenantId: string, o: { heute: string; wochen?: number; szenario?: { betrag: number; datum: string; label: string } | null; ausschliessen?: (z: { sku: string; asin: string | null }) => boolean }): Promise<Liquiditaet> {
  const t = tenantId;
  const heute = o.heute;
  const wochen = Math.min(26, Math.max(1, o.wochen ?? 8));
  const ende = addDaysIso(weekStart(heute), wochen * 7 - 1);
  const s = await getSettings(t);
  const L = s.liquiditaet;
  const quellen: Quelle[] = [];
  const posten: Posten[] = [];

  // Startsaldo: Kontoauszug, sonst von Hand
  const bank = await kontostand(t, "geschaeft", null, heute);
  const [tenant] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, t));
  const hand = tenant?.settings.cash?.startBalance ?? null;
  const start = bank?.saldo ?? hand;
  const startStand = bank?.stand ?? tenant?.settings.cash?.asOf ?? null;
  const alter = kontostandAlter(startStand, heute);
  const alt = alter !== null && alter > 7;
  quellen.push({ name: "Kontostand", status: start === null ? "keine_daten" : alt ? "veraltet" : "ok", hinweis: `${bank ? `Kontoauszug bis ${bank.stand}` : hand !== null ? "von Hand eingetragen" : "Kontoauszug hochladen oder Kontostand eintragen"}${alt ? ` – ${alter} Tage alt: neuen Kontoauszug hochladen, sonst stimmt die Vorschau nicht` : ""}` });

  // Amazon: Rhythmus und Ø der letzten Abrechnungen
  const st = await db.select({ datum: schema.amazonSettlements.depositDate, betrag: schema.amazonSettlements.totalAmount }).from(schema.amazonSettlements).where(and(eq(schema.amazonSettlements.tenantId, t), isNotNull(schema.amazonSettlements.depositDate))).orderBy(desc(schema.amazonSettlements.depositDate)).limit(12);
  const verlauf = st.filter((x) => x.betrag !== null).map((x) => ({ date: x.datum!.toISOString().slice(0, 10), amount: x.betrag! }));
  for (const p of projectPayouts(verlauf, heute, ende)) posten.push({ datum: p.date, betrag: p.amount, label: "Amazon-Auszahlung (Ø letzte Abrechnungen)", art: "amazon", geschaetzt: true });
  quellen.push({ name: "Amazon-Auszahlungen", status: verlauf.length >= 2 ? "ok" : "keine_daten", hinweis: verlauf.length >= 2 ? `${verlauf.length} Abrechnungen` : "Abrechnungen (Settlement) importieren" });

  // eBay/Temu: Ø Auszahlung je Woche der letzten 28 Tage (sellerboard)
  const K = schema.sellerboardKpis;
  const kpi = await db
    .select({ channel: K.channel, payout: sql<number>`coalesce(sum(${K.payout}), 0)::float`, tage: sql<number>`count(distinct ${K.fromDay})::int` })
    .from(K)
    .where(and(eq(K.tenantId, t), sql`${K.fromDay} = ${K.toDay}`, gte(K.fromDay, addDaysIso(heute, -28)), inArray(K.channel, ["ebay", "temu"])))
    .groupBy(K.channel);
  for (const kanal of ["ebay", "temu"] as const) {
    const k = kpi.find((x) => x.channel === kanal);
    if (k && k.tage >= 7 && k.payout > 0) posten.push(...woechentlich({ betragProWoche: (k.payout / k.tage) * 7, heute, wochen, label: `${kanal === "ebay" ? "eBay" : "Temu"}-Auszahlungen (Ø 28 Tage)`, art: kanal }));
    quellen.push({ name: kanal === "ebay" ? "eBay" : "Temu", status: k && k.tage >= 7 ? "ok" : "keine_daten", hinweis: k ? `${k.tage} Tage sellerboard` : "keine sellerboard-Tageswerte" });
  }

  // B2B: offene Vorkasse-Rechnungen (Zahlung binnen 7 Tagen erwartet)
  const R = schema.dealReservierungen;
  const b2b = await db.select({ betrag: R.rechnungBrutto, am: R.updatedAt, nr: R.rechnungNr }).from(R).where(and(eq(R.tenantId, t), eq(R.status, "vorkasse_offen"), isNotNull(R.rechnungBrutto)));
  for (const x of b2b) posten.push({ datum: addDaysIso(x.am.toISOString().slice(0, 10), 7), betrag: x.betrag!, label: `B2B-Rechnung ${x.nr ?? ""}`.trim(), art: "b2b", geschaetzt: true });
  quellen.push({ name: "B2B-Forderungen", status: "ok", hinweis: `${b2b.length} offen` });

  // B2B: Zahlungen an Großhändler (freigegebene/bestellte Sammelbestellungen)
  const B = schema.dealBestellungen;
  const D = schema.deals;
  const LP = schema.lieferantenProfile;
  const gh = await db
    .select({ menge: B.menge, status: B.status, bestelltAm: B.bestelltAm, ek: D.ekNetto, staffel: D.staffel, nr: D.nr, ziel: LP.zahlungszielTage })
    .from(B)
    .innerJoin(D, eq(D.id, B.dealId))
    .leftJoin(LP, and(eq(LP.supplierId, D.supplierId), eq(LP.tenantId, D.tenantId)))
    .where(and(eq(B.tenantId, t), inArray(B.status, ["freigegeben", "bestellt"])));
  for (const x of gh) {
    const basis = x.bestelltAm ? x.bestelltAm.toISOString().slice(0, 10) : heute;
    posten.push({ datum: addDaysIso(basis, x.ziel ?? 0), betrag: -Math.round(ekFuerMenge(x.ek, x.staffel, x.menge) * x.menge * (1 + s.b2b.ustSatz) * 100) / 100, label: `Großhändler Deal #${x.nr}`, art: "grosshaendler", geschaetzt: true });
  }

  // Lieferantenrechnungen mit Zahlungsziel, noch nicht vom Konto abgebucht
  const I = schema.invoices;
  const rechnungen = await db
    .select({ id: I.id, datum: I.invoiceDate, brutto: I.totalGross, nr: I.invoiceNumber, vendor: I.vendor, ziel: LP.zahlungszielTage })
    .from(I)
    .leftJoin(LP, and(eq(LP.supplierId, I.supplierId), eq(LP.tenantId, I.tenantId)))
    .where(and(eq(I.tenantId, t), eq(I.docType, "rechnung"), inArray(I.kind, ["goods", "expense"]), gte(I.invoiceDate, addDaysIso(heute, -60)), isNotNull(I.totalGross)));
  const abbuchungen = (await umsaetzeSeit(t, "geschaeft", null, addDaysIso(heute, -60))).filter((u) => u.betrag < 0);
  let offeneRechnungen = 0;
  for (const r of rechnungen) {
    const ziel = r.ziel ?? L.zahlungszielStandard;
    if (!ziel || !r.datum || !r.brutto || r.brutto <= 0) continue;
    const bezahlt = abbuchungen.some((u) => u.buchungstag >= r.datum! && Math.abs(-u.betrag - r.brutto!) <= Math.max(1, r.brutto! * 0.01));
    if (bezahlt) continue;
    offeneRechnungen++;
    posten.push({ datum: addDaysIso(r.datum, ziel), betrag: -r.brutto, label: `Rechnung ${r.vendor ?? ""} ${r.nr ?? ""}`.replace(/\s+/g, " ").trim(), art: "rechnung", geschaetzt: false });
  }
  quellen.push({ name: "Lieferantenrechnungen", status: "ok", hinweis: `${offeneRechnungen} offen (nur Lieferanten mit Zahlungsziel im Profil${L.zahlungszielStandard ? `, sonst ${L.zahlungszielStandard} Tage` : ""})` });

  // Freigegebene Einkäufe: im Einkauf angelegte bzw. bestellte Ware ohne verknüpfte Rechnung (die Rechnung zählt
  // sonst schon als Lieferantenrechnung). Datum: Bestelldatum, angelegte Entwürfe ab heute.
  const PO = schema.purchaseOrders;
  const POI = schema.purchaseOrderItems;
  const offeneBestellungen = await db
    .select({ id: PO.id, nr: PO.number, status: PO.status, datum: PO.orderDate, versand: PO.shippingCostGross, summe: sql<string>`coalesce(sum(${POI.quantity} * ${POI.unitCostGross}), 0)`, asins: sql<string[]>`coalesce(array_agg(${POI.asin}) filter (where ${POI.asin} is not null), '{}')` })
    .from(PO)
    .leftJoin(POI, eq(POI.poId, PO.id))
    .where(and(eq(PO.tenantId, t), inArray(PO.status, ["draft", "ordered", "shipped", "partial"]), sql`${PO.invoiceId} is null`))
    .groupBy(PO.id);
  const freigegebeneAsins = new Set<string>();
  for (const b of offeneBestellungen) {
    const betrag = Number(b.summe) + Number(b.versand ?? 0);
    for (const a of b.asins ?? []) freigegebeneAsins.add(a);
    if (betrag <= 0) continue;
    posten.push({ datum: b.datum ?? heute, betrag: -Math.round(betrag * 100) / 100, label: `Einkauf ${b.nr}${b.status === "draft" ? " (angelegt)" : ""}`, art: "einkauf", geschaetzt: false });
  }
  quellen.push({ name: "Einkäufe (angelegt/bestellt)", status: "ok", hinweis: `${offeneBestellungen.length} offen ohne Rechnung` });

  // Mögliche Einkäufe: Bestellvorschläge mit „bestellen bis“. Vor der Freigabe (= im Einkauf angelegt) nur als
  // eigene Zeile – sie ändern den Kontostand nicht, außer „Vorschläge einrechnen“ ist eingeschaltet.
  if (L.bestellvorschlaege) {
    const r = await sellerboardReorder(t).catch(() => ({ rows: [], syncedAt: null }));
    // B15.5: gleiche Rechnung wie Startseite und Bestellvorschläge – rote Kapital-Ampel und schon angelegte
    // Einkäufe heraus (die zählen oben als Einkauf bzw. Rechnung).
    const ampel = o.ausschliessen || !r.rows.length ? null : await ampelJeSku(t, heute).catch(() => null);
    const weg = o.ausschliessen ?? ((z: { sku: string }) => ampel?.get(z.sku) === "rot");
    const angelegt = r.rows.length ? await angelegteAsins(t).catch(() => new Set<string>()) : new Set<string>();
    for (const a of freigegebeneAsins) angelegt.add(a);
    const k = kapitalbedarf(r.rows, { weg: (z) => weg({ sku: z.sku, asin: z.asin }), angelegteAsins: angelegt });
    const rot = k.rote;
    let n = 0;
    let summe = 0;
    for (const z of k.rows) {
      if (z.isReturn || z.capital === null || z.capital <= 0) continue;
      posten.push({ datum: z.orderBy && z.orderBy > heute ? z.orderBy : heute, betrag: -z.capital, label: `Vorschlag ${z.name ?? z.sku}`.slice(0, 80), art: "vorschlag", geschaetzt: true, nichtEingerechnet: !L.vorschlaegeEinrechnen });
      summe += z.capital;
      n++;
    }
    quellen.push({
      name: "Bestellvorschläge",
      status: r.rows.length ? "ok" : "keine_daten",
      hinweis: `${n} mögliche Einkäufe (${Math.round(summe).toLocaleString("de-DE")} €) ${L.vorschlaegeEinrechnen ? "eingerechnet" : "nur als eigene Zeile – erst im Einkauf angelegt zählen sie"}${rot ? ` · ${rot} mit roter Kapital-Ampel weggelassen` : ""}${k.angelegt ? ` · ${k.angelegt} schon im Einkauf angelegt` : ""} – gleiche Rechnung wie Startseite und Bestellvorschläge`,
    });
  } else quellen.push({ name: "Bestellvorschläge", status: "aus" });

  // Kontoauszug: Kreditkarte und Fixkosten
  const imp = await letzterImport(t, "geschaeft", null);
  const wk = imp.n ? await wiederkehrend(t, "geschaeft", null, heute) : [];
  const ignoriert = new Set(L.ignoriert);
  let karte = false;
  for (const w of wk) {
    if (ignoriert.has(w.gruppeHash)) continue;
    const betrag = w.art === "kreditkarte" && L.kreditkarte.betrag ? L.kreditkarte.betrag : w.betrag;
    if (w.art === "kreditkarte") karte = true;
    for (const d of termineBis(w, heute, ende)) posten.push({ datum: d, betrag: -betrag, label: w.name, art: w.art === "kreditkarte" ? "kreditkarte" : w.art === "steuer" ? "steuer" : "fixkosten", geschaetzt: w.art === "kreditkarte" });
  }
  if (!karte && L.kreditkarte.tag && L.kreditkarte.betrag) {
    let d = `${heute.slice(0, 8)}${String(Math.min(28, L.kreditkarte.tag)).padStart(2, "0")}`;
    while (d <= ende) {
      if (d >= heute) posten.push({ datum: d, betrag: -L.kreditkarte.betrag, label: "Kreditkarte (Einstellung)", art: "kreditkarte", geschaetzt: true });
      d = addMonthsIso(d, 1);
    }
  }
  quellen.push({ name: "Kontoauszug (Fixkosten, Kreditkarte)", status: imp.n ? "ok" : "keine_daten", hinweis: imp.n ? `${wk.length} wiederkehrend erkannt, Auszug bis ${imp.bis}` : "Kontoauszug (CSV/CAMT) hochladen" });

  // Plan-Posten von Hand
  const C = schema.cashItems;
  const plan = await db.select().from(C).where(eq(C.tenantId, t));
  for (const p of plan) {
    const art = p.category === "fixkosten" ? "fixkosten" : p.category === "steuern" ? "steuer" : p.category === "einkauf" ? "einkauf" : "plan";
    if (p.recurrence === "none") posten.push({ datum: p.date, betrag: p.amount, label: p.description, art, geschaetzt: false });
    else {
      let d = p.date;
      for (let n = 1; d <= ende && n < 400; n++) {
        if (d >= heute && (!p.endDate || d <= p.endDate)) posten.push({ datum: d, betrag: p.amount, label: p.description, art, geschaetzt: false });
        d = p.recurrence === "weekly" ? addDaysIso(p.date, 7 * n) : addMonthsIso(p.date, n);
      }
    }
  }

  // B15.6: üblicher Wareneinkauf je Woche (Ø Warenrechnungen der letzten 8 Wochen) – sonst fehlt der Einkauf ganz.
  if (L.wareneinkaufPlanen !== false) {
    const I = schema.invoices;
    const [w] = await db
      .select({ summe: sql<number>`coalesce(sum(${I.totalGross}), 0)::float`, n: sql<number>`count(*)::int` })
      .from(I)
      .where(and(eq(I.tenantId, t), eq(I.kind, "goods"), ne(I.status, "ignored"), gte(I.invoiceDate, addDaysIso(heute, -56)), lte(I.invoiceDate, heute)));
    const proWoche = w.n >= 2 ? w.summe / 8 : 0;
    posten.push(...wareneinkaufPlan({ proWoche, heute, wochen, konkret: posten }));
    quellen.push({ name: "Wareneinkauf (Ø Rechnungen)", status: proWoche > 0 ? "ok" : "keine_daten", hinweis: proWoche > 0 ? `Ø ${Math.round(proWoche).toLocaleString("de-DE")} € je Woche aus ${w.n} Warenrechnungen (8 Wochen) – abzüglich konkret angelegter Einkäufe` : "noch zu wenige Warenrechnungen (Eingangsrechnungen) für einen Durchschnitt" });
  }

  // Steuertermine (Schätzung aus den Einstellungen)
  posten.push(...steuerPosten(L.steuern, heute, ende));
  quellen.push({ name: "Steuertermine", status: L.steuern.length ? "ok" : "keine_daten", hinweis: L.steuern.length ? `${L.steuern.length} hinterlegt (Schätzung)` : "in den Einstellungen unten pflegen" });

  const szenario: Posten | null = o.szenario ? { datum: o.szenario.datum, betrag: -Math.abs(o.szenario.betrag), label: o.szenario.label || "Geplanter Einkauf (Was wäre wenn)", art: "szenario", geschaetzt: false } : null;
  const basis = { heute, wochen, start, reserve: L.reserve };
  const ohneSzenario = szenario ? liquiditaetWochen({ ...basis, posten }) : null;
  return { wochen: liquiditaetWochen({ ...basis, posten: szenario ? [...posten, szenario] : posten }), start, startStand, kontostandAlterTage: kontostandAlter(startStand, heute), startQuelle: bank ? "bank" : hand !== null ? "hand" : null, reserve: L.reserve, quellen, posten, szenario, ohneSzenario };
}
