import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import type { Agent } from "@/lib/druck/service";
import { dubletteVon, lieferantAusText, zielName, zielOrdner, type BelegFakten } from "./ablage-logic";

// B34.2 Download-Ordner am Arbeits-PC (Druckagent): Datei kommt hoch → Rechnung/Beleg/Kontoauszug erkennen,
// Dubletten prüfen, Zielordner und -name zurück. Der Agent verschiebt (nie löschen) und meldet den Pfad. Dubletten
// liegen im Ordner „Dubletten“ und werden erst nach Freigabe hier vom Agenten gelöscht.

const B = schema.belegAblage;
const I = schema.invoices;
export type AblageZeile = typeof B.$inferSelect;
export type AgentAntwort = { id: string; aktion: "warten" | "ablegen" | "dublette" | "kontoauszug" | "liegen_lassen"; ordner: string | null; name: string | null; text: string };

const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const endungVon = (n: string) => (/\.[a-z0-9]{2,5}$/i.exec(n)?.[0] ?? ".pdf").toLowerCase();
const istPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const istBild = (n: string) => /\.(jpe?g|png|heic|heif|webp)$/i.test(n);

function antwort(z: AblageZeile): AgentAntwort {
  const aktion = z.status === "fehler" ? "liegen_lassen" : z.status;
  const text =
    z.status === "dublette" ? `Dublette (${z.dubletteGrund ?? "schon vorhanden"}) → Ordner „Dubletten“` : z.status === "kontoauszug" ? "Kontoauszug – importiert, nicht als Rechnung abgelegt" : z.status === "liegen_lassen" || z.status === "fehler" ? (z.meldung ?? "kein Beleg – bleibt liegen") : z.status === "warten" ? "wird gelesen" : `abgelegt als ${z.zielname}`;
  return { id: z.id, aktion, ordner: z.ordner, name: z.zielname, text };
}

async function eigeneNamen(tenantId: string): Promise<string[]> {
  const { getSettings } = await import("@/lib/settings");
  const s = await getSettings(tenantId);
  return [s.b2b?.firma?.name, s.b2b?.firma?.handelsname, ...(s.buchhaltung?.firmen ?? [])].filter((x): x is string => !!x && x.trim().length >= 3);
}

async function bekannteLieferanten(tenantId: string): Promise<string[]> {
  const rows = await db.select({ name: schema.suppliers.name }).from(schema.suppliers).where(eq(schema.suppliers.tenantId, tenantId)).limit(2000);
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}

/** Bisherige Belege für den Dubletten-Vergleich: Ablage + Rechnungen (Nummer/Betrag bzw. gleiche Prüfsumme). */
async function vorhandene(tenantId: string, hash: string, nummer: string | null, betrag: number | null) {
  const ablage = await db
    .select({ id: B.id, hash: B.hash, nummer: B.nummer, betrag: B.betrag, pfad: B.pfad })
    .from(B)
    .where(and(eq(B.tenantId, tenantId), inArray(B.status, ["ablegen", "warten"]), sql`(${B.hash} = ${hash}${nummer ? sql` or upper(regexp_replace(coalesce(${B.nummer}, ''), '[^A-Za-z0-9]', '', 'g')) = ${nummer.toUpperCase().replace(/[^A-Z0-9]/g, "")}` : sql``})`));
  const rechnungen = await db
    .select({ id: I.id, hash: I.externalId, nummer: I.invoiceNumber, betrag: I.totalGross })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), ne(I.status, "ignored"), sql`(${I.externalId} = ${hash}${nummer && betrag !== null ? sql` or (upper(regexp_replace(coalesce(${I.invoiceNumber}, ''), '[^A-Za-z0-9]', '', 'g')) = ${nummer.toUpperCase().replace(/[^A-Z0-9]/g, "")} and abs(${I.totalGross}) = ${Math.abs(betrag)})` : sql``})`))
    .limit(20);
  return [...ablage, ...rechnungen.map((r) => ({ ...r, id: `rechnung:${r.id}` }))];
}

async function sitzung(a: Agent) {
  if (!a.angelegtVon) throw new Error("Agent ohne zuständige Person – bitte neu anlegen.");
  const { sitzungFuer } = await import("@/lib/mobil/token");
  const s = await sitzungFuer(a.tenantId, a.angelegtVon, `druckagent:${a.id}`);
  if (!s) throw new Error("Zuständige Person deaktiviert.");
  return s;
}

