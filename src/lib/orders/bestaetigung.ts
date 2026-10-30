import "server-only";
import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
export { bestaetigungsDatei, carrierCode } from "./bestaetigung-logic";

// B15.1 Versandbestätigung an Amazon: FBM-Aufträge, die intern versendet sind (selbst, Prep Center, Label), deren
// Versand Amazon aber nicht kennt – ohne Schnittstelle per Datei (Seller Central → Bestellberichte hochladen).
// Frist = Versandfrist des Auftrags (danach zählt es bei Amazon als verspätet).

const O = schema.orders;

/** Kurze Wartezeit nach „versendet“ – die Schnittstelle meldet in der Regel sofort; ohne Fehler erst danach melden. */
const WARTE_MS = 2 * 3_600_000;

export type OffeneBestaetigung = { id: string; externalId: string; frist: string | null; versendetAm: string | null; tracking: string | null; carrier: string | null; versender: string | null; fehler: string | null };

/** Offene Bestätigungen (älteste Frist zuerst). */
export async function offeneBestaetigungen(tenantId: string, jetzt = new Date(), o: { ohneWartezeit?: boolean } = {}): Promise<OffeneBestaetigung[]> {
  const rows = await db
    .select({ id: O.id, externalId: O.externalId, shipBy: O.shipBy, shippedAt: O.shippedAt, trackingNumber: O.trackingNumber, carrier: O.carrier, shippedBy: O.shippedBy, error: O.trackingUploadError, externalStatus: O.externalStatus })
    .from(O)
    .where(
      and(
        eq(O.tenantId, tenantId),
        eq(O.channel, "amazon"),
        eq(O.fulfillment, "FBM"),
        inArray(O.status, ["shipped", "delivered"]),
        isNull(O.trackingUploadedAt),
        or(isNull(O.externalStatus), notInArray(sql`lower(${O.externalStatus})`, ["shipped", "delivered", "canceled", "cancelled"])),
        o.ohneWartezeit ? undefined : or(sql`${O.trackingUploadError} is not null`, lt(O.shippedAt, new Date(jetzt.getTime() - WARTE_MS)), isNull(O.shippedAt)),
      ),
    )
    .orderBy(sql`${O.shipBy} asc nulls last`, asc(O.shippedAt))
    .limit(500);
  return rows.map((r) => ({ id: r.id, externalId: r.externalId, frist: r.shipBy?.toISOString() ?? null, versendetAm: r.shippedAt?.toISOString() ?? null, tracking: r.trackingNumber, carrier: r.carrier, versender: r.shippedBy, fehler: r.error }));
}

/** Nach dem Hochladen in Seller Central: als „an Amazon gemeldet“ markieren (nur Aufträge dieser Firma). */
export async function alsHochgeladenMarkieren(tenantId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const r = await db
    .update(O)
    .set({ trackingUploadedAt: new Date(), trackingUploadError: null, updatedAt: new Date() })
    .where(and(eq(O.tenantId, tenantId), inArray(O.id, ids.slice(0, 500)), isNull(O.trackingUploadedAt)))
    .returning({ id: O.id });
  return r.length;
}

/** Erinnerung (Aufgabe für den Inhaber), solange etwas offen ist; schließt sich selbst, wenn alles gemeldet ist. */
export async function bestaetigungErinnern(tenantId: string, jetzt = new Date()): Promise<number> {
  const offen = await offeneBestaetigungen(tenantId, jetzt);
  const T = schema.tasks;
  const key = "amazon:versandbestaetigung";
  const [alt] = await db.select({ id: T.id, status: T.status }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.systemKey, key))).limit(1);
  if (!offen.length) {
    if (alt?.status === "open") await db.update(T).set({ status: "done", completedAt: jetzt }).where(eq(T.id, alt.id));
    return 0;
  }
  const frist = offen.find((o) => o.frist)?.frist?.slice(0, 10) ?? jetzt.toISOString().slice(0, 10);
  const werte = {
    title: `Versandbestätigung bei Amazon hochladen: ${offen.length} Auftr${offen.length === 1 ? "ag" : "äge"}`,
    notes: `Ohne Amazon-Schnittstelle weiß Amazon nichts vom Versand. Aufträge → „Meldung offen“ → „Versandbestätigung (Datei)“ laden, in Seller Central unter Bestellungen → Bestellberichte hochladen, danach „Hochgeladen“ bestätigen.\n${offen.slice(0, 30).map((o) => `${o.externalId}${o.frist ? ` – Frist ${o.frist.slice(8, 10)}.${o.frist.slice(5, 7)}.` : ""}`).join("\n")}`,
    dueDate: frist,
    priority: "critical" as const,
    category: "versand" as const,
    link: "/auftraege?ansicht=fehler",
  };
  if (!alt) await db.insert(T).values({ tenantId, systemKey: key, ...werte }).onConflictDoNothing();
  else await db.update(T).set({ ...werte, status: "open", completedAt: null }).where(eq(T.id, alt.id));
  return offen.length;
}
