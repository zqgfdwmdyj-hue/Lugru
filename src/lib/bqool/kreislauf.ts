import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BqoolIstLand, BqoolUploadLand } from "@/db/schema";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { ABRUF_PLAN } from "@/lib/today/abruf-plan";
import { recordJob, recordJobHinweis } from "@/lib/today/jobs";
import type { ExportLand } from "./export-logic";
import { autoFreigabe, freigabeFristen, freigabeText, KONTROLLE_MINUTEN, KREISLAUF_UHRZEIT, nachkontrolle, tagBerlin, uhrBerlin, uebernommenJeLand, jeLandText } from "./kreislauf-logic";

// B31.2 Täglicher BQool-Kreislauf (06:00): Ist je Land holen → Soll erzeugen (nur Änderungen) → Freigabe per Push →
// Upload je Land („Repricing Central File“) mit Rückmeldung → Nachkontrolle 30 Minuten später. Hochgeladen wird nur
// nach Freigabe – oder, wenn Ludwig es einschaltet, automatisch ohne Regelwechsel und ohne Min unter Break-even.
// Freigabe bis 18:00 (Erinnerung 12:00), danach verfällt der Lauf; am nächsten Tag kommt ein neuer.

const K = schema.bqoolLaeufe;
export const JOB_IST = "BQool: Ist holen";
export const JOB_UPLOAD = "BQool: Upload";
export const JOB_BERICHTE = "BQool: Berichte";
export const JOB_KONTROLLE = "BQool: Nachkontrolle";
const LINK = "/repricer/bqool#freigabe";
const TASK_FREIGABE = "bqool-freigabe";
const TASK_KONTROLLE = "bqool-nachkontrolle";

export type BqoolLauf = typeof K.$inferSelect;

/** BQool-Anmeldung für die Automatik (E-Mail, Passwort, Upload-Seite) – sonst kein Kreislauf. */
async function zugang(tenantId: string) {
  const z = await getIntegration(tenantId, "bqool_web");
  return z?.email && z.password && z.uploadUrl ? z : null;
}

async function aendern(tenantId: string, id: string, werte: Partial<typeof K.$inferInsert>, eintrag?: string | { zeit: string; text: string; bildId?: string }[]) {
  const neu = typeof eintrag === "string" ? [{ zeit: new Date().toISOString(), text: eintrag }] : (eintrag ?? []);
  await db
    .update(K)
    .set({ ...werte, updatedAt: new Date(), ...(neu.length ? { protokoll: sql`${K.protokoll} || ${JSON.stringify(neu)}::jsonb` } : {}) })
    .where(and(eq(K.tenantId, tenantId), eq(K.id, id)));
}

async function lauf(tenantId: string, id: string): Promise<BqoolLauf | null> {
  const [l] = await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.id, id)));
  return l ?? null;
}

/** Neuester Lauf eines Tages (Berlin). */
export async function laufVomTag(tenantId: string, tag: string): Promise<BqoolLauf | null> {
  const [l] = await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.tag, tag))).orderBy(desc(K.createdAt)).limit(1);
  return l ?? null;
}

export async function letzteLaeufe(tenantId: string, limit = 5): Promise<BqoolLauf[]> {
  return db.select().from(K).where(eq(K.tenantId, tenantId)).orderBy(desc(K.createdAt)).limit(limit);
}

/** Aktive Inhaber (Push und Aufgaben gehen an sie). */
async function inhaber(tenantId: string): Promise<string[]> {
  const M = schema.memberships;
  return (await db.select({ id: M.userId }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.role, "owner"), eq(M.readOnly, false), isNull(M.deaktiviertAm))).orderBy(asc(M.createdAt))).map((m) => m.id);
}

export async function pushen(tenantId: string, m: { titel: string; text: string; link: string; aktionen?: { aktion: string; titel: string; link: string }[] }) {
  const an = await inhaber(tenantId);
  if (!an.length) return;
  const { melden } = await import("@/lib/push/service");
  await melden(tenantId, an, { ...m, art: "bqool", aktionen: m.aktionen ?? null }, { ohneDiscord: true }).catch((e) => console.error("[BQool] Push", e instanceof Error ? e.message : e));
}