/** Datei aus dem Download-Ordner verarbeiten (Agent-Upload). */
export async function belegAusOrdner(a: Agent, name: string, bytes: Uint8Array): Promise<AgentAntwort> {
  const t = a.tenantId;
  const hash = createHash("sha256").update(bytes).digest("hex");
  const basis = { tenantId: t, agentId: a.id, hash, dateiname: name.slice(0, 200), groesse: bytes.length };
  // Dieselbe Datei noch einmal (Agent neu gestartet, Rückmeldung verloren): gleiche Antwort, nichts doppelt.
  const [frueher] = await db.select().from(B).where(and(eq(B.tenantId, t), eq(B.hash, hash), eq(B.dateiname, basis.dateiname), isNull(B.verschobenAm), ne(B.status, "dublette"))).orderBy(desc(B.createdAt)).limit(1);
  if (frueher) return antwort(frueher);
  const neu = async (v: Partial<typeof B.$inferInsert> & { status: AblageZeile["status"] }) => antwort((await db.insert(B).values({ ...basis, ...v }).returning())[0]);

  const pdf = istPdf(bytes);
  if (!pdf && !istBild(name)) return neu({ status: "liegen_lassen", art: "sonstiges", meldung: "weder PDF noch Foto – bleibt im Download-Ordner" });
  let text = "";
  if (pdf) {
    const { pdfText } = await import("@/lib/invoices/service");
    text = await pdfText(bytes).catch(() => "");
  }
  // Gleiche Datei schon abgelegt bzw. als Rechnung vorhanden → Dublette (vor jeder weiteren Verarbeitung)
  const gleich = dubletteVon({ hash, nummer: null, betrag: null }, await vorhandene(t, hash, null, null));
  if (gleich) return neu({ status: "dublette", art: "beleg", dubletteVon: gleich.id.startsWith("rechnung:") ? null : gleich.id, dubletteGrund: gleich.grund, ordner: "Dubletten", zielname: name.slice(0, 200) });

  // Kontoauszug: importieren (Bank/PayPal), nicht als Rechnung ablegen
  const { istKontoauszugText } = await import("@/lib/uploads/erkennen");
  if (pdf && istKontoauszugText(text)) {
    const s = await sitzung(a);
    const { dateiHochladen } = await import("@/lib/uploads/service");
    const r = (await dateiHochladen(s, name, bytes, { art: "kontoauszug", firma: null, saldo: null }))[0];
    const bis = (r?.details as { konto?: { bis?: string | null } } | undefined)?.konto?.bis ?? heute();
    return neu({ status: "kontoauszug", art: "kontoauszug", ordner: `Kontoauszüge/${String(bis).slice(0, 7)}`, zielname: name.slice(0, 200), meldung: r?.ok ? r.text.slice(0, 300) : `nicht importiert: ${r?.text ?? "?"}`.slice(0, 300) });
  }
  if (pdf) {
    const { pdfArt } = await import("@/lib/uploads/erkennen");
    if (text.trim() && pdfArt(text) !== "beleg") return neu({ status: "liegen_lassen", art: "sonstiges", meldung: "kein Beleg (z. B. Transkript) – bleibt liegen" });
    const { extractInvoiceFacts } = await import("@/lib/invoices/parse");
    const { analyzeNew } = await import("@/lib/invoices/review");
    const f = extractInvoiceFacts(text);
    const datum = analyzeNew(text, name).invoiceDate ?? f.invoiceDate ?? null;
    const fakten: BelegFakten = { lieferant: lieferantAusText(text, { bekannt: await bekannteLieferanten(t), eigene: await eigeneNamen(t) }), datum, betrag: f.totalGross, nummer: f.invoiceNumber };
    const zielname = zielName(fakten, endungVon(name));
    const d = dubletteVon({ hash, nummer: fakten.nummer, betrag: fakten.betrag }, await vorhandene(t, hash, fakten.nummer, fakten.betrag));
    const felder = { lieferant: fakten.lieferant, datum: fakten.datum, betrag: fakten.betrag, nummer: fakten.nummer, zielname };
    if (d) return neu({ status: "dublette", art: "rechnung", dubletteVon: d.id.startsWith("rechnung:") ? null : d.id, dubletteGrund: d.grund, ordner: "Dubletten", ...felder });
    const { ingestInvoice, refreshInvoiceTasks } = await import("@/lib/invoices/service");
    const inv = await ingestInvoice({ tenantId: t, source: "ordner", externalId: hash, fileName: zielname, bytes: Buffer.from(bytes), storeBytes: true, vendor: fakten.lieferant });
    await refreshInvoiceTasks(t).catch(() => undefined);
    return neu({ status: "ablegen", art: "rechnung", invoiceId: inv.id, ordner: zielOrdner(fakten, heute()), ...felder });
  }
  // Foto (Kassenzettel, Beleg): Rechnungsstation liest per KI → Agent fragt später nach dem Ergebnis
  const { blattAufnehmen, stapelNeu } = await import("@/lib/rechnungsstation/service");
  const wer = { userId: a.angelegtVon, name: `Download-Ordner (${a.name})` };
  const stapelId = await stapelNeu(t, wer, "ordner", `Download-Ordner ${heute()}`);
  const typ = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
  const r = await blattAufnehmen(t, wer, { stapelId, bild: Buffer.from(bytes), bildTyp: typ });
  if (r.duplikat) return neu({ status: "dublette", art: "beleg", dubletteGrund: "gleiches Foto schon in der Rechnungsstation", ordner: "Dubletten", zielname: name.slice(0, 200), invoiceId: r.id });
  return neu({ status: "warten", art: "beleg", invoiceId: r.id });
}

