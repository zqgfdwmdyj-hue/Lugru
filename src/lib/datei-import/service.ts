import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNotNull, lt, max, ne, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { lesbarerFehler } from "@/lib/fehler-text";
import { loeschen, lesen, neuerSchluessel, speichern } from "@/lib/medien/ablage";
import { sitzungFuer } from "@/lib/mobil/token";
import { publicUrl } from "@/lib/public-url";
import { detectReport, parseStorageFees, REPORT_KINDS } from "@/lib/reports/amazon";
import { formatVorschlag, spaltenProtokoll, vorschlagText } from "@/lib/reports/format-vorschlag";
import { transaktionsAuswertung } from "@/lib/reports/transaktionen";
import { readTable } from "@/lib/tabular";
import { dateiArt, dateiHochladen } from "@/lib/uploads/service";
import { UPLOAD_ART, type UploadArt } from "@/lib/uploads/erkennen";
import { AUFBEWAHRUNG_TAGE, GUELTIG_MIN, IMPORT_ARTEN, landUndZeitraumAus, MAX_MB, sichererName, uploadPruefen, type ImportArt } from "./logic";

// Datei-Import über den Claude-Konnektor: Einmal-Adresse → PUT → Verarbeitung im Hintergrund mit demselben Code wie
// der Upload in der Oberfläche (zentrale Erkennung + Bereichs-Services) → Ergebnis je Art. Gleiche Datei zweimal →
// „bereits importiert“, keine Doppelbuchung. Dateien liegen verschlüsselt in der Ablage, nach 90 Tagen gelöscht.

const D = schema.dateiImporte;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const r2 = (n: number) => Math.round(n * 100) / 100;

const TYPEN: Record<string, string> = { ".csv": "text/csv", ".txt": "text/plain", ".tsv": "text/tab-separated-values", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel", ".pdf": "application/pdf", ".xml": "application/xml", ".json": "application/json", ".zip": "application/zip" };
const contentType = (name: string) => TYPEN[/\.[a-z0-9]+$/i.exec(name)?.[0].toLowerCase() ?? ""] ?? "application/octet-stream";

/** Werkzeug 1: Auftrag mit Einmal-Adresse anlegen (nur Inhaber; Rechte prüft das Werkzeug). */
export async function importLinkAnlegen(session: Session, i: { art: ImportArt; dateiname: string; hinweis?: string | null }, basis = publicUrl() ?? "") {
  const token = randomBytes(32).toString("base64url");
  const gueltigBis = new Date(Date.now() + GUELTIG_MIN * 60_000);
  const dateiname = sichererName(i.dateiname);
  const [row] = await db
    .insert(D)
    .values({ tenantId: session.tenantId, userId: session.userId, art: i.art, dateiname, hinweis: i.hinweis?.trim().slice(0, 300) || null, tokenHash: hashToken(token), gueltigBis })
    .returning({ id: D.id });
  return { import_id: row.id, upload_url: `${basis}/api/import/upload/${token}`, gueltig_bis: gueltigBis.toISOString(), max_mb: MAX_MB, methode: "PUT" as const, content_type: contentType(dateiname), art: IMPORT_ARTEN[i.art].text };
}

/** Upload annehmen (ohne Anmeldung, nur mit Einmal-Token). Gibt HTTP-Status und Antwort zurück – nie einen 500er für erwartbare Fehler. */
export async function uploadAnnehmen(token: string, bytes: Uint8Array | null, groesseAngabe: number | null): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return { status: 404, body: { fehler: "Upload-Adresse unbekannt." } };
  const [a] = await db.select().from(D).where(eq(D.tokenHash, hashToken(token)));
  const vorab = uploadPruefen(a ? { gueltigBis: a.gueltigBis, benutztAm: a.benutztAm } : null, { groesse: groesseAngabe });
  if (vorab) return { status: vorab.status, body: { fehler: vorab.fehler, code: vorab.code } };
  if (!bytes) return { status: 400, body: { fehler: "Keine Datei im Request (PUT mit der Datei als Inhalt)." } };
  const nach = uploadPruefen({ gueltigBis: a.gueltigBis, benutztAm: null }, { groesse: bytes.length });
  if (nach) return { status: nach.status, body: { fehler: nach.fehler, code: nach.code } };
  // Token genau einmal: nur wer ihn als Erster „verbraucht“, darf weiter.
  const [frei] = await db.update(D).set({ benutztAm: new Date() }).where(and(eq(D.id, a.id), sql`${D.benutztAm} is null`)).returning({ id: D.id });
  if (!frei) return { status: 410, body: { fehler: "Diese Upload-Adresse wurde schon benutzt – bitte mit import_link eine neue anfordern.", code: "benutzt" } };
  const r = await dateiAnnehmen(a, bytes);
  if (r.bereits) return { status: 200, body: { import_id: a.id, status: "fertig", bereits_importiert: true, hinweis: `Datei bereits importiert am ${r.am} – keine Doppelbuchung.` } };
  after(() => importVerarbeiten(a.id).catch((e) => console.error("Datei-Import", e instanceof Error ? e.message : e)));
  return { status: 202, body: { import_id: a.id, status: "verarbeitet", groesse_mb: r2(bytes.length / 1048576), hinweis: "Wird verarbeitet – Ergebnis mit import_status." } };
}

