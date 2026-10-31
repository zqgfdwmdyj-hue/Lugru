import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, ilike } from "drizzle-orm";
import { after } from "next/server";
import { db, schema } from "@/db";
import { canAccess } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";
import { importMeldung } from "@/lib/bank/service";
import { importBqool } from "@/lib/bqool/service";
import { amexImportieren, sparkasseImportieren, ustBerichtImportieren } from "@/lib/buchhaltung/service";
import { todayIso } from "@/lib/dates";
import { importAnyFile } from "@/lib/imports/dispatch";
import { readTable } from "@/lib/tabular";
import { leseZip } from "@/lib/zip-lesen";
import { lesbarerFehler } from "@/lib/fehler-text";
import { artNachEndung, endung, istBqoolDatei, istPdf, istZip, jsonArt, pdfArt, tabellenArt, UPLOAD_ART, type UploadArt } from "./erkennen";

// Zentrale Uploads: jede Datei erkennen und mit demselben Code verarbeiten wie im jeweiligen Bereich. Rechte je
// Art (z. B. Kontoauszüge nur mit Bereich „Geld“). Private Kontoauszüge gehören in den Privatbereich, nicht hierher.

export type UploadErgebnis = { datei: string; art: UploadArt | null; artText: string; ok: boolean; text: string; hinweise: string[]; link: string | null; /** Zahlen für den Datei-Import (nicht gespeichert). */ details?: Record<string, unknown> };
export type UploadOptionen = { firma: string | null; saldo: number | null };

const MAX = 25 * 1024 * 1024;

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    return (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text;
  } catch {
    return "";
  }
}

/** Welche Art ist die Datei? (Inhalt vor Endung) */
export async function dateiArt(name: string, bytes: Uint8Array): Promise<UploadArt> {
  if (istZip(bytes) && ![".xlsx", ".docx", ".odt", ".ods"].includes(endung(name))) return "zip";
  if (istPdf(bytes)) return pdfArt(await pdfText(bytes));
  const e = artNachEndung(name);
  if (e) return e;
  if (istBqoolDatei(bytes)) return "bqool_datei";
  // ArbitrageOne-Liste für sellerboard (ASIN | SKU | Cost) → EK-Import mit Vorschau statt direkt übernehmen
  if ([".xls", ".xlsx", ".csv"].includes(endung(name))) {
    try {
      const { parseArbitrageOne, readSheet } = await import("@/lib/imports/arbitrageone");
      if (parseArbitrageOne(readSheet(bytes)).source === "sellerboard") return "ek_liste";
    } catch {
      // kein ArbitrageOne-Format – weiter unten erkennen
    }
  }
  if (endung(name) === ".json") {
    try {
      return jsonArt(JSON.parse(new TextDecoder().decode(bytes))) ?? "tabelle";
    } catch {
      return "tabelle";
    }
  }
  try {
    const t = readTable(bytes);
    return tabellenArt(t.headers, name) ?? "tabelle";
  } catch {
    return "tabelle";
  }
}

