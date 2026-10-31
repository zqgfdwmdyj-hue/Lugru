import "server-only";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Push an die installierte App (Web Push nach RFC 8030 mit VAPID, ohne Inhalt): Die Meldung liegt in der Tabelle
// „meldungen“; der Service Worker holt sie nach dem Anstoß selbst ab und zeigt sie an. Ohne Push-Abo geht die
// Meldung an den Discord-Kanal für Aufgaben (falls eingerichtet).

const P = schema.pushAbos;
const M = schema.meldungen;

type Vapid = { publicKey: string; privatePem: string };
let cache: Vapid | null = null;

/** VAPID-Schlüssel: einmal erzeugt und verschlüsselt gespeichert (für alle Mandanten gleich). */
export async function vapid(): Promise<Vapid> {
  if (cache) return cache;
  const lesen = async () => (await db.select().from(schema.systemWerte).where(eq(schema.systemWerte.schluessel, "vapid")))[0];
  let r = await lesen();
  if (!r) {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const roh = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
    const v: Vapid = { publicKey: roh.toString("base64url"), privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    await db.insert(schema.systemWerte).values({ schluessel: "vapid", wert: JSON.stringify(v) }).onConflictDoNothing();
    r = await lesen();
  }
  cache = JSON.parse(r!.wert) as Vapid;
  return cache;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");

/** Signierter Ausweis (JWT, ES256) für den Push-Dienst des Abos. */
export function vapidJwt(endpoint: string, privatePem: string, jetzt = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const kopf = b64(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const inhalt = b64(JSON.stringify({ aud, exp: Math.floor(jetzt / 1000) + 12 * 3600, sub: process.env.VAPID_KONTAKT || "mailto:push@example.invalid" }));
  const sig = sign("sha256", Buffer.from(`${kopf}.${inhalt}`), { key: createPrivateKey(privatePem), dsaEncoding: "ieee-p1363" });
  return `${kopf}.${inhalt}.${sig.toString("base64url")}`;
}

export async function aboSpeichern(tenantId: string, userId: string, endpoint: string, geraet: string | null) {
  const u = new URL(endpoint);
  if (u.protocol !== "https:" && !(process.env.TESTDIENSTE_URL && endpoint.startsWith(process.env.TESTDIENSTE_URL))) throw new Error("Ungültige Push-Adresse.");
  await db
    .insert(P)
    .values({ tenantId, userId, endpoint: endpoint.slice(0, 2000), geraet: geraet?.slice(0, 120) ?? null })
    .onConflictDoUpdate({ target: P.endpoint, set: { tenantId, userId, fehlerAm: null } });
}

export async function aboLoeschen(tenantId: string, userId: string, endpoint: string) {
  await db.delete(P).where(and(eq(P.tenantId, tenantId), eq(P.userId, userId), eq(P.endpoint, endpoint)));
}

export async function abos(tenantId: string, userId: string) {
  return db.select({ id: P.id, geraet: P.geraet, createdAt: P.createdAt, fehlerAm: P.fehlerAm }).from(P).where(and(eq(P.tenantId, tenantId), eq(P.userId, userId)));
}

/** Neueste Meldung der letzten Stunde (holt der Service Worker nach dem Anstoß ab). */
export async function neuesteMeldung(tenantId: string, userId: string) {
  const [m] = await db
    .select({ id: M.id, titel: M.titel, text: M.text, link: M.link, aktionen: M.aktionen })
    .from(M)
    .where(and(eq(M.tenantId, tenantId), eq(M.userId, userId), gte(M.createdAt, new Date(Date.now() - 3600_000))))
    .orderBy(desc(M.createdAt))
    .limit(1);
  return m ?? null;
}

/** Personen mit Zugriff auf einen Bereich (Inhaber + ausdrücklich freigegebene, nicht nur ansehen). */
export async function empfaenger(tenantId: string, bereich: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.readOnly, false), or(eq(schema.memberships.role, "owner"), sql`${schema.memberships.areas} @> ${JSON.stringify([bereich])}::jsonb`)));
  return rows.map((r) => r.userId);
}

/**
 * Meldung an Personen: speichern, Push anstoßen (abgelaufene Abos werden entfernt). Ohne erfolgreichen Push →
 * Discord-Kanal für Aufgaben (falls eingerichtet). Liefert, wie viele Geräte angestoßen wurden.
 */
export type MeldungAktion = { aktion: string; titel: string; link: string };

export async function melden(tenantId: string, userIds: string[], m: { titel: string; text: string; link: string | null; aktionen?: MeldungAktion[] | null }, opts: { ohneDiscord?: boolean } = {}): Promise<{ push: number; discord: boolean }> {
  if (!userIds.length) return { push: 0, discord: false };
  // Knöpfe in der Benachrichtigung (Android/Desktop; iOS zeigt nur den Haupt-Link): höchstens zwei.
  const aktionen = m.aktionen?.length ? m.aktionen.slice(0, 2).map((a) => ({ aktion: a.aktion.slice(0, 30), titel: a.titel.slice(0, 40), link: a.link.slice(0, 500) })) : null;
  await db.insert(M).values(userIds.map((userId) => ({ tenantId, userId, titel: m.titel.slice(0, 120), text: m.text.slice(0, 500), link: m.link, aktionen })));
  const liste = await db.select().from(P).where(and(eq(P.tenantId, tenantId), inArray(P.userId, userIds), or(isNull(P.fehlerAm), gte(P.fehlerAm, new Date(Date.now() - 7 * 86_400_000)))));
  let push = 0;
  if (liste.length) {
    const v = await vapid();
    for (const a of liste) {
      try {
        const r = await fetch(a.endpoint, { method: "POST", headers: { TTL: "86400", Urgency: "high", Authorization: `vapid t=${vapidJwt(a.endpoint, v.privatePem)}, k=${v.publicKey}`, "Content-Length": "0" }, signal: AbortSignal.timeout(15_000) });
        if (r.status === 404 || r.status === 410) await db.delete(P).where(eq(P.id, a.id));
        else if (!r.ok) await db.update(P).set({ fehlerAm: new Date() }).where(eq(P.id, a.id));
        else push++;
      } catch {
        await db.update(P).set({ fehlerAm: new Date() }).where(eq(P.id, a.id));
      }
    }
  }
  let discord = false;
  // Private Meldungen (Privatbereich) nie in den gemeinsamen Discord-Kanal.
  if (!push && !opts.ohneDiscord) {
    const { notifyDiscord } = await import("@/lib/integrations/clients/discord");
    discord = await notifyDiscord(tenantId, `${m.titel}\n${m.text}`).catch(() => false);
  }
  // Alte Meldungen aufräumen (30 Tage).
  await db.delete(M).where(and(eq(M.tenantId, tenantId), sql`${M.createdAt} < now() - interval '30 days'`));
  return { push, discord };
}