/** Gleiche Datei schon verarbeitet → „bereits importiert“ (nichts doppelt), sonst verschlüsselt ablegen und auf „verarbeitet“ setzen. */
async function dateiAnnehmen(a: { id: string; tenantId: string }, bytes: Uint8Array): Promise<{ bereits: true; am: string; ersterId: string } | { bereits: false }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const jetzt = new Date();
  const [schon] = await db
    .select({ id: D.id, fertigAm: D.fertigAm, ergebnis: D.ergebnis })
    .from(D)
    .where(and(eq(D.tenantId, a.tenantId), eq(D.sha256, sha256), eq(D.status, "fertig"), ne(D.id, a.id), sql`${D.bereitsImportId} is null`))
    .orderBy(D.fertigAm)
    .limit(1);
  if (schon) {
    const am = schon.fertigAm ? schon.fertigAm.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "früher";
    await db
      .update(D)
      .set({ status: "fertig", fortschritt: 100, groesse: bytes.length, sha256, hochgeladenAm: jetzt, fertigAm: jetzt, bereitsImportId: schon.id, ergebnis: { bereits_importiert: true, bereits_importiert_am: schon.fertigAm?.toISOString() ?? null, erster_import_id: schon.id, aenderungen: `Datei bereits importiert am ${am} – 0 neu, nichts doppelt gebucht.` } })
      .where(eq(D.id, a.id));
    return { bereits: true, am, ersterId: schon.id };
  }
  const ablage = neuerSchluessel(a.tenantId, jetzt);
  await speichern(ablage, bytes);
  await db.update(D).set({ status: "verarbeitet", fortschritt: 5, groesse: bytes.length, sha256, ablage, hochgeladenAm: jetzt }).where(eq(D.id, a.id));
  return { bereits: false };
}

/**
 * ArbitrageOne-Abruf: heruntergeladene Datei als Import anlegen und sofort verarbeiten – derselbe Weg wie eine über
 * import_link hochgeladene Datei (Prüfsumme, Ablage, Verarbeitung je Art). Kein Token, keine Upload-Adresse.
 */
export async function aoImportAnlegen(tenantId: string, userId: string, i: { art: ImportArt; quelleExport: string; dateiname: string; hinweis?: string | null }, bytes: Uint8Array): Promise<{ importId: string; status: string; bereits: boolean; text: string; ergebnis: Record<string, unknown> | null }> {
  const jetzt = new Date();
  const [row] = await db
    .insert(D)
    .values({ tenantId, userId, art: i.art, dateiname: sichererName(i.dateiname), hinweis: i.hinweis?.slice(0, 300) ?? null, tokenHash: `ao:${randomBytes(24).toString("hex")}`, gueltigBis: jetzt, benutztAm: jetzt, herkunft: "arbitrageone", quelleExport: i.quelleExport })
    .returning({ id: D.id });
  if (!bytes.length) {
    await db.update(D).set({ status: "fehler", fertigAm: jetzt, fehlerText: "Die Datei ist leer." }).where(eq(D.id, row.id));
    return { importId: row.id, status: "fehler", bereits: false, text: "Die Datei ist leer.", ergebnis: null };
  }
  const r = await dateiAnnehmen({ id: row.id, tenantId }, bytes);
  if (r.bereits) return { importId: row.id, status: "fertig", bereits: true, text: `bereits importiert am ${r.am} – nichts doppelt`, ergebnis: null };
  await importVerarbeiten(row.id);
  const [x] = await db.select({ status: D.status, fehler: D.fehlerText, ergebnis: D.ergebnis }).from(D).where(eq(D.id, row.id));
  const kurz = x?.ergebnis ? String((x.ergebnis as { text?: string }).text ?? "") : "";
  return { importId: row.id, status: x?.status ?? "fehler", bereits: false, text: x?.status === "fertig" ? kurz || "verarbeitet" : (x?.fehler ?? "Verarbeitung fehlgeschlagen"), ergebnis: x?.ergebnis ?? null };
}

