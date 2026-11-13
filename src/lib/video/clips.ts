import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { medienOrdner } from "@/lib/medien/ablage";
import { clipMeldungAus, schlagwoerterAus } from "./logic";
import { VideoFehler, type Worker } from "./service";

// B36.12 Eigene Clip-Bibliothek: Die Videos liegen am Worker-PC (Ordner „clips“). Der Worker meldet hier nur, was er
// erkannt hat (Beschreibung, Schlagwörter, bester Abschnitt, brauchbar?) und ein Vorschaubild. Ludwig sieht die
// Bibliothek auf der Seite Video, kann Clips sperren und Schlagwörter/Beschreibung korrigieren – das geht mit jedem
// Auftrag zurück an den Worker (clipKorrekturen). Kein Video verlässt den PC.

const C = schema.videoClips;
const MAX_VORSCHAU = 400 * 1024;

const vorschauOrdner = (tenantId: string) => {
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new VideoFehler("Ungültige Kennung.");
  return path.join(/*turbopackIgnore: true*/ medienOrdner(), "video", tenantId, "clips");
};

/** Abgleich vom Worker: alle Clips im Ordner (vollständige Liste). Fehlende werden als „fehlt“ markiert. */
export async function clipsMelden(w: Worker, body: unknown): Promise<{ ok: true; gemeldet: number; vorschauFehlt: string[] }> {
  const liste = (body && typeof body === "object" && Array.isArray((body as { clips?: unknown }).clips) ? (body as { clips: unknown[] }).clips : []).slice(0, 5000);
  const clips = liste.map(clipMeldungAus).filter((x): x is NonNullable<typeof x> => !!x);
  const jetzt = new Date();
  for (let i = 0; i < clips.length; i += 200) {
    const teil = clips.slice(i, i + 200);
    await db
      .insert(C)
      .values(teil.map((c) => ({ tenantId: w.tenantId, ...c, fehlt: false, gesehenAm: jetzt })))
      .onConflictDoUpdate({
        target: [C.tenantId, C.clipId],
        set: {
          pfad: sql`excluded.pfad`,
          kanalSlug: sql`excluded.kanal_slug`,
          dauer: sql`excluded.dauer`,
          breite: sql`excluded.breite`,
          hoehe: sql`excluded.hoehe`,
          beschreibung: sql`excluded.beschreibung`,
          schlagwoerter: sql`excluded.schlagwoerter`,
          einstellung: sql`excluded.einstellung`,
          brauchbar: sql`excluded.brauchbar`,
          grund: sql`excluded.grund`,
          abschnitt: sql`excluded.abschnitt`,
          quelle: sql`excluded.quelle`,
          filmer: sql`excluded.filmer`,
          benutzt: sql`greatest(${C.benutzt}, excluded.benutzt)`,
          zuletztBenutzt: sql`coalesce(excluded.zuletzt_benutzt, ${C.zuletztBenutzt})`,
          fehlt: false,
          gesehenAm: jetzt,
        },
      });
  }
  const ids = clips.map((c) => c.clipId);
  if ((body as { vollstaendig?: boolean })?.vollstaendig) {
    await db.update(C).set({ fehlt: true }).where(and(eq(C.tenantId, w.tenantId), ids.length ? notInArray(C.clipId, ids) : sql`true`));
  }
  const ohne = ids.length ? await db.select({ id: C.clipId }).from(C).where(and(eq(C.tenantId, w.tenantId), inArray(C.clipId, ids), eq(C.vorschau, false))) : [];
  return { ok: true, gemeldet: clips.length, vorschauFehlt: ohne.map((x) => x.id) };
}

/** Vorschaubild (JPEG, ≤ 400 KB) eines gemeldeten Clips speichern. */
export async function clipVorschauSpeichern(w: Worker, clipId: string, daten: ArrayBuffer): Promise<{ ok: boolean; fehler?: string; status?: number }> {
  if (!/^[0-9a-f]{12,64}$/.test(clipId)) return { ok: false, fehler: "Ungültige Clip-ID", status: 400 };
  if (daten.byteLength === 0 || daten.byteLength > MAX_VORSCHAU) return { ok: false, fehler: "Vorschaubild fehlt oder größer als 400 KB", status: 413 };
  const b = new Uint8Array(daten);
  if (!(b[0] === 0xff && b[1] === 0xd8)) return { ok: false, fehler: "Nur JPEG", status: 415 };
  const [c] = await db.select({ id: C.clipId }).from(C).where(and(eq(C.tenantId, w.tenantId), eq(C.clipId, clipId)));
  if (!c) return { ok: false, fehler: "Clip nicht gemeldet", status: 404 };
  const ordner = vorschauOrdner(w.tenantId);
  await mkdir(ordner, { recursive: true });
  await writeFile(path.join(ordner, `${clipId}.jpg`), b);
  await db.update(C).set({ vorschau: true }).where(and(eq(C.tenantId, w.tenantId), eq(C.clipId, clipId)));
  return { ok: true };
}