async function verarbeiten(session: Session, name: string, bytes: Uint8Array, art: UploadArt, o: UploadOptionen): Promise<Omit<UploadErgebnis, "datei" | "art" | "artText" | "link"> & { link?: string }> {
  const wer = { tenantId: session.tenantId, userId: session.userId, name: session.name, email: session.email };
  switch (art) {
    case "kontoauszug": {
      const r = await sparkasseImportieren(wer, o.firma, { name, bytes }, o.saldo);
      return { ok: true, text: `${r.firma}: ${importMeldung(r.bank)}`, hinweise: [], details: { konto: { firma: r.firma, buchungen_neu: r.neu, schon_vorhanden: r.doppelt, von: r.von, bis: r.bis, kontostand: r.endsaldo, kontostand_datum: r.bank.endsaldo?.datum ?? r.bis } } };
    }
    case "amex": {
      const r = await amexImportieren(wer, o.firma, { name, bytes });
      return { ok: true, text: `${r.firma}: ${r.neu} neue Umsätze${r.doppelt ? `, ${r.doppelt} schon vorhanden` : ""} · Belastungen ${r.belastungen.toFixed(2).replace(".", ",")} €.`, hinweise: [], details: { konto: { firma: r.firma, buchungen_neu: r.neu, schon_vorhanden: r.doppelt, belastungen: r.belastungen } } };
    }
    case "ust_bericht": {
      const r = await ustBerichtImportieren(wer, o.firma, { name, bytes });
      return { ok: true, text: `Perioden ${r.perioden.map((p) => `${p.monat} (${p.zeilen} Zeilen)`).join(", ")} – je Periode zusammengeführt.`, hinweise: r.auswertung.hinweise, details: { ust: { perioden: r.perioden } } };
    }
    case "bqool": {
      const r = await importBqool(session.tenantId, bytes, name, null);
      return { ok: r.ok, text: r.message, hinweise: [] };
    }
    case "bqool_datei": {
      const { bqoolDateiEinlesen } = await import("@/lib/bqool/export-service");
      const r = await bqoolDateiEinlesen(session.tenantId, name, bytes);
      return { ok: r.ok, text: r.message, hinweise: r.ok ? ["Soll-Regeln und Export unter Repricer → BQool-Dateien."] : [] };
    }
    case "ek_liste": {
      const { ekImportVorschau } = await import("@/lib/ek-import/service");
      const r = await ekImportVorschau(session.tenantId, session.userId, name, bytes);
      return { ok: true, text: `Vorschau: ${r.zeilen} SKUs – ${r.anzahl.geaendert} geändert, ${r.anzahl.neu} neu, ${r.anzahl.gleich} unverändert, ${r.anzahl.unbekannt} unbekannt${r.anzahl.warnungen ? `, ${r.anzahl.warnungen} mit Warnung` : ""}. Noch nichts übernommen – bitte prüfen und übernehmen.`, hinweise: [], link: `/einkauf/ek-import?id=${r.id}`, details: { ek: { id: r.id, zeilen: r.zeilen, ...r.anzahl } } };
    }
    case "amazon_business":
      return { ok: false, text: "Amazon-Business-Bericht erkannt – der Bericht enthält keinen Zeitraum. Bitte unter Amazon Business mit Land und Zeitraum hochladen.", hinweise: [] };
    case "call_archiv": {
      const { archivImportieren, offeneCallsAuswerten } = await import("@/lib/calls/service");
      const r = await archivImportieren(session.tenantId, JSON.parse(new TextDecoder().decode(bytes)));
      if (r.neu) after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
      return { ok: !r.fehler, text: r.fehler ?? `${r.neu} Calls übernommen${r.vorhanden ? `, ${r.vorhanden} waren schon da` : ""} – die KI wertet sie aus.`, hinweise: [] };
    }
    case "call": {
      const { callsSammelImport, offeneCallsAuswerten } = await import("@/lib/calls/service");
      const r = await callsSammelImport(session.tenantId, { art: "gruppe", bezeichnung: null, linkText: "", dateien: [{ name, daten: bytes }], heute: todayIso() });
      if (r.neu) after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
      if (r.nachgetragen) after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
      return { ok: r.neu + r.nachgetragen > 0, text: r.neu ? `Call übernommen – die KI wertet ihn aus.` : r.nachgetragen ? "Transkript beim vorhandenen Call nachgetragen." : r.vorhanden.length ? "War schon im Call-Archiv." : r.fehler[0] ?? "Nicht übernommen.", hinweise: r.ohneDatum ? ["Ohne erkennbares Datum – im Call korrigieren."] : [] };
    }
    case "beleg": {
      const buf = Buffer.from(bytes);
      if (istPdf(bytes)) {
        const { ingestInvoice, refreshInvoiceTasks } = await import("@/lib/invoices/service");
        const r = await ingestInvoice({ tenantId: session.tenantId, source: "upload", externalId: createHash("sha256").update(buf).digest("hex"), fileName: name, bytes: buf, storeBytes: true });
        await refreshInvoiceTasks(session.tenantId);
        return { ok: true, text: r.created ? "Als Rechnung/Beleg übernommen – Daten werden ausgelesen." : "War schon unter Rechnungen.", hinweise: [] };
      }
      const { createReceipt } = await import("@/lib/invoices/receipts");
      const typ = endung(name) === ".png" ? "image/png" : endung(name) === ".webp" ? "image/webp" : /\.hei[cf]$/.test(endung(name)) ? "image/heic" : "image/jpeg";
      const r = await createReceipt(session.tenantId, { images: [{ bytes, type: typ }] });
      return { ok: true, text: r.duplicate ? "Dieser Beleg war schon da." : "Beleg-Foto übernommen (unter Belege scannen).", hinweise: [] };
    }
    case "tabelle": {
      const r = await importAnyFile({ tenantId: session.tenantId, userId: session.userId, fileName: name, bytes });
      if (r.ok) {
        const { runAfterImport } = await import("@/lib/hooks");
        await runAfterImport(session.tenantId);
      }
      return { ok: r.ok, text: `${r.label ? `${r.label}: ` : ""}${r.summary}`, hinweise: r.hints ?? [], details: r.report ? { report: r.report } : undefined };
    }
    case "zip":
      return { ok: false, text: "ZIP", hinweise: [] };
  }
}