class ImportFehler extends Error {}

/** Verarbeitung im Hintergrund (auch für Tests direkt aufrufbar). */
export async function importVerarbeiten(id: string): Promise<void> {
  const [a] = await db.select().from(D).where(eq(D.id, id));
  if (!a || a.status !== "verarbeitet" || !a.ablage) return;
  const fortschritt = (p: number) => db.update(D).set({ fortschritt: p }).where(eq(D.id, id));
  try {
    const session = a.userId ? await sitzungFuer(a.tenantId, a.userId, `import:${id}`) : null;
    if (!session || session.role !== "owner") throw new ImportFehler("Das Konto, das den Import angelegt hat, ist kein Inhaber mehr (oder deaktiviert).");
    const bytes = new Uint8Array(await lesen(a.ablage));
    await fortschritt(15);
    const ergebnis = await nachArt(session, a.art as ImportArt, a.dateiname, a.hinweis, bytes, id, fortschritt, { herkunft: a.herkunft, quelleExport: a.quelleExport, hochgeladenAm: a.hochgeladenAm ?? new Date() });
    await db.update(D).set({ status: "fertig", fortschritt: 100, fertigAm: new Date(), ergebnis, fehlerText: null }).where(eq(D.id, id));
  } catch (e) {
    await db.update(D).set({ status: "fehler", fertigAm: new Date(), fehlerText: e instanceof ImportFehler ? e.message : `Verarbeitung fehlgeschlagen – ${lesbarerFehler(e, 400)}` }).where(eq(D.id, id));
  }
}

async function zentral(session: Session, name: string, bytes: Uint8Array, art?: UploadArt, dateiImportId?: string, stand?: Date) {
  const [r] = await dateiHochladen(session, name, bytes, { firma: null, saldo: null, art, dateiImportId: dateiImportId ?? null, stand });
  if (!r) throw new ImportFehler("Die Datei konnte nicht verarbeitet werden.");
  if (!r.ok) throw new ImportFehler(r.text);
  return r;
}

type Herkunft = { herkunft: "claude" | "arbitrageone"; quelleExport: string | null; hochgeladenAm: Date };