/**
 * Ist holen: je Land die Export-Datei herunterladen und als BQool-Ist einlesen (Repricing-Datei bzw. „Manage
 * Listings“). Ohne Export-Seite: Hinweis, Ist bleibt vom letzten Stand.
 */
async function istHolen(tenantId: string, laender: string[], laufId: string, zweck: "ist" | "kontrolle"): Promise<{ belegt?: boolean; abgebrochen?: string; nichtEingerichtet?: boolean; jeLand: BqoolIstLand[] }> {
  const z = (await zugang(tenantId))!;
  const { bqoolExportAdressen } = await import("@/lib/automatik/bqool-logic");
  const adressen = bqoolExportAdressen(z).filter((a) => laender.includes(a.land));
  // B31.5: Berichte „Listing Performance“/„Daily Sales“ nur beim morgendlichen Ist (nicht bei der Nachkontrolle).
  const berichtLaender = zweck === "ist" && ((z.leistungUrl ?? "").trim() || (z.tagesUrl ?? "").trim()) ? laender : [];
  const { bqoolIstHerunterladen } = await import("@/lib/automatik/bqool-ist");
  if (!adressen.some((a) => a.url)) {
    const jeLand = laender.map((land) => ({ land, ok: false, text: "keine Export-Seite eingetragen (Anbindungen → BQool) – Ist bleibt vom letzten Stand" }));
    await aendern(tenantId, laufId, zweck === "ist" ? { ist: jeLand } : {}, "Ist holen: keine Export-Seite eingetragen – Ist bleibt vom letzten Stand");
    await recordJobHinweis(tenantId, JOB_IST, "nicht eingerichtet – Export-Seite unter Anbindungen → BQool eintragen", ABRUF_PLAN[JOB_IST]);
    if (berichtLaender.length) {
      const b = await bqoolIstHerunterladen(tenantId, [], z, { titel: "BQool: Berichte", aufgabeKey: "automatik-bqool-ist", link: LINK, berichte: berichtLaender });
      if (!b.belegt) await berichteEinlesen(tenantId, laufId, b.ok ? b.berichte : [], b.ok ? b.berichtFehler : [b.fehler ?? "abgebrochen"]);
    }
    return { nichtEingerichtet: true, jeLand };
  }
  const t0 = Date.now();
  const r = await bqoolIstHerunterladen(tenantId, laender, z, { titel: zweck === "ist" ? "BQool: Ist holen" : "BQool: Nachkontrolle", aufgabeKey: "automatik-bqool-ist", link: LINK, berichte: berichtLaender });
  if (r.belegt) return { belegt: true, jeLand: [] };
  const protokoll = r.protokoll.map((p) => ({ zeit: p.zeit, text: `${zweck === "ist" ? "Ist" : "Nachkontrolle"}: ${p.text}`, bildId: p.bildId }));
  if (!r.ok) {
    const grund = r.zweiFaktor ? `Zwei-Faktor-Anmeldung verlangt – Lauf abgebrochen (${r.fehler ?? ""})` : `Abgebrochen: ${r.fehler ?? "unbekannt"}`;
    await aendern(tenantId, laufId, {}, protokoll);
    await recordJob(tenantId, JOB_IST, grund, Date.now() - t0, ABRUF_PLAN[JOB_IST]);
    return { abgebrochen: grund, jeLand: [] };
  }
  // Einlesen nach dem Browser: Repricing-Datei („FileType = repricing“) bzw. Export „Manage Listings“.
  const { istBqoolDatei } = await import("@/lib/uploads/erkennen");
  const { bqoolDateiEinlesen, bqoolAbgleichAufgabe } = await import("./export-service");
  const { importBqool } = await import("./service");
  const jeLand: BqoolIstLand[] = [];
  for (const x of r.jeLand) {
    const d = r.dateien.find((f) => f.land === x.land);
    if (!x.ok || !d) {
      jeLand.push({ land: x.land, ok: false, text: x.text, ...(x.bild ? { bild: x.bild } : {}) });
      continue;
    }
    try {
      if (istBqoolDatei(d.bytes)) {
        const e = await bqoolDateiEinlesen(tenantId, d.name, d.bytes, { land: d.land as ExportLand, ohneAbgleich: true, via: "automatik" });
        jeLand.push({ land: d.land, ok: e.ok, datei: d.name, skus: e.skus, text: e.message });
      } else {
        const e = await importBqool(tenantId, d.bytes, d.name, d.land as ExportLand);
        jeLand.push({ land: d.land, ok: e.ok, datei: d.name, text: e.message });
      }
    } catch (e) {
      jeLand.push({ land: d.land, ok: false, datei: d.name, text: `nicht lesbar: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` });
    }
  }
  if (jeLand.some((x) => x.ok)) await bqoolAbgleichAufgabe(tenantId).catch(() => undefined);
  const fehler = jeLand.filter((x) => !x.ok);
  await aendern(tenantId, laufId, zweck === "ist" ? { ist: jeLand, istAm: new Date() } : {}, [...protokoll, { zeit: new Date().toISOString(), text: `${zweck === "ist" ? "Ist" : "Nachkontrolle"}: ${jeLand.map((x) => `${x.land} ${x.ok ? (x.skus !== undefined ? `${x.skus} SKUs` : "ok") : `Fehler – ${x.text}`}`).join(" · ")}` }]);
  await recordJob(tenantId, JOB_IST, fehler.length ? `${fehler.map((x) => `${x.land}: ${x.text}`).join(" · ")}` : null, Date.now() - t0, ABRUF_PLAN[JOB_IST]);
  if (berichtLaender.length) await berichteEinlesen(tenantId, laufId, r.berichte, r.berichtFehler);
  return { jeLand };
}

