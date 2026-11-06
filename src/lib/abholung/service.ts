import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AbholOrt } from "@/db/schema";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { berlinMidnight } from "@/lib/today/service";
import {
  abholungPruefen,
  abholZusammenfassung,
  berlinHeute,
  datumLesen,
  datumText,
  DIENST_NAME,
  fensterLesen,
  fensterVon,
  naechsterAbholtag,
  ortFinden,
  vorschlagNoetig,
  zeitNorm,
  type AbholDienst,
  type AbholEingabe,
} from "./logic";

// Bauauftrag Abholung DHL/UPS: buchen (Seite, Claude, Vorschlag), stornieren über denselben Weg, Protokoll je Abholung
// und der Abend-Vorschlag „Abholung buchen?“ (nie automatisch buchen).

const A = schema.abholungen;
export type Wer = { userId: string | null; name: string };
export type AbholWunsch = {
  dienst: AbholDienst;
  /** „morgen“, „Montag“, „7.11.“ oder JJJJ-MM-TT; leer = nächster Abholtag. */
  datum?: string | null;
  /** „10-12“ / „10 bis 12 Uhr“ – oder von/bis einzeln; leer = Standardfenster des Abholorts. */
  fenster?: string | null;
  von?: string | null;
  bis?: string | null;
  pakete: number;
  paletten?: number | null;
  gewichtKg?: number | null;
  hinweis?: string | null;
  /** Schlüssel oder Name des Abholorts („LuGru“); leer = Standardort. */
  ort?: string | null;
};

export type Vorbereitet =
  | { ok: true; eingabe: AbholEingabe; zusammenfassung: string; hinweise: string[] }
  | { ok: false; fehler: string[]; hinweise: string[]; zusammenfassung?: string; orte: string[] };

export async function abholOrte(tenantId: string): Promise<AbholOrt[]> {
  return (await getSettings(tenantId)).abholung.orte;
}

/** Wunsch lesen und prüfen (ohne zu buchen) – für die Rückfrage vor der Buchung. */
export async function abholungVorbereiten(tenantId: string, w: AbholWunsch, jetzt = new Date()): Promise<Vorbereitet> {
  const s = await getSettings(tenantId);
  const orte = s.abholung.orte;
  const ortNamen = orte.map((o) => `${o.key} (${o.name})`);
  const ort = ortFinden(orte, w.ort);
  if (!ort) {
    const fehler = !orte.length ? ["Noch kein Abholort hinterlegt – Einstellungen → Abholung (nur Inhaber)."] : [w.ort ? `Abholort „${w.ort}“ nicht gefunden.` : "Bitte den Abholort nennen."];
    return { ok: false, fehler, hinweise: [], orte: ortNamen };
  }
  const datum = w.datum?.trim() ? datumLesen(w.datum, jetzt) : naechsterAbholtag(w.dienst, jetzt);
  const fehlerVorab: string[] = [];
  if (!datum) fehlerVorab.push(`Datum „${w.datum}“ nicht verstanden – z. B. „morgen“, „Montag“, „7.11.“ oder 2026-11-07.`);
  let von = w.von ?? null, bis = w.bis ?? null;
  if (w.fenster?.trim()) {
    const f = fensterLesen(w.fenster);
    if (f) ({ von, bis } = f);
    else fehlerVorab.push(`Zeitfenster „${w.fenster}“ nicht verstanden – z. B. „10-12“ oder „10:00 bis 12:30“.`);
  }
  const eingabe: AbholEingabe = { dienst: w.dienst, datum: datum ?? "", von, bis, pakete: w.pakete, paletten: w.paletten ?? 0, gewichtKg: w.gewichtKg ?? null, hinweis: w.hinweis?.trim() || null, ort };
  const f = fensterVon(eingabe);
  eingabe.von = f.von;
  eingabe.bis = f.bis;
  const ups = w.dienst === "ups" ? await getIntegration(tenantId, "ups") : null;
  const p = abholungPruefen(eingabe, jetzt, { upsKonto: ups?.kontonummer });
  const fehler = [...fehlerVorab, ...p.fehler.filter((x) => !(fehlerVorab.length && x.startsWith("Datum fehlt")))];
  // Schon gebucht? Nicht doppelt beauftragen (gerade per Sprache leicht passiert).
  if (datum) {
    const [da] = await db.select({ bestaetigung: A.bestaetigung, pakete: A.pakete }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.dienst, w.dienst), eq(A.ort, ort.key), eq(A.datum, datum), inArray(A.status, ["gebucht", "angefragt"]))).limit(1);
    if (da) fehler.push(`Für ${datumText(datum)} ist bei ${DIENST_NAME[w.dienst]} schon eine Abholung gebucht (${da.pakete} Pakete, Nr. ${da.bestaetigung ?? "–"}) – erst stornieren oder ein anderes Datum.`);
  }
  if (fehler.length) return { ok: false, fehler, hinweise: p.hinweise, zusammenfassung: datum ? abholZusammenfassung(eingabe) : undefined, orte: ortNamen };
  return { ok: true, eingabe, zusammenfassung: abholZusammenfassung(eingabe), hinweise: p.hinweise };
}