async function nachArt(session: Session, art: ImportArt, name: string, hinweis: string | null, bytes: Uint8Array, id: string, fortschritt: (p: number) => Promise<unknown>, h: Herkunft = { herkunft: "claude", quelleExport: null, hochgeladenAm: new Date() }): Promise<Record<string, unknown>> {
  const def = IMPORT_ARTEN[art];
  const t = session.tenantId;

  // Amazon-Berichte: Art aus den Spalten muss passen, dann der gemeinsame Import (Upload-Seite).
  if ("bericht" in def && def.bericht) {
    let table;
    try {
      table = readTable(bytes);
    } catch {
      throw new ImportFehler("Datei nicht lesbar – erwartet CSV/TXT (Tabulator oder Komma).");
    }
    if (!table.headers.length || !table.rows.length) throw new ImportFehler("Die Datei ist leer.");
    const kind = detectReport(table);
    if (kind !== def.bericht) {
      const v = kind ? null : formatVorschlag(table.headers);
      throw new ImportFehler(`Falsche Art: erwartet ${def.text}, die Spalten passen dazu nicht${kind ? ` (sieht aus wie „${REPORT_KINDS[kind]}“ – dann import_link mit der passenden Art)` : v ? `. ${vorschlagText(v)}` : `. ${spaltenProtokoll(table.headers)}`}.`.replace(/\.\.$/, "."));
    }
    const vorherBis = kind === "transactions" ? (await db.select({ bis: max(schema.amazonTransactions.date) }).from(schema.amazonTransactions).where(eq(schema.amazonTransactions.tenantId, t)))[0]?.bis ?? null : null;
    await fortschritt(30);
    const r = await zentral(session, name, bytes);
    const rep = (r.details?.report ?? {}) as { rows?: number; inserted?: number; details?: Record<string, number> };
    const zeilen = rep.rows ?? 0;
    const neu = rep.inserted ?? 0;
    const basis = { art, text: r.text, zeilen, neu, bereits_vorhanden: Math.max(0, zeilen - neu), link: r.link };
    if (kind === "transactions") {
      const aus = transaktionsAuswertung(table);
      const warnungen = [...aus.warnungen];
      if (vorherBis && aus.zeitraum.von && aus.zeitraum.von > vorherBis && Date.parse(aus.zeitraum.von) - Date.parse(vorherBis) > 86_400_000) warnungen.push(`Lücke: vorhandene Transaktionen bis ${vorherBis}, diese Datei beginnt am ${aus.zeitraum.von}.`);
      const ab = rep.details ?? {};
      return {
        ...basis,
        zeitraum: aus.zeitraum,
        marktplaetze: aus.marktplaetze,
        abrechnungen: aus.abrechnungen,
        summen_je_typ: aus.summenJeTyp,
        auszahlungen: aus.auszahlungen,
        aenderungen: {
          transaktionen_neu: neu,
          bereits_vorhanden: Math.max(0, zeilen - neu),
          abrechnungen_neu: ab.abrechnungenNeu ?? 0,
          abrechnungszeilen_abgeleitet: ab.zeilenNeu ?? 0,
          auszahlungen_mit_datum: ab.auszahlungen ?? 0,
          abrechnungen_mit_echtem_bericht: ab.mitAbrechnungsbericht ?? 0,
          text: neu === 0 && zeilen > 0 ? `0 neu, ${zeilen.toLocaleString("de-DE")} bereits vorhanden` : `${neu.toLocaleString("de-DE")} neu, ${Math.max(0, zeilen - neu).toLocaleString("de-DE")} bereits vorhanden`,
        },
        warnungen,
        links: { gewinn: "/gewinn", liquiditaet: "/cashflow" },
      };
    }
    if (kind === "storageFees") {
      const p = parseStorageFees(table);
      const je = (k: (x: (typeof p)[number]) => string) => [...p.reduce((m, x) => m.set(k(x), r2((m.get(k(x)) ?? 0) + x.gebuehr)), new Map<string, number>())].map(([schluessel, summe]) => ({ schluessel, summe })).sort((x, y) => y.summe - x.summe);
      const monate = je((x) => x.monat).map((x) => ({ monat: x.schluessel, gebuehr: x.summe }));
      const { lagerAbgleich } = await import("@/lib/reports/lagergebuehren");
      return {
        ...basis,
        monate,
        laender: je((x) => x.land).map((x) => ({ land: x.schluessel, gebuehr: x.summe })),
        anzahl_asins: new Set(p.map((x) => x.asin)).size,
        anzahl_uebergross: new Set(p.filter((x) => x.uebergross).map((x) => x.asin)).size,
        teuerste_asins: je((x) => x.asin).slice(0, 10).map((x) => ({ asin: x.schluessel, gebuehr: x.summe })),
        abgleich: await Promise.all(monate.map(async (m) => ({ monat: m.monat, ...(await lagerAbgleich(t, m.monat, m.gebuehr)) }))),
        hinweis: "Geschätzte Lagergebühren laut Amazon – stecken bereits in der Amazon-Abrechnung, daher nur zur Auswertung je Artikel (Kapital-Ampel, Remission) und nicht zusätzlich im Gewinn.",
        links: { werkzeug: "amazon_lagergebuehren", kapital: "/kapital" },
      };
    }
    return basis;
  }

  // Übrige Arten mit eigener Upload-Erkennung (Kontoauszug, Amex, EK-Liste, USt-Bericht).
  if ("upload" in def && def.upload) {
    // B27.1: Dateien aus dem ArbitrageOne-Abruf – der Abruf weiß, welchen Export er geladen hat: Art fest, keine Erkennung.
    // B30.2: Bestellliste ausdrücklich gewählt, aber nur als allgemeine Tabelle erkannt (z. B. Spalte Menge fehlt) →
    // trotzdem an den Parser, damit der Fehler die gefundenen und fehlenden Spalten nennt.
    const roh = h.herkunft === "arbitrageone" ? null : await dateiArt(name, bytes);
    const fest = h.herkunft === "arbitrageone" || (def.upload === "ao_einkaeufe" && roh === "tabelle");
    const erkannt = fest ? def.upload : roh!;
    if (erkannt !== def.upload) throw new ImportFehler(`Falsche Art: erwartet ${def.text}, erkannt wurde „${UPLOAD_ART[erkannt].text}“.`);
    await fortschritt(30);
    const r = await zentral(session, name, bytes, fest ? def.upload : undefined, id, h.hochgeladenAm);
    const basis = { art, text: r.text, hinweise: r.hinweise, link: r.link };
    // ArbitrageOne-Abruf: EK-Zeilen ohne Warnung gleich übernehmen (Nachtlauf ohne Handarbeit), Rest zur Prüfung.
    if (art === "ek_liste" && h.herkunft === "arbitrageone") {
      const ek = (r.details?.ek ?? null) as { id?: string } | null;
      const { ekImportAutomatisch } = await import("@/lib/ek-import/service");
      const auto = ek?.id ? await ekImportAutomatisch(t, session.userId, ek.id) : null;
      return { ...basis, ...(r.details ?? {}), automatisch: auto ?? undefined, text: `${auto?.text ?? "Kein EK je SKU (ohne SKU-Spalte)."}${(r.details?.einkaeufe as { neu?: number; bekannt?: number } | undefined) ? ` Einkäufe: ${(r.details!.einkaeufe as { neu: number }).neu} neu, ${(r.details!.einkaeufe as { bekannt: number }).bekannt} schon bekannt.` : ""}`, link: auto?.vorschauId ? `/einkauf/ek-import?id=${auto.vorschauId}` : r.link };
    }
    if (art === "amazon_umsatzsteuer_transaktionen") {
      const perioden = ((r.details?.ust as { perioden?: { monat: string; zeilen: number }[] })?.perioden ?? []).map((p) => p.monat);
      const { umsatzsteuerBlock } = await import("./umsatzsteuer");
      return { ...basis, perioden: await Promise.all(perioden.map((m) => umsatzsteuerBlock(t, m))) };
    }
    return { ...basis, ...(r.details ?? {}) };
  }

  if (art === "bqool_datei") {
    const erkannt = await dateiArt(name, bytes);
    if (erkannt !== "bqool_datei" && erkannt !== "bqool") throw new ImportFehler(`Falsche Art: erwartet ${def.text}, erkannt wurde „${UPLOAD_ART[erkannt].text}“.`);
    const r = await zentral(session, name, bytes);
    return { art, text: r.text, hinweise: r.hinweise, link: erkannt === "bqool_datei" ? "/repricer/bqool" : "/repricer" };
  }

  if (art === "ao_accountone_cog") {
    const { readSheet } = await import("@/lib/imports/arbitrageone");
    const { aoFormat, accountoneMonat } = await import("@/lib/arbitrageone/logic");
    let table: unknown[][];
    try {
      table = readSheet(bytes);
    } catch {
      throw new ImportFehler("Datei nicht lesbar – erwartet CSV oder XLSX.");
    }
    if (!table.length || table.length < 2) throw new ImportFehler("Die Datei ist leer.");
    if (aoFormat(table[0]) !== "accountone") throw new ImportFehler(`Falsche Art: erwartet ${def.text}, die Spalten passen dazu nicht. ${spaltenProtokoll(table[0].map((x) => String(x ?? "")))}`);
    const monat = /\b(20\d{2})-(0[1-9]|1[0-2])\b/.exec(hinweis ?? "")?.[0] ?? accountoneMonat(h.hochgeladenAm);
    const { aoAccountoneSpeichern } = await import("@/lib/arbitrageone/service");
    const c = await aoAccountoneSpeichern(t, monat, table, name, id);
    if (!c) throw new ImportFehler("Keine Zeilen mit SKU gefunden.");
    await protokollieren(session, name, bytes.length, true, `AccountOne COG ${monat}: ${c.zeilen} SKUs`, "/buchhaltung");
    return { art, monat, zeilen: c.zeilen, ohne_ek: c.ohneEk, text: `AccountOne COG ${monat}: ${c.zeilen} SKUs – liegt der Monatsdatei für den Steuerberater bei („CSV + Belege“).`, link: "/buchhaltung" };
  }

  if (art === "ao_bqool_vergleich") {
    const { istBqoolDatei } = await import("@/lib/uploads/erkennen");
    if (!istBqoolDatei(bytes)) throw new ImportFehler(`Falsche Art: erwartet ${def.text} (erste Zeile „FileType = repricing“ fehlt).`);
    const { aoBqoolVergleichen } = await import("@/lib/arbitrageone/service");
    const v = await aoBqoolVergleichen(t, new TextDecoder("utf-8").decode(bytes), name);
    return { art, ...v, link: "/repricer/bqool#ao-vergleich" };
  }

  if (art === "amazon_geschaeftsbericht") {
    const lz = landUndZeitraumAus(hinweis);
    if (!lz.land || !lz.von || !lz.bis) throw new ImportFehler("Land und Zeitraum im Hinweis angeben, z. B. „DE, 01.10.–31.10.2026“ oder „FR 2026-09“.");
    const table = readTable(bytes);
    const { leseBusinessReport } = await import("@/lib/amazon-business/logic");
    const rep = leseBusinessReport(table.headers, table.rows);
    if (rep.fehler) throw new ImportFehler(rep.fehler);
    const { speichereB2bPeriode } = await import("@/lib/amazon-business/store");
    const n = await speichereB2bPeriode(t, lz.land, lz.von, lz.bis, rep.zeilen, "upload");
    await protokollieren(session, name, bytes.length, true, `Geschäftsbericht ${lz.land} ${lz.von}–${lz.bis}: ${n} ASINs`, "/amazon-business");
    return { art, land: lz.land, zeitraum: { von: lz.von, bis: lz.bis }, asins: n, link: `/amazon-business?land=${lz.land}` };
  }

  if (art === "preisliste") {
    const { lieferantAusText, preislisteImportieren } = await import("@/lib/b2b/preisliste-import");
    const l = await lieferantAusText(t, hinweis);
    if (!l) throw new ImportFehler("Lieferant im Hinweis angeben (Name oder Kürzel genau wie im Seller-System), z. B. „Lieferant TESTGH“.");
    const r = await preislisteImportieren(t, { supplierId: l.id, table: readTable(bytes), name: null });
    if (!r.ok) throw new ImportFehler(`${r.message}${r.headers.length ? ` (Spalten: ${r.headers.slice(0, 12).join(", ")})` : ""}`);
    await protokollieren(session, name, bytes.length, true, `Preisliste ${l.name}: ${r.message}`, `/b2b/preislisten/${r.feedId}`);
    return { art, lieferant: l.name, text: r.message, spalten_per_ki: r.ki, link: `/b2b/preislisten/${r.feedId}` };
  }

  // sonstiges: als Eintrag im Posteingang (Ordner „Upload“), Datei bleibt 90 Tage in der Ablage.
  const [m] = await db
    .insert(schema.emails)
    .values({ tenantId: t, messageKey: `datei-import:${id}`, fromName: "Claude (Datei-Import)", subject: name, receivedAt: new Date(), snippet: hinweis ?? "Datei über Claude hochgeladen – keine Verarbeitung.", bodyText: `Datei „${name}“ über Claude hochgeladen.${hinweis ? `\nHinweis: ${hinweis}` : ""}\nHerunterladen (90 Tage): /uploads/datei/${id}`, ordner: "Upload", category: "action", references: { dateiImport: id } })
    .onConflictDoNothing()
    .returning({ id: schema.emails.id });
  await protokollieren(session, name, bytes.length, true, "Im Posteingang abgelegt (keine Verarbeitung).", m ? `/posteingang/${m.id}` : "/posteingang");
  return { art, text: "Im Posteingang abgelegt – keine Verarbeitung.", link: m ? `/posteingang/${m.id}` : "/posteingang", datei: `/uploads/datei/${id}` };
}