/** B31.5: heruntergeladene Berichte einlesen (Land kennt der Lauf – keine Rückfrage), Protokoll und Abruf „BQool: Berichte“. */
async function berichteEinlesen(tenantId: string, laufId: string, dateien: { land: string; art: string; name: string; bytes: Uint8Array }[], fehler: string[]) {
  const t0 = Date.now();
  const { bqoolBerichtEinlesen } = await import("./berichte");
  const { istBerichtLand } = await import("./berichte-logic");
  const texte: string[] = [];
  const fehl = [...fehler];
  for (const d of dateien) {
    if (!istBerichtLand(d.land)) continue;
    try {
      const e = await bqoolBerichtEinlesen(tenantId, d.name, d.bytes, { land: d.land, tage: 7, via: "automatik" });
      (e.ok ? texte : fehl).push(e.ok ? e.text : `${d.land}: ${e.text}`);
    } catch (e) {
      fehl.push(`${d.land} ${d.art}: nicht lesbar – ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    }
  }
  await aendern(tenantId, laufId, {}, [...texte, ...fehl].map((t) => ({ zeit: new Date().toISOString(), text: `Berichte: ${t}`.slice(0, 500) })));
  await recordJob(tenantId, JOB_BERICHTE, fehl.length ? fehl.join(" · ").slice(0, 900) : null, Date.now() - t0, ABRUF_PLAN[JOB_BERICHTE]);
}

/**
 * Lauf starten (06:00 bzw. Knopf „Jetzt starten“): Ist holen, Soll erzeugen, Freigabe anfragen oder – wenn erlaubt –
 * automatisch hochladen. Belegt eine andere Browser-Automatik den Browser, startet der Zeitplan beim nächsten Takt neu.
 */
export async function kreislaufStarten(tenantId: string, ausloeser: "zeitplan" | "knopf", jetzt = new Date()): Promise<{ ok: boolean; text: string; laufId: string | null; belegt?: boolean }> {
  const z = await zugang(tenantId);
  if (!z) return { ok: false, text: "BQool-Anmeldung für die Automatik fehlt (Anbindungen → BQool – Anmeldung: E-Mail, Passwort, Upload-Seite DE).", laufId: null };
  const s = await getSettings(tenantId);
  const laender = s.bqool.laender as string[];
  const [neu] = await db.insert(K).values({ tenantId, tag: tagBerlin(jetzt), ausloeser, phase: "ist" }).returning({ id: K.id });
  const id = neu.id;
  // 1. Ist holen
  const ist = await istHolen(tenantId, laender, id, "ist");
  if (ist.belegt) {
    await db.delete(K).where(and(eq(K.tenantId, tenantId), eq(K.id, id)));
    return { ok: false, belegt: true, text: "Es läuft gerade eine andere Browser-Automatik – der BQool-Lauf startet beim nächsten Takt.", laufId: null };
  }
  if (ist.abgebrochen) {
    await aendern(tenantId, id, { phase: "abgebrochen", fehler: ist.abgebrochen });
    await pushen(tenantId, { titel: "BQool-Lauf abgebrochen", text: `${ist.abgebrochen.slice(0, 200)} – Aufgabe mit Bildschirmfoto liegt bereit.`, link: LINK });
    return { ok: false, text: `BQool-Lauf abgebrochen: ${ist.abgebrochen}`, laufId: id };
  }
  // B31.6: Liquidation wegen Min unter Marge – aktiv/Test/Rückkehr-Vorschlag auf Basis des frischen Ist
  await import("./liquidation").then((x) => x.liquidationenPflegen(tenantId, tagBerlin(jetzt))).catch((e) => console.error("[BQool] Liquidation:", e instanceof Error ? e.message : e));
  // 2. Soll erzeugen (nur Änderungen) auf Basis des frischen Ist
  await aendern(tenantId, id, { phase: "soll" });
  const { bqoolExportErzeugen } = await import("./export-service");
  const e = await bqoolExportErzeugen(tenantId, null, { laender: laender as ExportLand[], nurAenderungen: true });
  const zus = e.zusammenfassung;
  const istFehlt = ist.jeLand.filter((x) => !x.ok);
  const istHinweis = ist.nichtEingerichtet ? " Ist nicht aktualisiert (keine Export-Seite eingetragen)." : istFehlt.length ? ` Ist fehlt für ${istFehlt.map((x) => x.land).join(", ")} – Vergleich mit dem letzten Stand.` : "";
  await aendern(tenantId, id, { exportId: e.id, zusammenfassung: zus }, `Soll erzeugt: ${zus.gesamt ? freigabeText(zus) : "keine Änderungen"}`);
  if (!zus.gesamt) {
    await aendern(tenantId, id, { phase: "fertig", freigabe: "nicht_noetig" }, "Nichts hochzuladen – alle Min/Regeln wie in BQool.");
    await recordJobHinweis(tenantId, JOB_UPLOAD, `keine Änderungen (${uhrBerlin(jetzt)})`, ABRUF_PLAN[JOB_UPLOAD]);
    return { ok: true, text: `BQool: keine Änderungen – nichts hochzuladen.${istHinweis}`, laufId: id };
  }
  // 3. Freigabe – automatisch nur, wenn eingeschaltet und ohne Regelwechsel / Min unter Break-even
  const k = s.bqool.kreislauf;
  const af = autoFreigabe({ automatisch: k.automatisch, minGeprueft: k.minGeprueft, regelWechsel: zus.regelWechsel, unterBreakEven: zus.unterBreakEven });
  if (af.ok) {
    await aendern(tenantId, id, { phase: "upload", freigabe: "automatisch", freigabeAm: new Date(), freigabeVon: "automatisch" }, af.grund);
    const h = await hochladen(tenantId, id);
    return { ok: h.ok, text: `BQool automatisch hochgeladen: ${h.text}`, laufId: id };
  }
  await aendern(tenantId, id, { phase: "freigabe", freigabe: "offen" }, af.grund);
  const f = freigabeFristen(new Date());
  await upsertSystemTask(db, tenantId, TASK_FREIGABE, {
    title: `BQool-Upload freigeben: ${freigabeText(zus)}`.slice(0, 200),
    notes: `${af.grund}.${istHinweis}\nAuf Repricer → BQool-Dateien „Freigeben und hochladen“ drücken (oder im Push). Ohne Freigabe wird nichts hochgeladen; bis ${uhrBerlin(f.verfall)} Uhr, danach verfällt der Lauf.`,
    priority: "critical",
    category: "amazon",
    link: `/repricer/bqool?lauf=${id}#freigabe`,
  });
  await pushen(tenantId, {
    titel: "BQool-Upload freigeben",
    text: `${freigabeText(zus)}.${istHinweis}`.slice(0, 300),
    link: `/repricer/bqool?lauf=${id}#freigabe`,
    aktionen: [
      { aktion: "freigeben", titel: "Freigeben", link: `/repricer/bqool?lauf=${id}&freigeben=1#freigabe` },
      { aktion: "ansehen", titel: "Ansehen", link: `/repricer/bqool?export=${e.id}` },
    ],
  });
  return { ok: true, text: `BQool: Freigabe angefragt – ${freigabeText(zus)}.${istHinweis}`, laufId: id };
}

/** Upload je Land (nach Freigabe bzw. automatisch), Rückmeldung speichern, Nachkontrolle in 30 Minuten vormerken. */
async function hochladen(tenantId: string, id: string): Promise<{ ok: boolean; text: string; belegt?: boolean }> {
  const l = await lauf(tenantId, id);
  if (!l?.exportId) return { ok: false, text: "Kein Export zum Lauf." };
  await aendern(tenantId, id, { phase: "upload", uploadStatus: "laeuft" });
  const t0 = Date.now();
  const { anBqoolUebertragen } = await import("@/lib/automatik/uebertragen");
  let r: Awaited<ReturnType<typeof anBqoolUebertragen>>;
  try {
    r = await anBqoolUebertragen(tenantId, l.exportId);
  } catch (e) {
    // Nie auf „Upload läuft“ hängen bleiben – Fehler festhalten, Freigabe bleibt erledigt (kein zweiter Upload von selbst).
    const text = `Upload abgebrochen: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
    await aendern(tenantId, id, { uploadStatus: "fehler", uploadAm: new Date(), phase: "fertig", fehler: text }, text);
    await recordJob(tenantId, JOB_UPLOAD, text, Date.now() - t0, ABRUF_PLAN[JOB_UPLOAD]);
    return { ok: false, text };
  }
  if (r.belegt) {
    await aendern(tenantId, id, { uploadStatus: null }, "Upload: Browser gerade belegt – nächster Versuch beim nächsten Takt");
    return { ok: false, belegt: true, text: "Es läuft gerade eine andere Browser-Automatik – der Upload startet beim nächsten Takt." };
  }
  const { bqoolErgebnisText } = await import("@/lib/automatik/bqool-logic");
  const upload: BqoolUploadLand[] = (r.ergebnis ?? []).map((x) => ({ land: x.land, ok: x.ok, zeilen: x.zeilen, uebernommen: x.uebernommen ?? null, fehler: x.fehlerAnzahl ?? null, fehlerZeilen: x.fehlerZeilen ?? [], text: bqoolErgebnisText([x]), ...(x.unklar ? { unklar: true } : {}) }));
  const [ex] = await db.select({ status: schema.bqoolExporte.uebertragung }).from(schema.bqoolExporte).where(and(eq(schema.bqoolExporte.tenantId, tenantId), eq(schema.bqoolExporte.id, l.exportId)));
  const status = ex?.status && ex.status !== "laeuft" ? ex.status : r.ok ? "fertig" : "fehler";
  const etwasHoch = upload.some((x) => x.ok || x.unklar);
  const jetzt = new Date();
  await aendern(tenantId, id, { upload, uploadStatus: status, uploadAm: jetzt, phase: etwasHoch ? "kontrolle" : "fertig", kontrolleFaelligAm: etwasHoch ? new Date(jetzt.getTime() + KONTROLLE_MINUTEN * 60_000) : null, fehler: r.ok ? null : r.text.slice(0, 300) }, `Upload: ${r.text}`);
  await resolveSystemTask(db, tenantId, TASK_FREIGABE);
  const u = uebernommenJeLand(upload);
  await recordJob(tenantId, JOB_UPLOAD, status === "fehler" ? r.text : null, Date.now() - t0, ABRUF_PLAN[JOB_UPLOAD]);
  return { ok: r.ok, text: etwasHoch ? `${jeLandText(u.jeLand)} übernommen, ${u.fehler} Fehler${status === "pruefen" ? " – Bestätigung bitte in BQool prüfen" : ""}. Nachkontrolle in ${KONTROLLE_MINUTEN} Minuten.` : r.text };
}

/** Freigabe (Knopf auf der Seite bzw. aus dem Push) – lädt sofort hoch. */
export async function kreislaufFreigeben(tenantId: string, id: string, wer: string, jetzt = new Date()): Promise<{ ok: boolean; text: string }> {
  const l = await lauf(tenantId, id);
  if (!l) return { ok: false, text: "Lauf nicht gefunden." };
  if (l.freigabe !== "offen") return { ok: false, text: l.freigabe === "verfallen" ? "Der Lauf ist verfallen – morgen 06:00 kommt ein neuer (oder „Jetzt starten“)." : l.freigabe === "abgelehnt" ? "Für heute abgelehnt." : "Schon freigegeben." };
  if (jetzt >= freigabeFristen(l.createdAt).verfall) {
    await verfallen(tenantId, l);
    return { ok: false, text: "Der Lauf ist verfallen – morgen 06:00 kommt ein neuer (oder „Jetzt starten“)." };
  }
  await aendern(tenantId, id, { freigabe: "freigegeben", freigabeAm: jetzt, freigabeVon: wer.slice(0, 120) }, `Freigegeben von ${wer}`);
  const h = await hochladen(tenantId, id);
  return { ok: h.ok || Boolean(h.belegt), text: h.belegt ? h.text : `Freigegeben und hochgeladen: ${h.text}` };
}

/** „Heute nicht hochladen“ – nichts geht zu BQool, der Lauf ist erledigt. */
export async function kreislaufAblehnen(tenantId: string, id: string, wer: string): Promise<boolean> {
  const l = await lauf(tenantId, id);
  if (!l || l.freigabe !== "offen") return false;
  await aendern(tenantId, id, { freigabe: "abgelehnt", phase: "fertig" }, `Heute nicht hochladen (${wer})`);
  await resolveSystemTask(db, tenantId, TASK_FREIGABE);
  return true;
}

async function verfallen(tenantId: string, l: BqoolLauf) {
  await aendern(tenantId, l.id, { freigabe: "verfallen", phase: "verfallen" }, `Keine Freigabe bis ${uhrBerlin(freigabeFristen(l.createdAt).verfall)} – Lauf verfallen, nichts hochgeladen.`);
  await resolveSystemTask(db, tenantId, TASK_FREIGABE);
  await recordJobHinweis(tenantId, JOB_UPLOAD, "nicht freigegeben – Lauf verfallen", ABRUF_PLAN[JOB_UPLOAD]);
}

async function erinnern(tenantId: string, l: BqoolLauf) {
  await aendern(tenantId, l.id, { erinnertAm: new Date() }, "Erinnerung an die Freigabe geschickt");
  const f = freigabeFristen(l.createdAt);
  await pushen(tenantId, {
    titel: "Erinnerung: BQool-Upload freigeben",
    text: `${l.zusammenfassung ? freigabeText(l.zusammenfassung) : "Änderungen"} – ohne Freigabe verfällt der Lauf um ${uhrBerlin(f.verfall)} Uhr.`,
    link: `/repricer/bqool?lauf=${l.id}#freigabe`,
    aktionen: [{ aktion: "freigeben", titel: "Freigeben", link: `/repricer/bqool?lauf=${l.id}&freigeben=1#freigabe` }],
  });
}