export type Gebucht = { ok: true; id: string; status: "gebucht" | "angefragt"; bestaetigung: string; text: string; hinweise: string[] } | { ok: false; id?: string; text: string; fehler: string[] };

/** Buchen: Schnittstelle aufrufen und jede versuchte Buchung protokollieren (auch Fehler der Schnittstelle). */
export async function abholungBuchen(tenantId: string, wer: Wer, w: AbholWunsch, quelle: "seite" | "claude" | "vorschlag", jetzt = new Date()): Promise<Gebucht> {
  const v = await abholungVorbereiten(tenantId, w, jetzt);
  if (!v.ok) return { ok: false, text: v.fehler.join(" "), fehler: v.fehler };
  const e = v.eingabe;
  const basis = { tenantId, dienst: e.dienst, ort: e.ort.key, ortName: e.ort.name, datum: e.datum, zeitVon: e.von, zeitBis: e.bis, pakete: e.pakete, paletten: e.paletten ?? 0, gewichtKg: e.gewichtKg ? String(e.gewichtKg) : null, hinweis: e.hinweis ?? e.ort.hinweis ?? null, quelle, gebuchtVon: wer.userId, gebuchtVonName: wer.name };
  let r: { ok: true; ergebnis: { status: "gebucht" | "angefragt"; bestaetigung: string; abholArt: string | null; kostenpflichtig: boolean | null }; roh: unknown } | { ok: false; fehler: string; roh: unknown };
  if (e.dienst === "dhl") {
    const c = await getIntegration(tenantId, "dhl");
    if (!c?.apiKey || !c.username || !c.password) return { ok: false, text: "DHL-Zugang fehlt – Anbindungen → DHL Geschäftskunden (API-Key mit „Parcel DE Pickup“, Benutzer, Passwort).", fehler: ["DHL-Zugang fehlt"] };
    const { dhlAbholungBuchen } = await import("@/lib/integrations/clients/dhl-pickup");
    const s = await getSettings(tenantId);
    r = await dhlAbholungBuchen({ apiKey: c.apiKey, username: c.username, password: c.password }, s.dhl.sandbox, e).catch((err) => ({ ok: false as const, fehler: `DHL nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, roh: null }));
  } else {
    const { upsAbholungBuchen, upsCreds } = await import("@/lib/integrations/clients/ups");
    const c = upsCreds(await getIntegration(tenantId, "ups"));
    if (!c) return { ok: false, text: "UPS-Zugang fehlt – Anbindungen → UPS (Client-ID, Client-Secret, Kontonummer).", fehler: ["UPS-Zugang fehlt"] };
    r = await upsAbholungBuchen(c, e).catch((err) => ({ ok: false as const, fehler: `UPS nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, roh: null }));
  }
  const antwort = kuerzen(r.roh);
  if (!r.ok) {
    const [row] = await db.insert(A).values({ ...basis, status: "fehler", fehler: r.fehler, antwort }).returning({ id: A.id });
    return { ok: false, id: row.id, text: r.fehler, fehler: [r.fehler] };
  }
  const g = r.ergebnis;
  const [row] = await db.insert(A).values({ ...basis, status: g.status, bestaetigung: g.bestaetigung, abholArt: g.abholArt, kostenpflichtig: g.kostenpflichtig, antwort }).returning({ id: A.id });
  await vorschlagSchliessen(tenantId, e.dienst, e.datum, jetzt);
  const text = g.status === "angefragt"
    ? `${v.zusammenfassung}: bei DHL angefragt (einmalige Abholung) – Nr. ${g.bestaetigung}. Die Bestätigung kommt per Mail.`
    : `${v.zusammenfassung}: gebucht – Bestätigungsnummer ${g.bestaetigung}.`;
  return { ok: true, id: row.id, status: g.status, bestaetigung: g.bestaetigung, text, hinweise: v.hinweise };
}