async function protokollieren(session: Session, datei: string, groesse: number, ok: boolean, text: string, link: string | null) {
  await db.insert(schema.uploads).values({ tenantId: session.tenantId, userId: session.userId, dateiname: datei.slice(0, 250), groesse, art: null, ok, zusammenfassung: text.slice(0, 2000), hinweise: [], link });
}

/** Werkzeug 2: Stand eines Imports. */
export async function importStatus(tenantId: string, id: string) {
  const [a] = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  if (!a) return null;
  const abgelaufen = a.status === "wartet_auf_datei" && a.gueltigBis.getTime() < Date.now();
  return {
    import_id: a.id,
    status: a.status,
    fortschritt_prozent: a.fortschritt,
    art: a.art,
    art_text: IMPORT_ARTEN[a.art as ImportArt]?.text ?? a.art,
    dateiname: a.dateiname,
    hinweis: a.hinweis ?? undefined,
    groesse_mb: a.groesse !== null ? r2(a.groesse / 1048576) : null,
    hochgeladen_am: a.hochgeladenAm?.toISOString() ?? null,
    fertig_am: a.fertigAm?.toISOString() ?? null,
    upload_gueltig_bis: a.status === "wartet_auf_datei" ? a.gueltigBis.toISOString() : undefined,
    fehler_text: a.fehlerText ?? (abgelaufen ? "Upload-Adresse abgelaufen, ohne dass eine Datei kam – bitte mit import_link eine neue anfordern." : undefined),
    bereits_importiert: a.bereitsImportId ? true : undefined,
    herkunft: a.herkunft,
    // B27.1: fehlgeschlagen und Datei noch da → unter Anbindungen → Importe „Erneut verarbeiten“ (Inhaber).
    erneut_verarbeitbar: a.status === "fehler" && Boolean(a.ablage) ? true : undefined,
    nachverarbeitet_am: a.nachverarbeitetAm?.toISOString() ?? undefined,
    ergebnis: a.ergebnis ?? undefined,
  };
}

