import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { dateiVerschieben, driveAccess, inPapierkorb, ordnerSichern, type DriveAccess, type DriveFile } from "@/lib/integrations/clients/drive";
import { getIntegration } from "@/lib/integrations/store";
import { dubletteVon, lieferantAusText, nummerNorm, zielName, zielOrdner, type BelegFakten, type Vorhanden } from "./ablage-logic";

// B34.2 Drive-Rechnungsordner: neue Dateien direkt im Ordner bekommen einen Vorschlag (umbenennen nach
// JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr, ablegen in Monat/Lieferant; Kontoauszug → „Kontoauszüge/JJJJ-MM“ und
// importieren statt als Rechnung; Dublette → „Dubletten“). Ausgeführt wird nur nach Freigabe (Charge) und nur, wenn der
// Inhaber das Schreibrecht eingeschaltet hat und das Dienstkonto Bearbeiter ist. Gelöscht wird nie – eine Dublette
// kommt höchstens nach eigener Freigabe in den Drive-Papierkorb (30 Tage wiederherstellbar).

const D = schema.driveAblage;
const I = schema.invoices;
export type DriveZeile = typeof D.$inferSelect;
export const DRIVE_CHARGE_MAX = 50;
export class DriveAblageFehler extends Error {}

const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const endungVon = (n: string) => (/\.[a-z0-9]{2,5}$/i.exec(n)?.[0] ?? ".pdf").toLowerCase();

// ---- Einstellung: Schreibrecht (Inhaber) ------------------------------------------------------------------------

export type DriveAblageEinstellung = { schreiben: boolean; geaendertAm: string | null };