/** Antwort der Schnittstelle gekürzt speichern (nur zum Nachvollziehen). */
function kuerzen(roh: unknown): unknown {
  if (roh == null) return null;
  const t = JSON.stringify(roh);
  return t.length <= 4000 ? roh : { gekuerzt: t.slice(0, 4000) };
}

/** Stornieren über denselben Weg (DHL: orderID, UPS: PRN). */
export async function abholungStornieren(tenantId: string, wer: Wer, id: string): Promise<{ ok: boolean; text: string }> {
  const [a] = await db.select().from(A).where(and(eq(A.tenantId, tenantId), eq(A.id, id))).limit(1);
  if (!a) return { ok: false, text: "Abholung nicht gefunden." };
  if (a.status === "storniert") return { ok: false, text: "Diese Abholung ist schon storniert." };
  if (a.status === "fehler" || !a.bestaetigung) return { ok: false, text: "Diese Buchung ist nicht zustande gekommen – nichts zu stornieren." };
  if (a.datum < berlinHeute()) return { ok: false, text: "Die Abholung liegt in der Vergangenheit." };
  let r: { ok: boolean; text: string };
  if (a.dienst === "dhl") {
    const c = await getIntegration(tenantId, "dhl");
    if (!c?.apiKey || !c.username || !c.password) return { ok: false, text: "DHL-Zugang fehlt (Anbindungen)." };
    const { dhlAbholungStornieren } = await import("@/lib/integrations/clients/dhl-pickup");
    r = await dhlAbholungStornieren({ apiKey: c.apiKey, username: c.username, password: c.password }, (await getSettings(tenantId)).dhl.sandbox, a.bestaetigung).catch((err) => ({ ok: false, text: `DHL nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` }));
  } else {
    const { upsAbholungStornieren, upsCreds } = await import("@/lib/integrations/clients/ups");
    const c = upsCreds(await getIntegration(tenantId, "ups"));
    if (!c) return { ok: false, text: "UPS-Zugang fehlt (Anbindungen)." };
    r = await upsAbholungStornieren(c, a.bestaetigung).catch((err) => ({ ok: false, text: `UPS nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` }));
  }
  if (!r.ok) return r;
  await db.update(A).set({ status: "storniert", storniertAm: new Date(), storniertVonName: wer.name, updatedAt: new Date() }).where(and(eq(A.tenantId, tenantId), eq(A.id, id)));
  return { ok: true, text: `${DIENST_NAME[a.dienst]}-Abholung am ${datumText(a.datum)} storniert (Nr. ${a.bestaetigung}).` };
}

export type AbholZeile = typeof A.$inferSelect;

/** Protokoll: neueste zuerst (Standard: ab 30 Tagen zurück). */
export async function abholungenListe(tenantId: string, o: { ab?: string; nurOffen?: boolean; limit?: number } = {}): Promise<AbholZeile[]> {
  const ab = o.ab ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  return db
    .select()
    .from(A)
    .where(and(eq(A.tenantId, tenantId), or(gte(A.datum, ab), gte(A.createdAt, new Date(`${ab}T00:00:00Z`))), o.nurOffen ? and(inArray(A.status, ["gebucht", "angefragt"]), gte(A.datum, berlinHeute())) : undefined))
    .orderBy(desc(A.datum), desc(A.createdAt))
    .limit(o.limit ?? 100);
}

export async function abholungLaden(tenantId: string, id: string): Promise<AbholZeile | null> {
  return (await db.select().from(A).where(and(eq(A.tenantId, tenantId), eq(A.id, id))).limit(1))[0] ?? null;
}

// ── Vorschlag (A4, C3) ─────────────────────────────────────────────────────

/**
 * Fertige Labels, die noch abgeholt werden müssen. DHL: heute erstellte DHL-Labels (Versandseite, Aufträge, Label aus
 * Chat; ohne Retourenlabels). UPS: UPS-Labels von heute und Palettenkunden-Sendungen per UPS (Versand, geplant, bis zum
 * nächsten Abholtag) – je Sendung die Kartons, sonst 1.
 */
export async function labelsBereit(tenantId: string, dienst: AbholDienst, jetzt = new Date()): Promise<number> {
  const heute = berlinHeute(jetzt);
  const P = schema.parcels;
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(P)
    .where(and(eq(P.tenantId, tenantId), sql`upper(${P.carrier}) = ${dienst.toUpperCase()}`, eq(P.status, "created"), eq(P.isReturnLabel, 0), gte(P.createdAt, berlinMidnight(heute))));
  if (dienst === "dhl") return n;
  const S = schema.palletShipments;
  const [{ k }] = await db
    .select({ k: sql<number>`coalesce(sum(greatest(coalesce(${S.cartonCount}, 1), 1)), 0)::int` })
    .from(S)
    .where(and(eq(S.tenantId, tenantId), eq(S.direction, "aus"), eq(S.carrier, "ups"), eq(S.status, "geplant"), or(isNull(S.plannedDate), lte(S.plannedDate, naechsterAbholtag("ups", jetzt)))));
  return n + k;
}