/**
 * B27.1: Fehlgeschlagenen Import mit derselben Datei (aus der verschlüsselten Ablage) erneut verarbeiten – nach einem
 * Fix oder wenn eine Einstellung fehlte. Ist dieselbe Datei inzwischen erfolgreich importiert, wird nichts doppelt
 * gebucht („bereits importiert“). Nichts wird gelöscht; der alte Fehler steht danach im Ergebnis.
 */
export async function importErneutVerarbeiten(tenantId: string, id: string): Promise<{ ok: boolean; status: string; text: string }> {
  const [a] = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  if (!a) return { ok: false, status: "fehlt", text: "Import nicht gefunden." };
  if (a.status !== "fehler") return { ok: false, status: a.status, text: "Nur fehlgeschlagene Importe lassen sich erneut verarbeiten." };
  if (!a.ablage) return { ok: false, status: a.status, text: "Die Datei liegt nicht mehr vor (nach der Aufbewahrungszeit gelöscht) – bitte neu hochladen bzw. abholen." };
  const vorher = a.fehlerText;
  const jetzt = new Date();
  // B30.3: ArbitrageOne-Export „Einkäufe“ ist eine Bestellliste – mit der neuen Art verarbeiten, nicht mit der
  // gespeicherten „ek_liste“.
  const artVorher = a.art;
  if (a.herkunft === "arbitrageone" && a.quelleExport === "einkaeufe" && a.art === "ek_liste") await db.update(D).set({ art: "ao_einkaeufe" }).where(eq(D.id, a.id));
  if (a.sha256) {
    const [schon] = await db
      .select({ id: D.id, fertigAm: D.fertigAm })
      .from(D)
      .where(and(eq(D.tenantId, tenantId), eq(D.sha256, a.sha256), eq(D.status, "fertig"), ne(D.id, a.id), sql`${D.bereitsImportId} is null`))
      .limit(1);
    if (schon) {
      await db.update(D).set({ status: "fertig", fortschritt: 100, fertigAm: jetzt, fehlerText: null, bereitsImportId: schon.id, nachverarbeitetAm: jetzt, ergebnis: { bereits_importiert: true, erster_import_id: schon.id, erneut_verarbeitet: { am: jetzt.toISOString(), vorheriger_fehler: vorher } } }).where(eq(D.id, a.id));
      return { ok: true, status: "fertig", text: "Dieselbe Datei ist inzwischen importiert – nichts doppelt gebucht." };
    }
  }
  await db.update(D).set({ status: "verarbeitet", fortschritt: 5, fehlerText: null, fertigAm: null, nachverarbeitetAm: jetzt }).where(eq(D.id, a.id));
  await importVerarbeiten(a.id);
  const [x] = await db.select({ status: D.status, fehler: D.fehlerText, ergebnis: D.ergebnis }).from(D).where(eq(D.id, a.id));
  if (x?.status === "fertig") {
    await db.update(D).set({ ergebnis: { ...(x.ergebnis ?? {}), erneut_verarbeitet: { am: jetzt.toISOString(), vorheriger_fehler: vorher, ...(artVorher !== "ao_einkaeufe" && a.quelleExport === "einkaeufe" ? { art_vorher: artVorher } : {}) } } }).where(eq(D.id, a.id));
    return { ok: true, status: "fertig", text: String((x.ergebnis as { text?: string } | null)?.text ?? "verarbeitet") };
  }
  return { ok: false, status: x?.status ?? "fehler", text: x?.fehler ?? "Verarbeitung fehlgeschlagen" };
}

