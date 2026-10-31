import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { ustPerioden } from "@/lib/buchhaltung/service";
import { landName, ossQuartal, umsatzJeSteuerland } from "@/lib/buchhaltung/ust-bericht";

// Umsatzsteuer aus dem Amazon-Umsatzsteuer-Transaktionsbericht – Ergebnis-Block je Periode und OSS je Quartal.
// Nur Zahlen und Hinweise, keine Steuerberatung.

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ergebnis-Block einer Periode (YYYY-MM): Marktplätze, Zeilen je Typ, Umsatz je Steuerland, OSS/REGULAR, Verbringungen, INVOICE/CREDIT_NOTE, Abweichung zu sellerboard. */
export async function umsatzsteuerBlock(tenantId: string, monat: string) {
  const [p] = await ustPerioden(tenantId, null, [monat]);
  if (!p) return { periode: monat, vorhanden: false, hinweis: "Für diese Periode ist kein Umsatzsteuer-Transaktionsbericht importiert (Seller Central → Berichte → Steuerdokumente)." };
  const a = p.daten;
  const laender = umsatzJeSteuerland(a);
  const brutto = r2(laender.reduce((n, l) => n + l.brutto, 0));
  const [sb] = await db.select({ sales: schema.sellerboardMonths.sales }).from(schema.sellerboardMonths).where(and(eq(schema.sellerboardMonths.tenantId, tenantId), eq(schema.sellerboardMonths.month, monat)));
  const sbUmsatz = sb?.sales !== null && sb?.sales !== undefined ? Number(sb.sales) : null;
  const verfahren = a.jeVerfahren ?? {};
  const summeVerfahren = Object.values(verfahren).reduce((n, x) => n + x, 0);
  return {
    periode: monat,
    vorhanden: true,
    stand: p.stand.toISOString(),
    dateien: p.dateien,
    marktplaetze: a.marktplaetze ?? [],
    zeilen_je_typ: a.jeTyp ?? {},
    umsatz_je_steuerland: laender.map((l) => ({ land: l.land, land_name: landName(l.land), netto: l.netto, ust: l.ust, brutto: l.brutto, davon_oss_netto: l.oss, davon_lokal_netto: l.lokal })),
    umsatz_brutto_gesamt: brutto,
    meldeschema: Object.fromEntries(Object.entries(verfahren).map(([k, v]) => [k, { zeilen: v, anteil_prozent: summeVerfahren ? Math.round((v / summeVerfahren) * 1000) / 10 : 0 }])),
    verbringungen: a.transfers.map((t) => ({ von: t.von, nach: t.nach, stueck: t.stueck ?? t.anzahl, zeilen: t.anzahl, netto: t.netto })),
    invoice_credit_note_ohne_steuerland: (a.ohneSteuerland ?? []).map((x) => ({ ...x, hinweis: "Ohne Steuerland – nicht im Umsatz, bitte prüfen (z. B. B2B-Rechnungen über VCS)." })),
    abweichung_sellerboard: sbUmsatz === null ? { hinweis: "Kein sellerboard-Monatswert für diese Periode." } : { sellerboard_umsatz: r2(sbUmsatz), bericht_brutto: brutto, differenz: r2(brutto - sbUmsatz) },
    hinweise: a.hinweise,
    zeitraum: a.zeitraum,
  };
}

/** OSS je Quartal („2026-Q3“): Land, Steuersatz, Netto, USt – aus den drei Monaten. */
export async function umsatzsteuerOss(tenantId: string, quartal: string) {
  const m = /^(\d{4})-Q([1-4])$/i.exec(quartal.trim());
  if (!m) return { fehler: "Quartal im Format JJJJ-Q1 … JJJJ-Q4 angeben." };
  const q = Number(m[2]);
  const monate = [1, 2, 3].map((i) => `${m[1]}-${String((q - 1) * 3 + i).padStart(2, "0")}`);
  const rows = await ustPerioden(tenantId, null, monate);
  const zeilen = ossQuartal(rows.map((r) => r.daten));
  return {
    quartal: `${m[1]}-Q${q}`,
    monate: monate.map((mo) => ({ monat: mo, vorhanden: rows.some((r) => r.monat === mo) })),
    zeilen: zeilen.map((z) => ({ land: z.land, land_name: landName(z.land), satz_prozent: z.satz !== null ? r2(z.satz * 100) : null, netto: z.netto, ust: z.ust, vorgaenge: z.anzahl })),
    summe: { netto: r2(zeilen.reduce((n, z) => n + z.netto, 0)), ust: r2(zeilen.reduce((n, z) => n + z.ust, 0)) },
    hinweis: rows.length < 3 ? "Nicht alle Monate des Quartals importiert – Summe unvollständig." : "OSS-Meldung beim BZSt – Zahlen bitte mit dem Steuerberater abstimmen (keine Steuerberatung durch das System).",
  };
}

export async function ustMonateVorhanden(tenantId: string, monate: string[]) {
  if (!monate.length) return [];
  return (await db.select({ monat: schema.ustAuswertungen.monat }).from(schema.ustAuswertungen).where(and(eq(schema.ustAuswertungen.tenantId, tenantId), inArray(schema.ustAuswertungen.monat, monate)))).map((r) => r.monat);
}