/** Stand für den Agenten (Fotos: wartet, bis die KI gelesen hat; nach 30 Min. ablegen mit dem, was da ist). */
export async function belegStand(a: Agent, id: string): Promise<AgentAntwort | null> {
  const [z] = await db.select().from(B).where(and(eq(B.tenantId, a.tenantId), eq(B.id, id)));
  if (!z) return null;
  if (z.status !== "warten" || !z.invoiceId) return antwort(z);
  const [inv] = await db.select({ status: I.status, vendor: I.vendor, datum: I.invoiceDate, brutto: I.totalGross, nummer: I.invoiceNumber, gelesen: I.ampel }).from(I).where(and(eq(I.tenantId, a.tenantId), eq(I.id, z.invoiceId)));
  const fertig = inv && (inv.gelesen || inv.vendor || inv.brutto !== null);
  if (!fertig && Date.now() - z.createdAt.getTime() < 30 * 60_000) return antwort(z);
  const fakten: BelegFakten = { lieferant: inv?.vendor ?? null, datum: inv?.datum ?? null, betrag: inv?.brutto ?? null, nummer: inv?.nummer ?? null };
  const zielname = zielName(fakten, endungVon(z.dateiname));
  const d = dubletteVon({ hash: z.hash, nummer: fakten.nummer, betrag: fakten.betrag }, (await vorhandene(a.tenantId, `-${z.hash}`, fakten.nummer, fakten.betrag)).filter((x) => x.id !== z.id && x.id !== `rechnung:${z.invoiceId}`));
  const felder = { lieferant: fakten.lieferant, datum: fakten.datum, betrag: fakten.betrag, nummer: fakten.nummer, zielname };
  const [neu] = await db
    .update(B)
    .set(d ? { status: "dublette", dubletteVon: d.id.startsWith("rechnung:") ? null : d.id, dubletteGrund: d.grund, ordner: "Dubletten", ...felder } : { status: "ablegen", ordner: zielOrdner(fakten, z.createdAt.toISOString().slice(0, 10)), ...felder })
    .where(eq(B.id, z.id))
    .returning();
  return antwort(neu);
}

/** Rückmeldung des Agenten: verschoben (relativer Pfad) bzw. gelöscht (nur freigegebene Dubletten). */
export async function rueckmeldung(a: Agent, r: { id: string; verschoben?: string | null; geloescht?: boolean | null; meldung?: string | null }): Promise<boolean> {
  const [z] = await db.select().from(B).where(and(eq(B.tenantId, a.tenantId), eq(B.id, r.id)));
  if (!z) return false;
  if (r.verschoben) await db.update(B).set({ pfad: r.verschoben.slice(0, 500), verschobenAm: new Date() }).where(eq(B.id, z.id));
  if (r.geloescht === true && z.status === "dublette" && z.loeschenFreigegebenAm) await db.update(B).set({ geloeschtAm: new Date(), meldung: "nach Freigabe gelöscht" }).where(eq(B.id, z.id));
  else if (r.geloescht === false && r.meldung) await db.update(B).set({ meldung: r.meldung.slice(0, 300), loeschenFreigegebenAm: null }).where(eq(B.id, z.id));
  return true;
}

/** Freigegebene Dubletten, die der Agent löschen darf (Pfad + Prüfsumme). */
export async function loeschListe(a: Agent) {
  return db
    .select({ id: B.id, pfad: B.pfad, hash: B.hash })
    .from(B)
    .where(and(eq(B.tenantId, a.tenantId), eq(B.agentId, a.id), eq(B.status, "dublette"), isNotNull(B.loeschenFreigegebenAm), isNull(B.geloeschtAm), isNotNull(B.pfad)));
}

// ---- Oberfläche --------------------------------------------------------------------------------------------------

export async function ablageListe(tenantId: string, limit = 100) {
  return db.select().from(B).where(eq(B.tenantId, tenantId)).orderBy(desc(B.createdAt)).limit(limit);
}

/** Dubletten zum Löschen freigeben (einzeln oder alle offenen) – gelöscht wird beim nächsten Lauf des Agenten. */
export async function loeschenFreigeben(s: Session, ids: string[] | "alle"): Promise<number> {
  if (s.readOnly) return 0;
  const W = and(eq(B.tenantId, s.tenantId), eq(B.status, "dublette"), isNull(B.geloeschtAm), isNull(B.loeschenFreigegebenAm), isNotNull(B.verschobenAm), ids === "alle" ? undefined : inArray(B.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]));
  const r = await db.update(B).set({ loeschenFreigegebenAm: new Date(), loeschenFreigegebenVon: s.userId }).where(W).returning({ id: B.id });
  return r.length;
}