async function protokoll(session: Session, e: UploadErgebnis, groesse: number) {
  await db.insert(schema.uploads).values({ tenantId: session.tenantId, userId: session.userId, dateiname: e.datei.slice(0, 250), groesse, art: e.art, ok: e.ok, zusammenfassung: e.text.slice(0, 2000), hinweise: e.hinweise.slice(0, 10), link: e.link });
}

/** Eine Datei: erkennen, Rechte prüfen, verarbeiten, protokollieren. ZIPs werden ausgepackt (eine Ebene). */
export async function dateiHochladen(session: Session, name: string, bytes: Uint8Array, o: UploadOptionen): Promise<UploadErgebnis[]> {
  if (bytes.length > MAX) return [await mitProtokoll(session, { datei: name, art: null, artText: "–", ok: false, text: "Größer als 25 MB.", hinweise: [], link: null }, bytes.length)];
  const art = await dateiArt(name, bytes);
  if (art === "zip") {
    const inhalt = leseZip(bytes, { maxEintraege: 200 });
    // Lauter Transkripte (Call-Export) → als ein Sammel-Import ins Call-Archiv
    if (inhalt.length && inhalt.every((x) => [".vtt", ".srt", ".docx", ".odt", ".txt", ".md"].includes(endung(x.name)))) {
      if (!canAccess(session, "amazon")) return [await mitProtokoll(session, { datei: name, art: "call", artText: UPLOAD_ART.call.text, ok: false, text: "Kein Zugriff auf das Call-Archiv (Bereich Amazon).", hinweise: [], link: null }, bytes.length)];
      const { callsSammelImport, offeneCallsAuswerten } = await import("@/lib/calls/service");
      const r = await callsSammelImport(session.tenantId, { art: "gruppe", bezeichnung: null, linkText: "", dateien: [{ name, daten: bytes }], heute: todayIso() });
      if (r.neu) after(() => offeneCallsAuswerten(session.tenantId).then(() => undefined));
      return [await mitProtokoll(session, { datei: name, art: "call", artText: "Call-Transkripte (ZIP)", ok: r.neu > 0, text: `${r.neu} Calls übernommen${r.vorhanden.length ? `, ${r.vorhanden.length} schon da` : ""}.`, hinweise: r.fehler.slice(0, 5), link: "/calls" }, bytes.length)];
    }
    const out: UploadErgebnis[] = [];
    for (const x of inhalt) out.push(...(await dateiHochladen(session, `${name} › ${x.name}`, new Uint8Array(x.daten), o)));
    return out.length ? out : [await mitProtokoll(session, { datei: name, art: "zip", artText: UPLOAD_ART.zip.text, ok: false, text: "Das ZIP ist leer.", hinweise: [], link: null }, bytes.length)];
  }
  const info = UPLOAD_ART[art];
  if (!canAccess(session, info.bereich) || session.readOnly) {
    return [await mitProtokoll(session, { datei: name, art, artText: info.text, ok: false, text: session.readOnly ? "Nur-ansehen-Konto – Hochladen nicht möglich." : `Erkannt als ${info.text} – dafür fehlt dir der Zugriff auf diesen Bereich.`, hinweise: [], link: null }, bytes.length)];
  }
  let r: Omit<UploadErgebnis, "datei" | "art" | "artText" | "link"> & { link?: string };
  try {
    r = await verarbeiten(session, name, bytes, art, o);
  } catch (e) {
    r = { ok: false, text: `Die Datei konnte nicht verarbeitet werden – ${lesbarerFehler(e, 400)}`, hinweise: [] };
  }
  return [{ ...(await mitProtokoll(session, { datei: name, art, artText: info.text, ok: r.ok, text: r.text, hinweise: r.hinweise, link: r.link ?? info.link }, bytes.length)), details: r.details }];
}

async function mitProtokoll(session: Session, e: UploadErgebnis, groesse: number) {
  await protokoll(session, e, groesse);
  return e;
}

export async function uploadVerlauf(tenantId: string, limit = 50) {
  return db.select().from(schema.uploads).where(eq(schema.uploads.tenantId, tenantId)).orderBy(desc(schema.uploads.createdAt)).limit(limit);
}

/** Protokoll unbekannter Formate: Uploads mit „Format nicht erkannt“ samt Spaltenliste – zum Nachbauen als neue Art. */
export async function unbekannteFormate(tenantId: string, limit = 20) {
  const U = schema.uploads;
  return db
    .select({ id: U.id, createdAt: U.createdAt, dateiname: U.dateiname, zusammenfassung: U.zusammenfassung, hinweise: U.hinweise })
    .from(U)
    .where(and(eq(U.tenantId, tenantId), eq(U.ok, false), ilike(U.zusammenfassung, "%Format nicht erkannt%")))
    .orderBy(desc(U.createdAt))
    .limit(limit);
}
