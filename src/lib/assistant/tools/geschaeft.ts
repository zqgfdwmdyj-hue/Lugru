import "server-only";
import { and, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { carrierList, removalParcels } from "@/lib/claims/rules";
import { HEBEL_INFO, type HebelType } from "@/lib/hebel/rules";
import { loadHebel } from "@/lib/hebel/service";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { integrationStatus } from "@/lib/integrations/store";
import { bestellvorschlaegeGemeinsam } from "@/lib/purchasing/reorder";
import { CHECK_LABEL, filterReorder, KAPITALBEDARF_DEFINITION, reorderTotals, URGENCY_LABEL, type ReorderCheck, type Urgency } from "@/lib/purchasing/reorder-logic";
import { daysUntil, MODULE_LABEL, WAITING_LABEL } from "@/lib/sas/logic";
import { getProgram, loadBrands, loadDeals, loadItems } from "@/lib/sas/service";
import { getSettings } from "@/lib/settings";
import { BQOOL_MAERKTE, HINWEIS_RANG, HINWEIS_TEXT, regelUebersicht } from "@/lib/bqool/logic";
import { bqoolStand } from "@/lib/bqool/service";
import { defineTool } from "../types";
import { abs, berlinDateTime, json, likeOf, round2 } from "./common";
import { FEHLT_OHNE } from "@/lib/integrations/fehlt";

// Lese-Werkzeuge für Auswertungen, die es im Seller-System schon gibt: Hebel, Bestellvorschläge, SAS/Black Week,
// FBA-Sendungen, Remissionen, Stand der Anbindungen, eine Mail vollständig. Nur lesen.

const HEBEL_TYPES = Object.keys(HEBEL_INFO) as HebelType[];

export const hebel = defineTool({
  name: "hebel",
  title: "Hebel (Umsatz & Marge)",
  description:
    "Die vollständigen Hebel-Listen der letzten 30 Tage mit Wirkung je Monat: Verlustbringer, Marge zu niedrig, viele Erstattungen, schwache Kaufquote, Preis-Spielraum, Ladenhüter (gebundenes Kapital), Nachbestellen, EK fehlt – je Produkt mit Herleitung und Maßnahme. Für „Wo verliere ich Geld?“, „Welche Ladenhüter?“, „Wo kann ich den Preis erhöhen?“.",
  area: "geld",
  write: false,
  quelle: { text: "sellerboard (Produkte 30 Tage, FBA-Bestand), EK aus dem Seller-System, Buy Box laut Keepa", jobs: ["sellerboard:*"] },
  input: z.object({
    typ: z.enum(["alle", ...HEBEL_TYPES] as [string, ...string[]]).default("alle").describe("Nur eine Hebel-Art"),
    kanal: z.enum(["alle", "amazon", "ebay"]).default("alle"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  run: async (ctx, i) => {
    const d = await loadHebel(ctx.session.tenantId);
    const list = d.list.filter((h) => (i.typ === "alle" || h.type === i.typ) && (i.kanal === "alle" || h.channel === i.kanal)).sort((a, b) => b.impact + b.capital / 12 - (a.impact + a.capital / 12));
    return json({
      zeitraum: { von: d.statsFrom, bis: d.statsTo },
      zusammenfassung: d.summary.map((s) => ({ typ: s.type, art: HEBEL_INFO[s.type].label, anzahl: s.count, wirkung_monat: round2(s.impact), deckungsbeitrag_monat: round2(s.contribution), ersparnis_monat: round2(s.saving), gebundenes_kapital: round2(s.capital) })),
      summe: { wirkung_monat: round2(d.totals.impact), gebundenes_kapital: round2(d.totals.capital) },
      anzahl: list.length,
      hebel: list.slice(0, i.limit).map((h) => ({
        typ: h.type,
        art: HEBEL_INFO[h.type].label,
        kanal: h.channel,
        sku: h.sku,
        asin: h.asin ?? undefined,
        name: h.name ?? undefined,
        wirkung_monat: round2(h.impact),
        gebundenes_kapital: h.capital ? round2(h.capital) : undefined,
        befund: h.headline,
        massnahme: h.action,
        herleitung: h.basis,
        fakten: h.facts.length ? h.facts : undefined,
      })),
      hinweis: list.length > i.limit ? `Nur die ${i.limit} wirksamsten – mit „typ“ oder „limit“ mehr.` : undefined,
      annahmen: { lagerkosten_je_stueck_monat: d.assumptions.storagePerUnitMonth, kapitalzins_jahr: d.assumptions.capitalRatePa },
      ausgeblendet: d.dismissed || undefined,
      letzter_fehler: d.statsError ?? undefined,
      link: abs(ctx, i.typ === "alle" ? "/hebel" : `/hebel?typ=${i.typ}`),
    });
  },
});

export const bestellvorschlaege = defineTool({
  name: "bestellvorschlaege",
  title: "Bestellvorschläge",
  description:
    "Was nachbestellt werden sollte (laut sellerboard, mit gültigem EK aus dem Seller-System): je Produkt Menge, Dringlichkeit (überfällig/jetzt/bald), bestellen bis, Reichweite, Kapitalbedarf netto, Marge, Bezugsquelle und Prüfhinweise (EK fehlt, EK weicht ab, Retoure, Quelle unklar). Mit Summe Kapitalbedarf. Für „Was muss ich bestellen?“, „Wie viel Geld brauche ich für den Einkauf?“.",
  area: "wawi",
  write: false,
  quelle: { text: "sellerboard (FBA-Bestand, Nachbestell-Empfehlung), EK, Chargen und Lieferanten-Angebote im Seller-System", jobs: ["sellerboard:*"] },
  input: z.object({
    dringlichkeit: z.enum(["alle", "ueberfaellig", "jetzt", "bald"]).default("alle"),
    pruefen: z.enum(["alle", "regulaer", "ek_fehlt", "ek_abweichung", "retoure", "quelle"]).default("alle").describe("„regulaer“ = ohne offene Fragen nachbestellbar"),
    suche: z.string().trim().max(80).optional().describe("SKU, ASIN oder Name"),
    sortierung: z.enum(["dring", "kapital", "marge"]).default("dring"),
    limit: z.number().int().min(1).max(200).default(100),
    rote_zeigen: z.boolean().default(false).describe("Auch Artikel mit roter Kapital-Ampel (Standard: ausgeblendet – nicht nachbestellen)"),
  }),
  run: async (ctx, i) => {
    // B15.5: gleiche Rechnung wie Startseite, Bestellvorschläge und Liquidität.
    const k = await bestellvorschlaegeGemeinsam(ctx.session.tenantId, ctx.today, { rotZeigen: i.rote_zeigen });
    const { syncedAt, ampel } = k;
    const rote = k.roteGesamt;
    const list = filterReorder(k.rows, { q: i.suche, dring: i.dringlichkeit as Urgency | "alle", pruefen: i.pruefen as ReorderCheck | "alle" | "regulaer", sort: i.sortierung });
    const t = reorderTotals(list);
    return json({
      stand_sellerboard: berlinDateTime(syncedAt) ?? "noch kein Abgleich",
      summe: { produkte: list.length, kapitalbedarf_netto: t.capital, schon_im_einkauf_angelegt: k.angelegt || undefined, mit_ek: t.withCapital, ohne_ek: t.noEk, retouren: t.returns, quelle_unklar: t.noSource, je_dringlichkeit: t.byUrgency },
      vorschlaege: list.slice(0, i.limit).map((r) => ({
        sku: r.sku,
        asin: r.asin ?? undefined,
        name: r.name ?? undefined,
        menge: r.qtyToReorder,
        dringlichkeit: URGENCY_LABEL[r.urgency],
        bestellen_bis: r.orderBy ?? undefined,
        reichweite_tage: r.daysLeft ?? undefined,
        fba_bestand: r.fbaStock,
        unterwegs: r.inbound || undefined,
        verkauf_pro_tag: r.salesVelocity ?? undefined,
        ek_netto: r.ek ? round2(r.ek.cost) : null,
        kapital_netto: r.capital,
        marge_prozent_30_tage: r.margin,
        bezugsquelle: r.source ?? undefined,
        pruefen: r.checks.length ? r.checks.map((c) => CHECK_LABEL[c].label) : undefined,
        retoure_von: r.isReturn ? (r.origin ?? "unbekannt") : undefined,
        kapital_ampel: ampel.get(r.sku),
        link: abs(ctx, `/einkauf/vorschlaege?q=${encodeURIComponent(r.sku)}`),
      })),
      hinweis: list.length > i.limit ? `Nur die ersten ${i.limit} von ${list.length}.` : undefined,
      rote_kapital_ampel_ausgeblendet: !i.rote_zeigen && rote ? rote : undefined,
      definition: KAPITALBEDARF_DEFINITION,
      legende: { kapital_netto: "gültiger EK × Menge; null = EK fehlt oder Retoure", ek_netto: "null = kein gültiger EK", kapital_ampel: "rot = Geld liegt mit zu wenig Rendite / Preis unter Break-even – nicht nachbestellen (Werkzeug kapital_ampel)" },
      link: abs(ctx, "/einkauf/vorschlaege"),
    });
  },
});

export const sas = defineTool({
  name: "sas",
  title: "SAS-Programm & Black Week",
  description:
    "Amazon-SAS-Programm: Consultant, PSTAM, nächster Termin, Deal-Frist; offene und überfällige Schritte (Fahrplan); Marken für den Audit (autorisierter Händler) mit Status; Black-Week-Deals: berechtigte ASINs mit Mindestrabatt, Deal-Preis, Gewinn je Stück nach Rabatt und Urteil (lohnt/knapp/Verlust/unklar). Für „Welche Deals lohnen sich?“, „Was ist beim SAS fällig?“.",
  area: "amazon",
  write: false,
  quelle: { text: "SAS-Bereich im Seller-System, Preise und Gebühren laut sellerboard, EK aus dem Seller-System", jobs: ["sellerboard:*"] },
  input: z.object({
    teil: z.enum(["alles", "fahrplan", "marken", "deals"]).default("alles"),
    nur_lohnend: z.boolean().default(false).describe("Bei Deals nur „lohnt“ und „knapp“"),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const want = (k: string) => i.teil === "alles" || i.teil === k;
    const [p, items, brands, deals] = await Promise.all([getProgram(t), want("fahrplan") ? loadItems(t) : [], want("marken") ? loadBrands(t) : [], want("deals") ? loadDeals(t) : []]);
    const open = items.filter((x) => x.status !== "done");
    const dl = deals.filter((d) => !i.nur_lohnend || d.calc.verdict === "lohnt" || d.calc.verdict === "knapp");
    const urteil = (v: string) => deals.filter((d) => d.calc.verdict === v).length;
    return json({
      programm: {
        consultant: p.consultantName ?? undefined,
        pstam: p.pstamName ?? undefined,
        naechster_termin: p.nextMeeting ?? undefined,
        deal_frist: p.dealDeadline ?? undefined,
        tage_bis_deal_frist: daysUntil(ctx.today, p.dealDeadline) ?? undefined,
        audit_status: p.pilotStatus,
        notizen: p.notes?.slice(0, 1500) || undefined,
      },
      fahrplan: want("fahrplan")
        ? open
            .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
            .map((x) => ({ schritt: x.title, bereich: MODULE_LABEL[x.module], wer: WAITING_LABEL[x.waitingOn], faellig: x.dueDate ?? undefined, ueberfaellig: x.dueDate && x.dueDate < ctx.today ? true : undefined, prioritaet: x.priority, notiz: x.notes?.slice(0, 400) || undefined }))
        : undefined,
      marken: want("marken") ? brands.filter((b) => b.selected || b.status !== "offen").map((b) => ({ marke: b.brand, ausgewaehlt: b.selected, status: b.status, umsatz_30_tage: b.sales30 === null ? null : Number(b.sales30), belege: b.invoices ?? undefined, notiz: b.note ?? undefined })) : undefined,
      deals: want("deals")
        ? {
            anzahl: deals.length,
            je_urteil: { lohnt: urteil("lohnt"), knapp: urteil("knapp"), verlust: urteil("verlust"), unklar: urteil("unklar") },
            liste: dl.map((d) => ({
              asin: d.asin,
              titel: d.name ?? d.title ?? undefined,
              sku: d.sku ?? undefined,
              preis: d.price,
              mindestrabatt_prozent: d.minDiscountPct === null ? null : Number(d.minDiscountPct),
              deal_preis: d.calc.dealPrice,
              gewinn_je_stueck_mit_rabatt: d.calc.profit,
              gewinn_je_stueck_jetzt: d.calc.profitNow,
              marge_prozent: d.calc.margin,
              urteil: d.calc.verdict,
              begruendung: d.calc.reason,
              status: d.status,
              fba_bestand: d.stock ?? undefined,
              reichweite_tage: d.daysLeft ?? undefined,
              verkauft_30_tage: d.units30 ?? undefined,
            })),
          }
        : undefined,
      link: abs(ctx, i.teil === "deals" ? "/sas?tab=blackweek" : i.teil === "marken" ? "/sas?tab=marken" : i.teil === "fahrplan" ? "/sas?tab=aufgaben" : "/sas"),
    });
  },
});

const FBA_OFFEN = ["WORKING", "READY_TO_SHIP", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CHECKED_IN", "RECEIVING"];

export const fbaSendungen = defineTool({
  name: "fba_sendungen",
  title: "FBA-Sendungen",
  description:
    "Sendungen an Amazon-Lager (FBA) mit Status (in Arbeit, unterwegs, zugestellt, wird eingebucht, abgeschlossen), verschickter und von Amazon eingebuchter Menge und Fehlmengen je SKU. Für „Wo ist meine Sendung?“, „Hat Amazon alles eingebucht?“, „Wo fehlt Ware?“.",
  area: "amazon",
  write: false,
  quelle: { text: "FBA-Sendungen laut sellerboard (aus Seller Central)", jobs: ["sellerboard:*"] },
  input: z.object({
    ansicht: z.enum(["offen", "mit_fehlmenge", "alle"]).default("offen").describe("offen = noch nicht abgeschlossen"),
    suche: z.string().trim().max(60).optional().describe("Sendungsname, Amazon-ID oder SKU"),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  run: async (ctx, i) => {
    const S = schema.sellerboardShipments;
    const rows = await db
      .select()
      .from(S)
      .where(and(eq(S.tenantId, ctx.session.tenantId), i.ansicht === "offen" ? inArray(S.status, FBA_OFFEN) : undefined, i.suche ? or(ilike(S.name, likeOf(i.suche)), ilike(S.amazonId, likeOf(i.suche)), sql`${S.lines}::text ilike ${likeOf(i.suche)}`) : undefined))
      .orderBy(desc(S.lastUpdate))
      .limit(300);
    const out = rows
      .map((s) => {
        const units = s.lines.reduce((n, l) => n + l.units, 0);
        const received = s.lines.reduce((n, l) => n + l.received, 0);
        const fehl = s.lines.filter((l) => l.received < l.units).map((l) => ({ sku: l.sku, asin: l.asin ?? undefined, name: l.name ?? undefined, verschickt: l.units, eingebucht: l.received, fehlt: l.units - l.received }));
        return { name: s.name ?? undefined, amazon_id: s.amazonId ?? undefined, status: s.status, erstellt: s.createdOn ?? undefined, letzte_aenderung: s.lastUpdate ?? undefined, verschickt: units, eingebucht: received, fehlmenge: units - received > 0 ? units - received : undefined, fehlende_positionen: fehl.length && s.status !== "WORKING" ? fehl.slice(0, 20) : undefined };
      })
      .filter((s) => i.ansicht !== "mit_fehlmenge" || (s.fehlmenge && ["CLOSED", "RECEIVING", "CHECKED_IN", "DELIVERED"].includes(s.status)));
    return json({
      anzahl: out.length,
      sendungen: out.slice(0, i.limit),
      legende: { status: "WORKING in Arbeit · SHIPPED/IN_TRANSIT unterwegs · DELIVERED zugestellt · CHECKED_IN/RECEIVING wird eingebucht · CLOSED abgeschlossen", fehlmenge: "verschickt minus eingebucht – bei abgeschlossenen Sendungen ein möglicher Anspruch" },
      link: abs(ctx, "/ansprueche"),
    });
  },
});

export const remissionen = defineTool({
  name: "remissionen",
  title: "Remissionen",
  description:
    "Rücksendungen aus dem Amazon-Lager zu dir (Remissionen): offene Aufträge (verschickt, aber noch nicht als angekommen bestätigt) mit Sendungsnummern, Pakete bei Problem-Versendern bzw. als verloren markiert mit Frist für den Anspruch, und unverkäuflicher FBA-Bestand, der remittiert werden sollte. Für „Was ist unterwegs zurück?“, „Welche Remission ist verloren?“.",
  area: "amazon",
  write: false,
  quelle: { text: "Amazon-Berichte Remissionsaufträge und -sendungen, FBA-Bestand", jobs: ["Amazon-Reports abholen"], importe: true },
  input: z.object({ ansicht: z.enum(["offen", "alle"]).default("offen"), suche: z.string().trim().max(60).optional().describe("Auftrag, SKU, FNSKU oder Sendungsnummer"), limit: z.number().int().min(1).max(100).default(40) }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const R = schema.amazonRemovalOrders;
    const [settings, all, shipments, marks] = await Promise.all([
      getSettings(t),
      db.select().from(R).where(eq(R.tenantId, t)).orderBy(desc(R.requestDate)),
      db.select().from(schema.amazonRemovalShipments).where(eq(schema.amazonRemovalShipments.tenantId, t)),
      db.select().from(schema.amazonRemovalShipmentMarks).where(eq(schema.amazonRemovalShipmentMarks.tenantId, t)),
    ]);
    const q = i.suche?.toLowerCase();
    const tracking = new Map<string, string[]>();
    for (const s of shipments) if (s.trackingNumber) tracking.set(s.orderId, [...new Set([...(tracking.get(s.orderId) ?? []), `${s.carrier ?? ""} ${s.trackingNumber}`.trim()])]);
    const offen = (o: (typeof all)[number]) => o.shippedQuantity > 0 && o.receivedQuantity === null && !(o.orderType ?? "").toLowerCase().includes("dispos");
    const orders = all.filter((o) => (i.ansicht === "alle" || offen(o)) && (!q || [o.orderId, o.sku, o.fnsku, ...(tracking.get(o.orderId) ?? [])].some((v) => (v ?? "").toLowerCase().includes(q))));
    const parcels = removalParcels({ removals: all, removalShipments: shipments.map((s) => ({ ...s, quantity: s.shippedQuantity })), removalShipmentMarks: marks }, carrierList(settings.claims.problemCarriers), settings.claims.windowDays.removal_shipment_stuck)
      .filter((p) => !p.confirmed && p.mark !== "received" && (p.problemCarrier || p.mark === "lost"))
      .sort((a, b) => (a.claimUntil ?? "").localeCompare(b.claimUntil ?? ""));
    const I = schema.amazonInventory;
    const unsellable = await db.select({ sku: I.sku, fnsku: I.fnsku, title: I.title, n: I.unsellable, since: I.unsellableSince }).from(I).where(and(eq(I.tenantId, t), gt(I.unsellable, 0))).orderBy(I.unsellableSince);
    return json({
      auftraege: {
        anzahl: orders.length,
        liste: orders.slice(0, i.limit).map((o) => ({ auftrag: o.orderId, angefordert_am: o.requestDate, art: o.orderType ?? undefined, status: o.orderStatus ?? undefined, sku: o.sku, fnsku: o.fnsku ?? undefined, angefordert: o.requestedQuantity, versendet: o.shippedQuantity, in_bearbeitung: o.inProcessQuantity || undefined, entsorgt: o.disposedQuantity || undefined, storniert: o.cancelledQuantity || undefined, angekommen: o.receivedQuantity ?? "noch nicht bestätigt", gebuehr: round2(o.removalFee) ?? undefined, sendungen: tracking.get(o.orderId) })),
      },
      problem_pakete: parcels.slice(0, 30).map((p) => ({ auftrag: p.orderId, versender: p.carrier ?? undefined, sendungsnummer: p.trackingNumber, menge: p.quantity, inhalt: p.lines.map((l) => `${l.fnsku ?? l.sku} × ${l.quantity}`).join(", "), letzter_status: p.lastEvent ?? undefined, als_verloren_markiert: p.mark === "lost" || undefined, anspruch_ab: p.claimFrom ?? undefined, anspruch_bis: p.claimUntil ?? undefined })),
      unverkaeuflich_im_lager: unsellable.slice(0, 30).map((u) => ({ sku: u.sku, fnsku: u.fnsku ?? undefined, titel: u.title ?? undefined, menge: u.n, seit: u.since ?? undefined })),
      link: abs(ctx, i.ansicht === "alle" ? "/remissionen?ansicht=alle" : "/remissionen"),
    });
  },
});

/** Abrufe, die nur beim Einrichten laufen – ihr Datum sagt nichts über den Datenstand. */
const EINMALIGE_ABRUFE = new Set(["sellerboard: Konto"]);

/** Hinweise zu bekannten Fehlermeldungen einzelner Abrufe. */
const ABRUF_HINWEIS: Record<string, string> = {
  "eBay: neue Schnittstelle":
    "Kein Ausfall: eBay läuft über die bisherige Trading-Schnittstelle weiter. Zum Freischalten der neuen Schnittstelle: auf developer.ebay.com unter Application Keys → OAuth Scopes „sell.listing“ freigeben lassen, dann unter eBay → eBay-Einstellungen → Verbindung mit Häkchen „Neue eBay-Listing-Schnittstelle“ neu verbinden.",
};

export const anbindungenStatus = defineTool({
  name: "anbindungen_status",
  title: "Stand der Anbindungen",
  description:
    "Ob die Daten aktuell sind: je Anbindung (Amazon, eBay, sellerboard, Keepa …) ob eingerichtet, je Hintergrund-Abruf der letzte Erfolg und ein aktueller Fehler, die Postfächer (Art, Ordner, letzter Abruf, Fehlerart, letzte Amazon-Mail, Warnung „7 Tage keine Mail von *@amazon.*“) und die letzten Datei-Importe. Für „Warum ist das nicht aktuell?“, „Kommen die Seller-Central-Mails an?“.",
  area: null,
  ownerOnly: true,
  write: false,
  quelle: { text: "Anbindungen, Abrufe und Importe im Seller-System" },
  input: z.object({ nur_probleme: z.boolean().default(false).describe("Nur Abrufe mit Fehler oder seit über 2 Tagen ohne Erfolg") }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const J = schema.jobRuns;
    const RI = schema.reportImports;
    const { postfachStand } = await import("@/lib/mail/status");
    const [st, jobs, imports, pf] = await Promise.all([
      integrationStatus(t),
      db.select().from(J).where(eq(J.tenantId, t)),
      db
        .select({ typ: RI.reportType, via: RI.via, am: sql<Date>`max(${RI.createdAt})`, n: sql<number>`count(*)::int` })
        .from(RI)
        .where(and(eq(RI.tenantId, t), gt(RI.createdAt, new Date(Date.now() - 90 * 86_400_000))))
        .groupBy(RI.reportType, RI.via),
      postfachStand(t),
    ]);
    const now = Date.now();
    const abrufe = jobs
      .map((j) => {
        const fehlerAktuell = Boolean(j.lastErrorAt && (!j.lastOkAt || j.lastErrorAt > j.lastOkAt));
        // Einmalige Schritte (z. B. sellerboard-Konto erkennen) laufen nur beim Einrichten – nie „veraltet“.
        const einmalig = EINMALIGE_ABRUFE.has(j.name);
        const alt = !einmalig && (!j.lastOkAt || now - j.lastOkAt.getTime() > 2 * 86_400_000);
        return {
          abruf: j.name,
          letzter_erfolg: berlinDateTime(j.lastOkAt) ?? "nie",
          einmalig: einmalig ? "nur beim Einrichten nötig – kein Hinweis auf alte Daten" : undefined,
          fehler: fehlerAktuell ? (j.lastError ?? "Fehler").slice(0, 300) : undefined,
          fehler_seit: fehlerAktuell ? (berlinDateTime(j.lastErrorAt) ?? undefined) : undefined,
          hinweis: fehlerAktuell ? ABRUF_HINWEIS[j.name] : undefined,
          ueber_2_tage_alt: alt || undefined,
        };
      })
      .filter((j) => !i.nur_probleme || j.fehler || j.ueber_2_tage_alt)
      .sort((a, b) => Number(Boolean(b.fehler)) - Number(Boolean(a.fehler)) || a.abruf.localeCompare(b.abruf));
    // sellerboard insgesamt: neuester Erfolg über alle laufenden Schritte (ohne die einmaligen).
    const sb = jobs.filter((j) => j.name.startsWith("sellerboard:") && !EINMALIGE_ABRUFE.has(j.name) && j.lastOkAt).map((j) => j.lastOkAt!.getTime());
    return json({
      anbindungen: INTEGRATIONS.map((d) => {
        const s = st.get(d.provider);
        const eingerichtet = Boolean(s && (s.secretKeys.length || Object.keys(s.config).length));
        // Google/Microsoft-App nur für die optionale OAuth-Anmeldung von Postfächern – Standard ist IMAP mit App-Passwort.
        const optional = d.provider === "google" || d.provider === "microsoft";
        return { anbindung: d.name, eingerichtet, optional: optional && !eingerichtet ? "nur für Postfach-Anmeldung per OAuth nötig – Postfächer laufen über IMAP mit App-Passwort" : undefined, geaendert: s ? berlinDateTime(s.updatedAt) : undefined, ohne_fehlt: !eingerichtet ? FEHLT_OHNE[d.provider] : undefined };
      }).filter((a) => !i.nur_probleme || (!a.eingerichtet && !a.optional)),
      postfaecher: pf.postfaecher
        .map((b) => ({
          adresse: b.adresse,
          art: b.art,
          aktiv: b.aktiv,
          nur_abruf: b.nurAbruf || undefined,
          ordner: b.imap ? (b.ordner ?? "automatisch (Gmail: Alle Nachrichten, sonst Posteingang + Archiv)") : undefined,
          letzter_abruf: berlinDateTime(b.letzterAbruf) ?? "nie",
          fehler: b.fehler ?? undefined,
          fehlerart: b.fehlerArt ?? undefined,
          letzte_amazon_mail: berlinDateTime(b.letzteAmazonMail) ?? "keine",
        }))
        .filter((b) => !i.nur_probleme || b.fehler || !b.aktiv),
      amazon_mail_warnung: pf.warnung ?? undefined,
      sellerboard_daten_stand: sb.length ? berlinDateTime(new Date(Math.max(...sb))) : "noch kein Abgleich",
      abrufe,
      importe_90_tage: imports.map((r) => ({ bericht: r.typ, weg: r.via === "api" ? "Schnittstelle" : "Datei-Upload", zuletzt: berlinDateTime(new Date(r.am)), anzahl: r.n })).sort((a, b) => a.bericht.localeCompare(b.bericht)),
      probleme: abrufe.filter((j) => j.fehler).length + pf.postfaecher.filter((b) => b.fehler).length + (pf.warnung ? 1 : 0),
      link: abs(ctx, "/anbindungen"),
    });
  },
});

export const mail = defineTool({
  name: "mail",
  title: "Mail lesen",
  description: "Eine Mail aus dem Posteingang vollständig (Absender, Empfangszeit, Betreff, ganzer Text, erkannte Bezüge wie Bestellnummer) und ob es schon einen Antwort-Entwurf gibt. Die id kommt aus „posteingang“. Für Antworten und Rückfragen zu einer Mail.",
  area: "posteingang",
  write: false,
  quelle: { text: "Verbundene Postfächer", jobs: ["Postfächer"] },
  input: z.object({ id: z.string().regex(/^[0-9a-f-]{36}$/i, "Kennung (UUID) aus „posteingang“") }),
  run: async (ctx, i) => {
    const M = schema.emails;
    const [m] = await db.select().from(M).where(and(eq(M.tenantId, ctx.session.tenantId), eq(M.id, i.id)));
    if (!m) return { text: "Mail nicht gefunden.", isError: true };
    const D = schema.emailDrafts;
    const drafts = await db.select().from(D).where(and(eq(D.tenantId, ctx.session.tenantId), eq(D.emailId, m.id))).orderBy(desc(D.createdAt));
    return json({
      id: m.id,
      von: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress,
      an: m.an ?? undefined,
      ordner: m.ordner ?? undefined,
      betreff: m.subject,
      eingegangen: berlinDateTime(m.receivedAt),
      einstufung: m.category,
      thema: m.topic,
      archiviert: m.archived,
      bezuege: Object.keys(m.references).length ? m.references : undefined,
      text: (m.bodyText ?? m.snippet ?? "").slice(0, 12_000),
      entwuerfe: drafts.map((d) => ({ an: d.to, betreff: d.subject, angelegt: berlinDateTime(d.createdAt), gesendet: d.sentAt ? berlinDateTime(d.sentAt) : undefined })),
      link: abs(ctx, `/posteingang/${m.id}`),
    });
  },
});

export const repricer = defineTool({
  name: "repricer",
  title: "Repricer (BQool)",
  description:
    "BQool-Einstellungen je SKU und Land aus dem zuletzt hochgeladenen Export „Manage Listings“: Regel/Strategie, Status, aktueller Preis, Mindest- und Höchstpreis, Buy Box (Preis, wer sie hat), Angebote, Bestand – abgeglichen mit dem Mindestpreis des Seller-Systems (EK + Gebühren + Mindestgewinn). Standard: nur Auffälligkeiten (Min zu niedrig, pausiert, Buy Box verloren …). Für „Stimmen meine BQool-Mindestpreise?“, „Wo habe ich die Buy Box verloren?“.",
  area: ["buchhaltung", "amazon"],
  write: false,
  quelle: { text: "BQool-Export (hochgeladen unter Repricer), EK und Gebühren im Seller-System" },
  input: z.object({
    ansicht: z.enum(["probleme", "alle"]).default("probleme"),
    marktplatz: z.enum(["alle", ...BQOOL_MAERKTE]).default("alle"),
    hinweis: z.enum(["alle", ...HINWEIS_RANG]).default("alle").describe("Nur eine Art von Auffälligkeit"),
    regel: z.string().trim().max(60).optional().describe("Nur diese BQool-Regel/Strategie (z. B. „ia“, „Liquidation“; „(ohne Regel)“ für SKUs ohne Regel)"),
    suche: z.string().trim().max(60).optional().describe("SKU, ASIN oder Titel"),
    limit: z.number().int().min(1).max(300).default(80),
  }),
  run: async (ctx, i) => {
    const { zeilen, stand } = await bqoolStand(ctx.session.tenantId);
    const q = i.suche?.toLowerCase();
    const list = zeilen
      .filter((z) => (i.marktplatz === "alle" || z.marktplatz === i.marktplatz) && (i.ansicht === "alle" || z.hinweise.length) && (i.hinweis === "alle" || z.hinweise.includes(i.hinweis as (typeof HINWEIS_RANG)[number])) && (!i.regel || (z.regel?.trim() || "(ohne Regel)").toLowerCase() === i.regel.toLowerCase()) && (!q || [z.sku, z.asin ?? "", z.titel ?? ""].some((x) => x.toLowerCase().includes(q))))
      .sort((a, b) => (a.hinweise[0] ? HINWEIS_RANG.indexOf(a.hinweise[0]) : 99) - (b.hinweise[0] ? HINWEIS_RANG.indexOf(b.hinweise[0]) : 99) || a.sku.localeCompare(b.sku));
    const zaehle = Object.fromEntries(HINWEIS_RANG.map((h) => [h, zeilen.filter((z) => z.hinweise.includes(h)).length]).filter(([, n]) => n));
    const aeltester = stand.reduce<Date | null>((m, x) => (x.am && (!m || x.am < m) ? x.am : m), null);
    return json({
      eingelesen: stand.length ? stand.map((x) => ({ marktplatz: x.marktplatz, am: berlinDateTime(x.am) })) : "noch kein BQool-Export hochgeladen – in BQool unter Repricing → Manage Listings je Land exportieren und im Seller-System unter Amazon → Repricer (BQool) hochladen",
      anzahl_skus: zeilen.length,
      auffaelligkeiten: zaehle,
      je_regel: regelUebersicht(zeilen).map((u) => ({ regel: u.regel, skus: u.gesamt, aktiv: u.aktiv, pausiert: u.pausiert, status_unbekannt: u.unbekannt || undefined, auffaellig: u.mitHinweis, je_land: u.laender })),
      anzahl: list.length,
      zeilen: list.slice(0, i.limit).map((z) => ({
        marktplatz: z.marktplatz,
        sku: z.sku,
        asin: z.asin ?? undefined,
        titel: z.titel ?? undefined,
        versand: z.versand ?? undefined,
        regel: z.regel,
        status: z.status,
        preis: z.preis,
        min_bqool: z.min,
        max_bqool: z.max,
        min_seller_system: z.untergrenze,
        ek_netto: z.ek,
        buybox_preis: z.buyboxPreis,
        buybox_bei: z.eigeneBuybox === true ? "uns" : z.buyboxGewinner ?? (z.eigeneBuybox === false ? "jemand anderem" : null),
        niedrigster_preis: z.niedrigsterPreis ?? undefined,
        angebote: z.angebote ?? undefined,
        bestand: z.bestand ?? undefined,
        pruefen: z.hinweise.length ? z.hinweise.map((h) => HINWEIS_TEXT[h]) : undefined,
        effektiver_min: z.effMin ?? undefined,
        marge_stufe_prozent: z.marge ?? undefined,
        unterregel: z.unterregel ?? undefined,
        buybox_erklaerung: z.erklaerung ?? undefined,
      })),
      hinweis: list.length > i.limit ? `Nur die ersten ${i.limit} von ${list.length}.` : undefined,
      legende: { min_seller_system: "Mindestpreis aus EK + FBA-Gebühr + Provision + Mindestgewinn (mit DE-Gebühren; für andere Länder Richtwert); null = EK oder Bestand unbekannt", effektiver_min: "Preis, bei dem die Mindestmarge der BQool-Regel in der Altersstufe erreicht ist (Regel-Katalog, USt des Landes); Liquidation = feste Untergrenze", buybox_erklaerung: "Equalizer: steht bewusst 1 Cent über der Buy Box, wenn diese unter dem effektiven Min liegt", null: "nicht im Export bzw. unbekannt" },
      upload_datei: abs(ctx, "/repricer/export?format=bqool"),
      link: abs(ctx, "/repricer"),
      datenstand: { quelle: "BQool-Export (hochgeladen) + Seller-System", stand: aeltester ? `BQool-Export eingelesen ${berlinDateTime(aeltester)}${stand.length > 1 ? " (ältester Marktplatz)" : ""}` : "noch kein BQool-Export", abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const GESCHAEFT = [hebel, bestellvorschlaege, sas, fbaSendungen, remissionen, anbindungenStatus, mail, repricer];