/**
 * B27.1: Nach dem Fix einmal automatisch nachverarbeiten: fehlgeschlagene ArbitrageOne-Importe (Einkäufe, Lagerbestand)
 * der letzten 14 Tage, die noch nie nachverarbeitet wurden – älteste zuerst (neuere Stände gewinnen).
 */
export async function aoFehlimporteNachverarbeiten(tenantId: string): Promise<{ id: string; dateiname: string; ok: boolean; text: string }[]> {
  const { AO_BESTELL_PARSER_STAND } = await import("@/lib/arbitrageone/bestellungen-logic");
  const rows = await db
    .select({ id: D.id, dateiname: D.dateiname })
    .from(D)
    .where(
      and(
        eq(D.tenantId, tenantId),
        eq(D.herkunft, "arbitrageone"),
        eq(D.status, "fehler"),
        isNotNull(D.ablage),
        sql`${D.createdAt} > now() - interval '14 days'`,
        // B30.3: „Einkäufe“ (bisher als ek_liste gescheitert, auch schon einmal nachverarbeitet) mit der neuen Art; mit
        // neuem Parser-Stand gescheiterte Bestelllisten noch einmal; sonst wie bisher einmal.
        sql`((${D.art} in ('ek_liste', 'ao_lagerbestand') and ${D.nachverarbeitetAm} is null) or (${D.quelleExport} = 'einkaeufe' and ${D.art} = 'ek_liste') or (${D.art} = 'ao_einkaeufe' and (${D.nachverarbeitetAm} is null or ${D.nachverarbeitetAm} < ${AO_BESTELL_PARSER_STAND}::timestamptz)))`,
      ),
    )
    .orderBy(D.createdAt)
    .limit(20);
  const out: { id: string; dateiname: string; ok: boolean; text: string }[] = [];
  for (const r of rows) out.push({ id: r.id, dateiname: r.dateiname, ...(await importErneutVerarbeiten(tenantId, r.id)) });
  return out;
}