export async function driveEinstellung(tenantId: string): Promise<DriveAblageEinstellung> {
  const [t] = await db.select({ s: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const roh = ((t?.s ?? {}) as { driveAblage?: Partial<DriveAblageEinstellung> }).driveAblage ?? {};
  return { schreiben: roh.schreiben === true, geaendertAm: roh.geaendertAm ?? null };
}

export async function driveSchreibenSetzen(s: Session, an: boolean) {
  if (s.role !== "owner" || s.readOnly) throw new DriveAblageFehler("Nur der Inhaber gibt das Umbenennen/Verschieben in Drive frei.");
  const neu: DriveAblageEinstellung = { schreiben: an, geaendertAm: new Date().toISOString() };
  await db.update(schema.tenants).set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('driveAblage', ${JSON.stringify(neu)}::jsonb)` }).where(eq(schema.tenants.id, s.tenantId));
  return neu;
}

// ---- Vorschläge beim Lesen des Ordners --------------------------------------------------------------------------

async function eigeneNamen(tenantId: string): Promise<string[]> {
  const { getSettings } = await import("@/lib/settings");
  const st = await getSettings(tenantId);
  return [st.b2b?.firma?.name, st.b2b?.firma?.handelsname, ...(st.buchhaltung?.firmen ?? [])].filter((x): x is string => !!x && x.trim().length >= 3);
}

async function bekannteLieferanten(tenantId: string): Promise<string[]> {
  const rows = await db.select({ name: schema.suppliers.name }).from(schema.suppliers).where(eq(schema.suppliers.tenantId, tenantId)).limit(2000);
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}

/** Vergleichsbasis für Dubletten: frühere Drive-Vorschläge (nicht verworfen), Download-Ordner, Rechnungen. */
async function vorhandene(tenantId: string, hash: string | null, nummer: string | null, betrag: number | null, ohneRechnung?: string | null): Promise<Vorhanden[]> {
  const n = nummerNorm(nummer);
  const mitNr = n.length >= 3 && betrag !== null;
  const out: Vorhanden[] = [];
  const drive = await db
    .select({ id: D.id, hash: D.hash, nummer: D.nummer, betrag: D.betrag })
    .from(D)
    .where(and(eq(D.tenantId, tenantId), ne(D.zustand, "verworfen"), inArray(D.vorschlag, ["ablegen", "kontoauszug"]), sql`(${hash ? sql`${D.hash} = ${hash}` : sql`false`}${mitNr ? sql` or upper(regexp_replace(coalesce(${D.nummer}, ''), '[^A-Za-z0-9]', '', 'g')) = ${n}` : sql``})`))
    .limit(20);
  out.push(...drive.map((r) => ({ ...r, id: `drive:${r.id}` })));
  if (hash) {
    const ordner = await db.select({ id: schema.belegAblage.id, hash: schema.belegAblage.hash }).from(schema.belegAblage).where(and(eq(schema.belegAblage.tenantId, tenantId), eq(schema.belegAblage.hash, hash), eq(schema.belegAblage.status, "ablegen"))).limit(5);
    out.push(...ordner.map((r) => ({ id: `ordner:${r.id}`, hash: r.hash, nummer: null, betrag: null })));
  }
  if (mitNr || hash) {
    const re = await db
      .select({ id: I.id, ext: I.externalId, source: I.source, nummer: I.invoiceNumber, betrag: I.totalGross })
      .from(I)
      .where(and(eq(I.tenantId, tenantId), ne(I.status, "ignored"), ohneRechnung ? ne(I.id, ohneRechnung) : undefined, sql`(${hash ? sql`(${I.source} = 'ordner' and ${I.externalId} = ${hash})` : sql`false`}${mitNr ? sql` or (upper(regexp_replace(coalesce(${I.invoiceNumber}, ''), '[^A-Za-z0-9]', '', 'g')) = ${n} and abs(${I.totalGross}) = ${Math.abs(betrag!)})` : sql``})`))
      .limit(20);
    out.push(...re.map((r) => ({ id: `rechnung:${r.id}`, hash: r.source === "ordner" ? r.ext : null, nummer: r.nummer, betrag: r.betrag })));
  }
  return out;
}

/**
 * Eine neue Datei direkt im Rechnungsordner: Vorschlag anlegen. Gibt zurück, ob sie als Rechnung eingelesen wurde
 * (Kontoauszug und Dublette nicht – keine doppelte Rechnung, kein Kontoauszug als Rechnung).
 */
export async function driveDateiVorschlagen(tenantId: string, f: DriveFile, bytes: Buffer): Promise<{ vorschlag: DriveZeile["vorschlag"]; rechnung: boolean }> {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { pdfText, ingestInvoice } = await import("@/lib/invoices/service");
  const text = await pdfText(bytes);
  const basis = { tenantId, dateiId: f.id, dateiname: f.name.slice(0, 250), hash };
  const neu = async (v: Omit<typeof D.$inferInsert, "tenantId" | "dateiId" | "dateiname" | "hash">) => {
    await db.insert(D).values({ ...basis, ...v }).onConflictDoNothing();
  };

  const gleich = dubletteVon({ hash, nummer: null, betrag: null }, await vorhandene(tenantId, hash, null, null));
  if (gleich) {
    await neu({ art: "beleg", vorschlag: "dublette", dubletteVon: gleich.id, dubletteGrund: gleich.grund, zielOrdner: "Dubletten", zielName: f.name.slice(0, 250) });
    return { vorschlag: "dublette", rechnung: false };
  }
  const { istKontoauszugText, pdfArt } = await import("@/lib/uploads/erkennen");
  if (text && istKontoauszugText(text)) {
    const monat = (/(\d{2})\.(\d{2})\.(\d{4})/.exec(text)?.slice(1) ?? []).reverse().slice(0, 2).join("-") || (f.createdTime || heute()).slice(0, 7);
    await neu({ art: "kontoauszug", vorschlag: "kontoauszug", zielOrdner: `Kontoauszüge/${monat}`, zielName: f.name.slice(0, 250) });
    return { vorschlag: "kontoauszug", rechnung: false };
  }
  const { extractInvoiceFacts } = await import("@/lib/invoices/parse");
  const { analyzeNew } = await import("@/lib/invoices/review");
  const fa = extractInvoiceFacts(text);
  const fakten: BelegFakten = {
    lieferant: lieferantAusText(text, { bekannt: await bekannteLieferanten(tenantId), eigene: await eigeneNamen(tenantId) }),
    datum: analyzeNew(text, f.name).invoiceDate ?? fa.invoiceDate ?? null,
    betrag: fa.totalGross,
    nummer: fa.invoiceNumber,
  };
  const felder = { lieferant: fakten.lieferant, datum: fakten.datum, betrag: fakten.betrag, nummer: fakten.nummer };
  const d = dubletteVon({ hash, nummer: fakten.nummer, betrag: fakten.betrag }, await vorhandene(tenantId, hash, fakten.nummer, fakten.betrag));
  if (d) {
    await neu({ art: "rechnung", vorschlag: "dublette", dubletteVon: d.id, dubletteGrund: d.grund, zielOrdner: "Dubletten", zielName: f.name.slice(0, 250), ...felder });
    return { vorschlag: "dublette", rechnung: false };
  }
  const inv = await ingestInvoice({ tenantId, source: "drive", externalId: f.id, fileName: f.name, bytes, storeBytes: false, vendor: fakten.lieferant });
  if (text.trim() && pdfArt(text) !== "beleg") {
    await neu({ art: "sonstiges", vorschlag: "liegen_lassen", zustand: "verworfen", invoiceId: inv.id, meldung: "kein Beleg erkannt – bleibt liegen", ...felder });
    return { vorschlag: "liegen_lassen", rechnung: true };
  }
  await neu({ art: "rechnung", vorschlag: "ablegen", invoiceId: inv.id, zielOrdner: zielOrdner(fakten, (f.createdTime || heute()).slice(0, 10)), zielName: zielName(fakten, endungVon(f.name)), ...felder });
  return { vorschlag: "ablegen", rechnung: true };
}

/** IDs aller Dateien, die schon einen Drive-Vorschlag haben (für den Abruf: nicht noch einmal laden). */
export async function driveBekannt(tenantId: string): Promise<Set<string>> {
  return new Set((await db.select({ id: D.dateiId }).from(D).where(eq(D.tenantId, tenantId))).map((r) => r.id));
}

/**
 * Bestand: Dateien, die schon früher als Rechnung eingelesen wurden und noch direkt im Ordner liegen, bekommen einen
 * Vorschlag aus den gelesenen Rechnungsdaten (ohne erneuten Download).
 */
export async function driveBestandVorschlagen(tenantId: string, files: DriveFile[], max = 100): Promise<number> {
  const bekannt = await driveBekannt(tenantId);
  const imOrdner = files.filter((f) => (f.pfad ?? "") === "" && !bekannt.has(f.id)).sort((a, b) => (a.createdTime < b.createdTime ? -1 : 1));
  if (!imOrdner.length) return 0;
  const rechnungen = await db
    .select({ id: I.id, ext: I.externalId, vendor: I.vendor, datum: I.invoiceDate, betrag: I.totalGross, nummer: I.invoiceNumber, docType: I.docType })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), eq(I.source, "drive"), inArray(I.externalId, imOrdner.map((f) => f.id))));
  const je = new Map(rechnungen.map((r) => [r.ext, r]));
  let n = 0;
  for (const f of imOrdner) {
    if (n >= max) break;
    const r = je.get(f.id);
    if (!r) continue;
    const fakten: BelegFakten = { lieferant: r.vendor, datum: r.datum, betrag: r.betrag, nummer: r.nummer };
    const felder = { lieferant: fakten.lieferant, datum: fakten.datum, betrag: fakten.betrag, nummer: fakten.nummer, invoiceId: r.id };
    const d = dubletteVon({ hash: `-${f.id}`, nummer: fakten.nummer, betrag: fakten.betrag }, await vorhandene(tenantId, null, fakten.nummer, fakten.betrag, r.id));
    const basis = { tenantId, dateiId: f.id, dateiname: f.name.slice(0, 250), hash: null };
    await db
      .insert(D)
      .values(d ? { ...basis, art: "rechnung", vorschlag: "dublette", dubletteVon: d.id, dubletteGrund: d.grund, zielOrdner: "Dubletten", zielName: f.name.slice(0, 250), ...felder } : { ...basis, art: "rechnung", vorschlag: "ablegen", zielOrdner: zielOrdner(fakten, (f.createdTime || heute()).slice(0, 10)), zielName: zielName(fakten, endungVon(f.name)), ...felder })
      .onConflictDoNothing();
    n++;
  }
  return n;
}

// ---- Oberfläche -------------------------------------------------------------------------------------------------

export async function driveListe(tenantId: string, limit = 300) {
  return db.select().from(D).where(eq(D.tenantId, tenantId)).orderBy(desc(D.createdAt)).limit(limit);
}

export async function driveZeile(tenantId: string, id: string) {
  const [z] = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  return z ?? null;
}

async function zugang(tenantId: string): Promise<DriveAccess> {
  const a = await driveAccess(await getIntegration(tenantId, "google_drive"));
  if (!a) throw new DriveAblageFehler("Google Drive ist noch nicht eingerichtet (Anbindungen → Google Drive).");
  return a;
}

async function schreibZugang(s: Session) {
  if (s.role !== "owner" || s.readOnly) throw new DriveAblageFehler("Nur der Inhaber gibt die Ablage in Drive frei.");
  if (!(await driveEinstellung(s.tenantId)).schreiben) throw new DriveAblageFehler("Umbenennen/Verschieben in Drive ist noch nicht freigegeben – erst oben einschalten (Schreibrecht).");
  const a = await zugang(s.tenantId);
  if (!a.schreiben) throw new DriveAblageFehler("Zum Ablegen braucht es das Dienstkonto (Anbindungen → Google Drive: Schlüssel + Ordner-ID) mit Bearbeiter-Recht auf den Ordner – über den Freigabelink geht nur Lesen.");
  return { a, ...(await a.schreiben()) };
}

/** PDF der Datei für die Vorschau (aus Drive gelesen, nichts gespeichert). */
export async function driveVorschauPdf(tenantId: string, id: string): Promise<{ name: string; bytes: Buffer } | null> {
  const z = await driveZeile(tenantId, id);
  if (!z) return null;
  return { name: z.dateiname, bytes: await (await zugang(tenantId)).download(z.dateiId) };
}

/**
 * Freigabe (Charge bis 50): ausgewählte Vorschläge in Drive ausführen – Unterordner anlegen, verschieben, umbenennen;
 * Kontoauszüge vorher importieren (Bank/PayPal). Nichts wird gelöscht.
 */
export async function driveFreigeben(s: Session, ids: string[] | "alle"): Promise<{ ok: number; fehler: number; text: string }> {
  const { a, token, wurzel } = await schreibZugang(s);
  const zeilen = await db
    .select()
    .from(D)
    .where(and(eq(D.tenantId, s.tenantId), inArray(D.zustand, ["vorschlag", "fehler"]), notInArray(D.vorschlag, ["liegen_lassen"]), ids === "alle" ? undefined : inArray(D.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])))
    .orderBy(D.createdAt)
    .limit(DRIVE_CHARGE_MAX);
  if (!zeilen.length) return { ok: 0, fehler: 0, text: "Nichts ausgewählt." };
  const cache = new Map<string, string>();
  let ok = 0;
  let fehler = 0;
  for (const z of zeilen) {
    try {
      let ordner = z.zielOrdner ?? "Dubletten";
      let meldung = "";
      if (z.vorschlag === "kontoauszug") {
        const { dateiHochladen } = await import("@/lib/uploads/service");
        const r = (await dateiHochladen(s, z.dateiname, await a.download(z.dateiId), { art: "kontoauszug", firma: null, saldo: null }))[0];
        const bis = (r?.details as { konto?: { bis?: string | null } } | undefined)?.konto?.bis;
        if (bis) ordner = `Kontoauszüge/${String(bis).slice(0, 7)}`;
        meldung = r?.ok ? `importiert: ${r.text}`.slice(0, 200) : `nicht importiert: ${r?.text ?? "?"}`.slice(0, 200);
      }
      const ziel = await ordnerSichern(token, wurzel, ordner, cache);
      const umbenennen = z.vorschlag === "ablegen" && z.zielName && z.zielName !== z.dateiname ? z.zielName : null;
      await dateiVerschieben(token, z.dateiId, ziel, umbenennen);
      await db
        .update(D)
        .set({ zustand: "erledigt", zielOrdner: ordner, freigegebenAm: new Date(), freigegebenVon: s.userId, ausgefuehrtAm: new Date(), meldung: `${ordner}/${umbenennen ?? z.dateiname}${meldung ? ` · ${meldung}` : ""}`.slice(0, 500) })
        .where(eq(D.id, z.id));
      ok++;
    } catch (e) {
      fehler++;
      await db.update(D).set({ zustand: "fehler", freigegebenAm: new Date(), freigegebenVon: s.userId, meldung: (e as Error).message.slice(0, 400) }).where(eq(D.id, z.id));
    }
  }
  return { ok, fehler, text: `${ok} in Drive abgelegt${fehler ? `, ${fehler} mit Fehler (siehe Liste)` : ""} – nichts gelöscht.` };
}

/** Vorschlag verwerfen (Datei bleibt, wo sie ist). */
export async function driveVerwerfen(s: Session, ids: string[]): Promise<number> {
  if (s.readOnly || !ids.length) return 0;
  return (await db.update(D).set({ zustand: "verworfen" }).where(and(eq(D.tenantId, s.tenantId), inArray(D.id, ids), inArray(D.zustand, ["vorschlag", "fehler"]))).returning({ id: D.id })).length;
}

/** Dubletten (schon im Ordner „Dubletten“) nach Freigabe in den Drive-Papierkorb – 30 Tage wiederherstellbar. */
export async function driveDublettenPapierkorb(s: Session, ids: string[] | "alle"): Promise<number> {
  const { token } = await schreibZugang(s);
  const zeilen = await db
    .select()
    .from(D)
    .where(and(eq(D.tenantId, s.tenantId), eq(D.vorschlag, "dublette"), eq(D.zustand, "erledigt"), isNull(D.papierkorbAm), ids === "alle" ? undefined : inArray(D.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])))
    .limit(DRIVE_CHARGE_MAX);
  let n = 0;
  for (const z of zeilen) {
    await db.update(D).set({ loeschenFreigegebenAm: new Date(), loeschenFreigegebenVon: s.userId }).where(eq(D.id, z.id));
    try {
      await inPapierkorb(token, z.dateiId);
      await db.update(D).set({ papierkorbAm: new Date(), meldung: "nach Freigabe in den Drive-Papierkorb (30 Tage wiederherstellbar)" }).where(eq(D.id, z.id));
      n++;
    } catch (e) {
      await db.update(D).set({ meldung: (e as Error).message.slice(0, 400) }).where(eq(D.id, z.id));
    }
  }
  return n;
}