/** Nachkontrolle: Ist der hochgeladenen Länder erneut holen und Min/Regel je SKU gegen die Datei prüfen. */
export async function nachkontrolleAusfuehren(tenantId: string, id: string): Promise<{ ok: boolean; text: string; belegt?: boolean }> {
  const l = await lauf(tenantId, id);
  if (!l?.exportId || l.kontrolleAm) return { ok: false, text: "Keine Nachkontrolle offen." };
  const laender = (l.upload ?? []).filter((x) => x.ok || x.unklar).map((x) => x.land);
  const t0 = Date.now();
  if (!laender.length) {
    await aendern(tenantId, id, { kontrolleAm: new Date(), phase: "fertig", kontrolle: { geprueft: 0, ok: 0, abweichungen: [], text: "Nichts hochgeladen – nichts zu prüfen." } });
    return { ok: true, text: "Nichts hochgeladen – nichts zu prüfen." };
  }
  const ist = await istHolen(tenantId, laender, id, "kontrolle");
  if (ist.belegt) return { ok: false, belegt: true, text: "Browser gerade belegt – Nachkontrolle beim nächsten Takt." };
  if (ist.abgebrochen || ist.nichtEingerichtet) {
    const text = `Nachkontrolle nicht möglich: ${ist.abgebrochen ?? "keine Export-Seite eingetragen"}`;
    await aendern(tenantId, id, { kontrolleAm: new Date(), phase: "fertig", kontrolle: { geprueft: 0, ok: 0, abweichungen: [], text } }, text);
    await recordJob(tenantId, JOB_KONTROLLE, text, Date.now() - t0, ABRUF_PLAN[JOB_KONTROLLE]);
    return { ok: false, text };
  }
  const geholt = ist.jeLand.filter((x) => x.ok).map((x) => x.land);
  const [e] = await db.select({ zeilen: schema.bqoolExporte.zeilen }).from(schema.bqoolExporte).where(and(eq(schema.bqoolExporte.tenantId, tenantId), eq(schema.bqoolExporte.id, l.exportId)));
  // Zeilen, die BQool schon beim Upload als Fehler gemeldet hat, stehen in der Fehler-Aufgabe – hier nicht doppelt.
  const fehlerSkus = new Set((l.upload ?? []).flatMap((x) => x.fehlerZeilen.map((f) => `${x.land}|${f.sku}`)));
  const hoch = (e?.zeilen ?? []).filter((z) => geholt.includes(z.land) && !fehlerSkus.has(`${z.land}|${z.sku}`));
  const L = schema.bqoolListings;
  const istRows = hoch.length ? await db.select({ land: L.marktplatz, sku: L.sku, regel: L.regel, min: L.min }).from(L).where(and(eq(L.tenantId, tenantId), inArray(L.marktplatz, geholt), inArray(L.sku, [...new Set(hoch.map((z) => z.sku))]))) : [];
  const k = nachkontrolle(hoch, new Map(istRows.map((r) => [`${r.land}|${r.sku}`, { regel: r.regel, min: r.min }])));
  const ohneIst = laender.filter((x) => !geholt.includes(x));
  const text = `${k.text}${ohneIst.length ? ` Nicht geprüft: ${ohneIst.join(", ")} (Ist nicht geholt).` : ""}`;
  await aendern(tenantId, id, { kontrolleAm: new Date(), phase: "fertig", kontrolle: { ...k, text } }, `Nachkontrolle: ${text}`);
  if (k.abweichungen.length) {
    await upsertSystemTask(db, tenantId, TASK_KONTROLLE, {
      title: `BQool-Nachkontrolle: ${k.abweichungen.length} Abweichung${k.abweichungen.length === 1 ? "" : "en"}`,
      notes: `${k.abweichungen.slice(0, 40).map((a) => `${a.land} ${a.sku}: ${a.text}`).join("\n")}${k.abweichungen.length > 40 ? `\n… und ${k.abweichungen.length - 40} weitere` : ""}\nIn BQool nachsehen – das System ändert dort nichts von selbst.`,
      priority: "critical",
      category: "amazon",
      link: `/repricer/bqool?lauf=${id}#freigabe`,
    });
    await pushen(tenantId, { titel: "BQool-Nachkontrolle: Abweichungen", text: text.slice(0, 300), link: `/repricer/bqool?lauf=${id}#freigabe` });
  } else await resolveSystemTask(db, tenantId, TASK_KONTROLLE);
  await recordJob(tenantId, JOB_KONTROLLE, null, Date.now() - t0, ABRUF_PLAN[JOB_KONTROLLE]);
  if (k.abweichungen.length) await recordJobHinweis(tenantId, JOB_KONTROLLE, text.slice(0, 300), ABRUF_PLAN[JOB_KONTROLLE]);
  return { ok: !k.abweichungen.length, text };
}