const vorschlagKey = (dienst: AbholDienst, tag: string) => `abholung:vorschlag:${dienst}:${tag}`;

async function vorschlagSchliessen(tenantId: string, dienst: AbholDienst, tag: string, jetzt: Date) {
  const T = schema.tasks;
  await db.update(T).set({ status: "done", completedAt: jetzt }).where(and(eq(T.tenantId, tenantId), eq(T.systemKey, vorschlagKey(dienst, tag)), eq(T.status, "open")));
}

/**
 * Abend-Vorschlag: mehr als n fertige Labels und für den nächsten Abholtag nichts gebucht → Aufgabe „Abholung buchen?“
 * mit Ein-Klick-Knopf (Link auf die vorbelegte Seite) und Push. Bucht nie selbst.
 */
export async function abholVorschlag(tenantId: string, jetzt = new Date()): Promise<{ dienst: AbholDienst; labels: number; tag: string; neu: boolean }[]> {
  const s = await getSettings(tenantId);
  if (!s.abholung.vorschlagAn || !s.abholung.orte.length) return [];
  const schwelle = s.abholung.vorschlagAb;
  const ort = ortFinden(s.abholung.orte, null) ?? s.abholung.orte[0];
  const out: { dienst: AbholDienst; labels: number; tag: string; neu: boolean }[] = [];
  for (const dienst of ["dhl", "ups"] as const) {
    if (dienst === "ups" && !(await getIntegration(tenantId, "ups"))?.clientId) continue;
    const labels = await labelsBereit(tenantId, dienst, jetzt);
    const tag = naechsterAbholtag(dienst, jetzt);
    const [gebucht] = await db.select({ id: A.id }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.dienst, dienst), eq(A.datum, tag), inArray(A.status, ["gebucht", "angefragt"]))).limit(1);
    if (!vorschlagNoetig({ labels, schwelle, gebucht: Boolean(gebucht) })) continue;
    const T = schema.tasks;
    const key = vorschlagKey(dienst, tag);
    const [alt] = await db.select({ id: T.id }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.systemKey, key))).limit(1);
    const f = { von: zeitNorm(ort.von), bis: zeitNorm(ort.bis) };
    const link = `/versand/abholung?vorschlag=1&dienst=${dienst}&datum=${tag}&pakete=${labels}&ort=${encodeURIComponent(ort.key)}`;
    const title = `Abholung buchen? ${labels} ${DIENST_NAME[dienst]}-Labels fertig, für ${datumText(tag)} nichts gebucht`;
    const notes = `Vorschlag (wird nicht automatisch gebucht): ${DIENST_NAME[dienst]}-Abholung am ${datumText(tag)}${f.von && f.bis ? `, ${f.von}–${f.bis} Uhr` : ""}, ${labels} Pakete, ${ort.name}. Ein Klick auf „Jetzt buchen“ auf der Seite bucht genau das.`;
    if (alt) {
      await db.update(T).set({ title, notes, link }).where(eq(T.id, alt.id));
      out.push({ dienst, labels, tag, neu: false });
      continue;
    }
    const [neu] = await db.insert(T).values({ tenantId, systemKey: key, title, notes, link, dueDate: berlinHeute(jetzt), priority: "normal", category: "versand" }).onConflictDoNothing().returning({ id: T.id });
    if (neu) await import("@/lib/push/aufgabe").then((m) => m.aufgabeMelden(tenantId, { id: neu.id, title, dueDate: berlinHeute(jetzt), link, category: "versand" })).catch(() => null);
    out.push({ dienst, labels, tag, neu: Boolean(neu) });
  }
  return out;
}

/** Vorschlag für alle Firmen (Abend-Job). */
export async function abholVorschlagAlle(jetzt = new Date()): Promise<string> {
  const tenants = await db.select({ id: schema.tenants.id, settings: schema.tenants.settings }).from(schema.tenants);
  let n = 0;
  for (const t of tenants) {
    if (!(t.settings as { abholung?: { orte?: unknown[] } } | null)?.abholung?.orte?.length) continue;
    n += (await abholVorschlag(t.id, jetzt).catch(() => [])).filter((x) => x.neu).length;
  }
  return `${n} Abhol-Vorschl${n === 1 ? "ag" : "äge"}`;
}