/** Werkzeug 3: letzte Importe mit Kurzfassung. */
export async function importeListe(tenantId: string, o: { limit?: number; art?: string | null } = {}) {
  const rows = await db
    .select()
    .from(D)
    .where(and(eq(D.tenantId, tenantId), o.art ? eq(D.art, o.art) : undefined))
    .orderBy(desc(D.createdAt))
    .limit(Math.min(100, Math.max(1, o.limit ?? 20)));
  return rows.map((a) => ({
    import_id: a.id,
    status: a.status === "wartet_auf_datei" && a.gueltigBis.getTime() < Date.now() ? "abgelaufen" : a.status,
    herkunft: a.herkunft === "arbitrageone" ? `ArbitrageOne-Abruf (${a.quelleExport ?? "?"})` : "Claude (import_link)",
    art: a.art,
    dateiname: a.dateiname,
    angelegt: a.createdAt.toISOString(),
    fertig_am: a.fertigAm?.toISOString() ?? null,
    kurz: a.fehlerText ?? (a.ergebnis ? String((a.ergebnis as { aenderungen?: { text?: string } | string; text?: string }).text ?? (typeof (a.ergebnis as { aenderungen?: unknown }).aenderungen === "string" ? (a.ergebnis as { aenderungen: string }).aenderungen : ((a.ergebnis as { aenderungen?: { text?: string } }).aenderungen?.text ?? ""))).slice(0, 300) : null),
  }));
}

/** Datei eines Imports (nur Inhaber, nur 90 Tage) – für den Posteingang-Eintrag bei „sonstiges“. */
export async function importDatei(tenantId: string, id: string): Promise<{ name: string; bytes: Buffer; typ: string } | null> {
  const [a] = await db.select({ ablage: D.ablage, dateiname: D.dateiname }).from(D).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  if (!a?.ablage) return null;
  return { name: a.dateiname, bytes: await lesen(a.ablage), typ: contentType(a.dateiname) };
}

/** Täglich: Dateien älter als 90 Tage aus der Ablage löschen – das Ergebnis bleibt. Abgelaufene Aufträge ohne Datei als Fehler markieren. */
export async function importeAufraeumen(jetzt = new Date()): Promise<number> {
  const grenze = new Date(jetzt.getTime() - AUFBEWAHRUNG_TAGE * 86_400_000);
  const alt = await db.select({ id: D.id, ablage: D.ablage }).from(D).where(and(isNotNull(D.ablage), lt(D.createdAt, grenze)));
  for (const a of alt) {
    await loeschen(a.ablage!).catch(() => null);
    await db.update(D).set({ ablage: null }).where(eq(D.id, a.id));
  }
  await db.update(D).set({ status: "fehler", fehlerText: "Upload-Adresse abgelaufen, ohne dass eine Datei kam." }).where(and(eq(D.status, "wartet_auf_datei"), lt(D.gueltigBis, new Date(jetzt.getTime() - 3600_000))));
  return alt.length;
}