/**
 * Takt aus dem Hintergrund (alle 5 Minuten, nicht bei „Jetzt alles abrufen“): Erinnerung/Verfall offener
 * Freigaben, wartende Uploads, fällige Nachkontrollen, ab 06:00 der Lauf des Tages (einmal je Tag, steht in der
 * Datenbank – auch nach einem Neustart kein zweiter).
 */
export async function kreislaufTakt(tenantId: string, jetzt = new Date()): Promise<void> {
  const z = await zugang(tenantId);
  if (!z || z.kreislauf === "aus") return;
  for (const l of await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.freigabe, "offen")))) {
    const f = freigabeFristen(l.createdAt);
    if (jetzt >= f.verfall) await verfallen(tenantId, l);
    else if (jetzt >= f.erinnerung && !l.erinnertAm) await erinnern(tenantId, l);
  }
  for (const l of await db.select().from(K).where(and(eq(K.tenantId, tenantId), inArray(K.freigabe, ["freigegeben", "automatisch"]), eq(K.phase, "upload"), isNull(K.uploadStatus), isNull(K.uploadAm)))) {
    const h = await hochladen(tenantId, l.id);
    if (h.belegt) return;
  }
  for (const l of await db.select().from(K).where(and(eq(K.tenantId, tenantId), lte(K.kontrolleFaelligAm, jetzt), isNull(K.kontrolleAm)))) {
    const k = await nachkontrolleAusfuehren(tenantId, l.id);
    if (k.belegt) return;
  }
  if (uhrBerlin(jetzt) >= KREISLAUF_UHRZEIT && !(await laufVomTag(tenantId, tagBerlin(jetzt)))) await kreislaufStarten(tenantId, "zeitplan", jetzt);
}