export async function clipVorschauLesen(tenantId: string, clipId: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{12,64}$/.test(clipId)) return null;
  return readFile(path.join(vorschauOrdner(tenantId), `${clipId}.jpg`)).catch(() => null);
}

export type ClipZeile = typeof C.$inferSelect;

/** Bibliothek für die Seite Video: vorhandene Clips zuerst, nach Kanal-Ordner gefiltert (null = alle). */
export async function clipsListe(tenantId: string, kanalSlug?: string | null, grenze = 300): Promise<{ clips: ClipZeile[]; anzahl: { gesamt: number; brauchbar: number; gesperrt: number; fehlt: number } }> {
  const wo = kanalSlug ? and(eq(C.tenantId, tenantId), or(isNull(C.kanalSlug), eq(C.kanalSlug, kanalSlug))) : eq(C.tenantId, tenantId);
  const clips = await db.select().from(C).where(wo).orderBy(asc(C.fehlt), desc(C.gesehenAm), asc(C.pfad)).limit(grenze);
  const [z] = await db
    .select({
      gesamt: sql<number>`count(*)::int`,
      brauchbar: sql<number>`count(*) filter (where ${C.brauchbar} and not ${C.gesperrt} and not ${C.fehlt})::int`,
      gesperrt: sql<number>`count(*) filter (where ${C.gesperrt})::int`,
      fehlt: sql<number>`count(*) filter (where ${C.fehlt})::int`,
    })
    .from(C)
    .where(wo);
  return { clips, anzahl: z ?? { gesamt: 0, brauchbar: 0, gesperrt: 0, fehlt: 0 } };
}

/** Von Hand: sperren/freigeben, Schlagwörter (ersetzen die erkannten; leer = erkannte), Beschreibung (leer = erkannte). */
export async function clipAendern(s: Session, clipId: string, e: { gesperrt: boolean; schlagwoerter: string; beschreibung: string }) {
  if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
  if (!/^[0-9a-f]{12,64}$/.test(clipId)) throw new VideoFehler("Clip nicht gefunden.");
  const [alt] = await db.select({ sw: C.schlagwoerter, b: C.beschreibung }).from(C).where(and(eq(C.tenantId, s.tenantId), eq(C.clipId, clipId)));
  if (!alt) throw new VideoFehler("Clip nicht gefunden.");
  // unverändert gelassene Felder bleiben „erkannt“ (sonst würde jedes Speichern die Erkennung festschreiben)
  const sw = schlagwoerterAus(e.schlagwoerter);
  const gleich = sw.length === alt.sw.length && sw.every((w) => alt.sw.includes(w));
  const b = e.beschreibung.trim().slice(0, 600);
  await db
    .update(C)
    .set({ gesperrt: e.gesperrt, schlagwoerterHand: sw.length && !gleich ? sw : null, beschreibungHand: b && b !== alt.b ? b : null })
    .where(and(eq(C.tenantId, s.tenantId), eq(C.clipId, clipId)));
}

/** Für den Worker (mit jedem Auftrag): Korrekturen von Hand je Clip. */
export async function clipKorrekturen(tenantId: string): Promise<Record<string, { gesperrt: boolean; schlagwoerter: string[] | null; beschreibung: string | null }>> {
  const z = await db
    .select({ id: C.clipId, gesperrt: C.gesperrt, sw: C.schlagwoerterHand, b: C.beschreibungHand })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), or(eq(C.gesperrt, true), sql`${C.schlagwoerterHand} is not null`, sql`${C.beschreibungHand} is not null`)));
  return Object.fromEntries(z.map((x) => [x.id, { gesperrt: x.gesperrt, schlagwoerter: x.sw, beschreibung: x.b }]));
}