/** Stand für Seite, Werkzeuge und Morgenbericht: heutiger und gestriger Lauf, letzter Ist-Abruf je Land, letzter Upload. */
export async function kreislaufStand(tenantId: string, jetzt = new Date()) {
  const L = schema.bqoolListings;
  const [heute, gestern, ist, letzterUpload, z] = await Promise.all([
    laufVomTag(tenantId, tagBerlin(jetzt)),
    laufVomTag(tenantId, tagBerlin(new Date(jetzt.getTime() - 86_400_000))),
    db.select({ land: L.marktplatz, am: sql<Date>`max(${L.eingelesenAm})` }).from(L).where(eq(L.tenantId, tenantId)).groupBy(L.marktplatz),
    db.select().from(K).where(and(eq(K.tenantId, tenantId), sql`${K.uploadAm} is not null`)).orderBy(desc(K.uploadAm)).limit(1),
    getIntegration(tenantId, "bqool_web"),
  ]);
  return {
    eingerichtet: Boolean(z?.email && z.password && z.uploadUrl),
    exportSeite: Boolean(z?.exportUrl),
    aus: z?.kreislauf === "aus",
    heute,
    gestern,
    istJeLand: ist.map((x) => ({ land: x.land, am: x.am ? new Date(x.am) : null })),
    letzterUpload: letzterUpload[0] ?? null,
  };
}
