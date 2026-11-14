import "server-only";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ABO_MAX_FEHLER, MELDE_ARTEN, RUHE_STANDARD, artAn, inRuhezeit, morgenText, uhrBerlin, zustellung, type MeldeArt } from "./logic";

// Push an die installierte App (Web Push nach RFC 8030 mit VAPID, ohne Inhalt): Die Meldung liegt in der Tabelle
// „meldungen“; der Service Worker holt sie nach dem Anstoß selbst ab und zeigt sie an (= zugestellt). Je Person:
// Arten an/aus und Ruhezeit (Einstellungen → Benachrichtigungen). Discord läuft parallel weiter (außer privat).

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
  // Neu angefordert (z. B. nach „abgelaufen“) → Zähler zurück, Gerät aktualisieren.
  await db
    .insert(P)
    .values({ tenantId, userId, endpoint: endpoint.slice(0, 2000), geraet: geraet?.slice(0, 120) ?? null })
    .onConflictDoUpdate({ target: P.endpoint, set: { tenantId, userId, fehlerAm: null, fehlerAnzahl: 0, abgelaufenAm: null, ...(geraet ? { geraet: geraet.slice(0, 120) } : {}) } });
}

export async function aboLoeschen(tenantId: string, userId: string, endpoint: string) {
  await db.delete(P).where(and(eq(P.tenantId, tenantId), eq(P.userId, userId), eq(P.endpoint, endpoint)));
}

export async function abos(tenantId: string, userId: string) {
  return db
    .select({ id: P.id, geraet: P.geraet, createdAt: P.createdAt, fehlerAm: P.fehlerAm, fehlerAnzahl: P.fehlerAnzahl, abgelaufenAm: P.abgelaufenAm, okAm: P.okAm })
    .from(P)
    .where(and(eq(P.tenantId, tenantId), eq(P.userId, userId)))
    .orderBy(desc(P.createdAt));
}

/** Stand des Abos dieses Geräts (beim Öffnen der App): unbekannt → neu anfordern, abgelaufen → neu anfordern. */
export async function aboStand(tenantId: string, userId: string, endpoint: string): Promise<{ stand: "ok" | "abgelaufen" | "unbekannt"; id: string | null }> {
  const [a] = await db.select({ id: P.id, abgelaufenAm: P.abgelaufenAm }).from(P).where(and(eq(P.tenantId, tenantId), eq(P.userId, userId), eq(P.endpoint, endpoint.slice(0, 2000))));
  if (!a) return { stand: "unbekannt", id: null };
  return { stand: a.abgelaufenAm ? "abgelaufen" : "ok", id: a.id };
}

/**
 * Neueste Meldung der letzten Stunde (holt der Service Worker nach dem Anstoß ab) – nur, was wirklich ans Handy ging
 * (nicht zurückgehalten/ausgeschaltet; Test-Pushs nur für das Gerät, für das sie gedacht sind). Das Abholen gilt als
 * „zugestellt“ (Protokoll). Für Sperrbildschirm und Apple Watch gekürzt: Titel höchstens 60, Text höchstens 120 Zeichen.
 */
export async function neuesteMeldung(tenantId: string, userId: string, endpoint?: string | null) {
  const abo = endpoint ? await aboStand(tenantId, userId, endpoint) : null;
  const [m] = await db
    .select({ id: M.id, titel: M.titel, text: M.text, link: M.link, aktionen: M.aktionen, zugestelltAm: M.zugestelltAm })
    .from(M)
    .where(
      and(
        eq(M.tenantId, tenantId),
        eq(M.userId, userId),
        gte(M.createdAt, new Date(Date.now() - 3600_000)),
        inArray(M.zustand, ["gesendet", "fehlgeschlagen", "ausgeliefert"]),
        abo?.id ? or(isNull(M.nurAboId), eq(M.nurAboId, abo.id)) : isNull(M.nurAboId),
      ),
    )
    .orderBy(desc(M.createdAt))
    .limit(1);
  if (!m) return null;
  if (!m.zugestelltAm) await db.update(M).set({ zugestelltAm: new Date() }).where(eq(M.id, m.id));
  const { pushKurz } = await import("@/lib/mobil/watch-logic");
  return { id: m.id, link: m.link, aktionen: m.aktionen, ...pushKurz(m) };
}

/** Personen mit Zugriff auf einen Bereich (Inhaber + ausdrücklich freigegebene, nicht nur ansehen). */
export async function empfaenger(tenantId: string, bereich: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.readOnly, false), or(eq(schema.memberships.role, "owner"), sql`${schema.memberships.areas} @> ${JSON.stringify([bereich])}::jsonb`)));
  return rows.map((r) => r.userId);
}

export type MeldungAktion = { aktion: string; titel: string; link: string };
export type MeldungBezug = { art: "aufgabe" | "amazon_todo"; id: string; titel: string };
export type MeldungEingabe = { titel: string; text: string; link: string | null; aktionen?: MeldungAktion[] | null; bezug?: MeldungBezug | null; art?: MeldeArt; kritisch?: boolean };
export type MeldenOptionen = {
  /** Private Meldungen (Privatbereich, Tesla …) nie in den gemeinsamen Discord-Kanal. */
  ohneDiscord?: boolean;
  /** Discord lief schon separat (z. B. VA-Rückfrage) – nur fürs Protokoll. */
  discordSchon?: boolean;
  /** Test-Push: nur an dieses Abo. */
  nurAboId?: string;
};

/** Anstoß an ein Abo; pflegt Fehlerzähler (3 in Folge = abgelaufen; 404/410 = sofort abgelaufen). */
async function anstossen(a: typeof P.$inferSelect, v: Vapid): Promise<boolean> {
  try {
    const r = await fetch(a.endpoint, { method: "POST", headers: { TTL: "86400", Urgency: "high", Authorization: `vapid t=${vapidJwt(a.endpoint, v.privatePem)}, k=${v.publicKey}`, "Content-Length": "0" }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) {
      await db.update(P).set({ fehlerAnzahl: 0, fehlerAm: null, okAm: new Date() }).where(eq(P.id, a.id));
      return true;
    }
    const weg = r.status === 404 || r.status === 410;
    await db
      .update(P)
      .set({ fehlerAm: new Date(), fehlerAnzahl: sql`${P.fehlerAnzahl} + 1`, abgelaufenAm: weg ? new Date() : sql`case when ${P.fehlerAnzahl} + 1 >= ${ABO_MAX_FEHLER} then now() else ${P.abgelaufenAm} end` })
      .where(eq(P.id, a.id));
  } catch {
    await db
      .update(P)
      .set({ fehlerAm: new Date(), fehlerAnzahl: sql`${P.fehlerAnzahl} + 1`, abgelaufenAm: sql`case when ${P.fehlerAnzahl} + 1 >= ${ABO_MAX_FEHLER} then now() else ${P.abgelaufenAm} end` })
      .where(eq(P.id, a.id));
  }
  return false;
}

/** Bereits gespeicherte Meldungen ans Handy schicken (alle nicht abgelaufenen Abos der Person bzw. nur das Test-Abo). */
async function zustellen(tenantId: string, zeilen: { id: string; userId: string; nurAboId: string | null }[], neuerZustand: "gesendet" | "ausgeliefert" = "gesendet"): Promise<number> {
  if (!zeilen.length) return 0;
  const userIds = [...new Set(zeilen.map((z) => z.userId))];
  const liste = await db.select().from(P).where(and(eq(P.tenantId, tenantId), inArray(P.userId, userIds), isNull(P.abgelaufenAm)));
  const v = liste.length ? await vapid() : null;
  let push = 0;
  for (const z of zeilen) {
    const ziele = liste.filter((a) => a.userId === z.userId && (!z.nurAboId || a.id === z.nurAboId));
    let ok = 0;
    let fehler = 0;
    for (const a of ziele) (await anstossen(a, v!)) ? ok++ : fehler++;
    push += ok;
    await db
      .update(M)
      .set({ pushGesendet: ok, pushFehler: fehler, zustand: !ziele.length ? "kein_geraet" : ok ? neuerZustand : "fehlgeschlagen" })
      .where(eq(M.id, z.id));
  }
  return push;
}

/**
 * Meldung an Personen: je Person nach ihren Einstellungen (Art an/aus, Ruhezeit 22–6 Uhr nur „kritisch“) senden,
 * zurückhalten (kommt morgens mit dem Morgenbericht) oder nur protokollieren. Discord läuft parallel (außer privat).
 * Jede Meldung steht im Push-Protokoll (Einstellungen → Benachrichtigungen).
 */
export async function melden(tenantId: string, userIds: string[], m: MeldungEingabe, opts: MeldenOptionen = {}): Promise<{ push: number; discord: boolean; zurueckgehalten: number; ids: string[] }> {
  if (!userIds.length) return { push: 0, discord: false, zurueckgehalten: 0, ids: [] };
  // Knöpfe in der Benachrichtigung (Android/Desktop; iOS zeigt nur den Haupt-Link): höchstens zwei.
  const aktionen = m.aktionen?.length ? m.aktionen.slice(0, 2).map((a) => ({ aktion: a.aktion.slice(0, 30), titel: a.titel.slice(0, 40), link: a.link.slice(0, 500) })) : null;
  const bezug = m.bezug ? { art: m.bezug.art, id: m.bezug.id, titel: m.bezug.titel.slice(0, 200) } : null;
  const art: MeldeArt = m.art ?? "sonstiges";
  const kritisch = Boolean(m.kritisch) || MELDE_ARTEN.some((a) => a.key === art && "kritisch" in a && a.kritisch);
  const { getSettings } = await import("@/lib/settings");
  const personen = (await getSettings(tenantId)).benachrichtigungen.personen;
  const jetzt = new Date();
  // Discord parallel (nichts abgeschaltet): einmal je Meldung in den Aufgaben-Kanal – privat nie.
  let discord: boolean | null = null;
  if (opts.discordSchon !== undefined) discord = opts.discordSchon;
  else if (!opts.ohneDiscord) {
    const { notifyDiscord } = await import("@/lib/integrations/clients/discord");
    discord = await notifyDiscord(tenantId, `${m.titel}\n${m.text}`).catch(() => false);
  }
  const zeilen = await db
    .insert(M)
    .values(
      [...new Set(userIds)].map((userId) => {
        const z = zustellung(art, kritisch, personen[userId], jetzt);
        return { tenantId, userId, titel: m.titel.slice(0, 120), text: m.text.slice(0, 500), link: m.link, aktionen, bezug, art, kritisch, discord, nurAboId: opts.nurAboId ?? null, zustand: z === "senden" ? "gesendet" : z === "zurueckhalten" ? "zurueckgehalten" : "ausgeschaltet" };
      }),
    )
    .returning({ id: M.id, userId: M.userId, zustand: M.zustand, nurAboId: M.nurAboId });
  const push = await zustellen(tenantId, zeilen.filter((z) => z.zustand === "gesendet"));
  // Alte Meldungen aufräumen (30 Tage).
  await db.delete(M).where(and(eq(M.tenantId, tenantId), sql`${M.createdAt} < now() - interval '30 days'`));
  return { push, discord: Boolean(discord), zurueckgehalten: zeilen.filter((z) => z.zustand === "zurueckgehalten").length, ids: zeilen.map((z) => z.id) };
}

/** Test-Push an genau dieses Gerät (Prüfseite) – liefert die Meldungs-ID für die Zustellzeit. */
export async function testPush(tenantId: string, userId: string, endpoint: string): Promise<{ ok: boolean; id: string | null; fehler?: string }> {
  const abo = await aboStand(tenantId, userId, endpoint);
  if (!abo.id) return { ok: false, id: null, fehler: "Dieses Gerät hat kein Push-Abo – oben „Push einschalten“." };
  if (abo.stand === "abgelaufen") await db.update(P).set({ abgelaufenAm: null, fehlerAnzahl: 0 }).where(eq(P.id, abo.id));
  const uhr = new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const r = await melden(tenantId, [userId], { titel: "Test-Push ✅", text: `Gesendet ${uhr} – kommt an, auch wenn die App geschlossen ist.`, link: "/einstellungen/benachrichtigungen", art: "test" }, { ohneDiscord: true, nurAboId: abo.id });
  return { ok: r.push > 0, id: r.ids[0] ?? null, fehler: r.push ? undefined : "Der Push-Dienst hat abgelehnt – Abo wird beim nächsten Öffnen neu angefordert." };
}

/** Wann hat das Gerät eine Meldung abgeholt (Prüfseite fragt nach)? */
export async function meldungStand(tenantId: string, userId: string, id: string) {
  const [m] = await db.select({ zustand: M.zustand, createdAt: M.createdAt, zugestelltAm: M.zugestelltAm, pushGesendet: M.pushGesendet, pushFehler: M.pushFehler }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.userId, userId), eq(M.id, id)));
  if (!m) return null;
  return { ...m, sekunden: m.zugestelltAm ? Math.max(0, Math.round((m.zugestelltAm.getTime() - m.createdAt.getTime()) / 100) / 10) : null };
}

/** Push-Protokoll der Person (neueste zuerst). */
export async function protokoll(tenantId: string, userId: string, limit = 50) {
  return db
    .select({ id: M.id, titel: M.titel, art: M.art, kritisch: M.kritisch, zustand: M.zustand, pushGesendet: M.pushGesendet, pushFehler: M.pushFehler, discord: M.discord, zugestelltAm: M.zugestelltAm, createdAt: M.createdAt })
    .from(M)
    .where(and(eq(M.tenantId, tenantId), eq(M.userId, userId)))
    .orderBy(desc(M.createdAt))
    .limit(limit);
}

const OFFENE_SENDUNG = sql`('geplant','unterwegs','verzoegert','problem')`;

/**
 * Morgens nach der Ruhezeit (je Person, einmal am Tag): Morgenbericht mit Link – dabei Fristen heute, wichtige
 * Aufgaben, Paletten-Sendungen heute und was über Nacht zurückgehalten wurde. Zurückgehaltene Meldungen gelten damit
 * als „morgens nachgereicht“; einzeln nachgeschickt wird nur die neueste (Knöpfe wie „In den Warenkorb“ bleiben).
 */
export async function morgenAuslieferung(tenantId: string, jetzt = new Date(), o: { nurUserId?: string; sofort?: boolean } = {}): Promise<{ personen: number; nachgereicht: number }> {
  const { getSettings } = await import("@/lib/settings");
  const personen = (await getSettings(tenantId)).benachrichtigungen.personen;
  const uhr = uhrBerlin(jetzt);
  const heute = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(jetzt);
  const mitglieder = await db
    .select({ userId: schema.memberships.userId, role: schema.memberships.role, areas: schema.memberships.areas })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.readOnly, false), isNull(schema.memberships.deaktiviertAm), o.nurUserId ? eq(schema.memberships.userId, o.nurUserId) : undefined));
  let anzahl = 0;
  let nachgereicht = 0;
  for (const mg of mitglieder) {
    const p = personen[mg.userId];
    const bis = p?.ruheBis ?? RUHE_STANDARD.bis;
    const von = p?.ruheVon ?? RUHE_STANDARD.von;
    // „Sofort“ (Knopf „Zurückgehaltenes jetzt ausliefern“): ohne Uhrzeit- und Einmal-am-Tag-Prüfung.
    if (!o.sofort && (inRuhezeit(uhr, von, bis) || uhr < bis)) continue;
    // Einmal am Tag: Morgenbericht für heute schon da?
    const [schon] = o.sofort ? [] : await db
      .select({ id: M.id })
      .from(M)
      .where(and(eq(M.tenantId, tenantId), eq(M.userId, mg.userId), eq(M.art, "morgenbericht"), sql`(${M.createdAt} at time zone 'Europe/Berlin')::date = ${heute}::date`))
      .limit(1);
    if (schon) continue;
    // Nur Personen mit Push-Abo (sonst gäbe es nichts zuzustellen).
    const [abo] = await db.select({ id: P.id }).from(P).where(and(eq(P.tenantId, tenantId), eq(P.userId, mg.userId))).limit(1);
    if (!abo) continue;
    const gehalten = await db
      .select({ id: M.id, userId: M.userId, nurAboId: M.nurAboId, art: M.art })
      .from(M)
      .where(and(eq(M.tenantId, tenantId), eq(M.userId, mg.userId), eq(M.zustand, "zurueckgehalten")))
      .orderBy(desc(M.createdAt));
    const inhaber = mg.role === "owner";
    const darf = (bereich: string) => inhaber || mg.areas === null || (Array.isArray(mg.areas) && mg.areas.includes(bereich));
    const T = schema.tasks;
    const [{ fristen, wichtig }] = await db
      .select({ fristen: sql<number>`count(*) filter (where ${T.dueDate} = ${heute})::int`, wichtig: sql<number>`count(*) filter (where ${T.priority} = 'critical')::int` })
      .from(T)
      .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), or(isNull(T.assigneeId), eq(T.assigneeId, mg.userId)), sql`(${T.dueDate} is null or ${T.dueDate} <= ${heute})`));
    let paletten = 0;
    if (darf("paletten")) {
      const S = schema.palletShipments;
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(S).where(and(eq(S.tenantId, tenantId), eq(S.plannedDate, heute), sql`${S.status} in ${OFFENE_SENDUNG}`));
      paletten = n;
    }
    const arten = (p?.aus ?? []) as string[];
    // B32: persönliche Mails nur als Anzahl – und nur für den Inhaber mit Privat-Zugang.
    const persoenlich = inhaber ? await import("@/lib/inbox/persoenlich").then((x) => x.offenePersoenliche(tenantId, mg.userId)).catch(() => 0) : 0;
    // Repricing: Abgleich Seller-System ↔ ProfitGuard (auffällige SKUs, Alter des Exports) – nur für den Inhaber.
    const repricing = inhaber ? await repricingMorgenZeile(tenantId, jetzt).catch(() => null) : null;
    // Buy-Box-Anteil je Land aus ProfitGuard bzw. dem Amazon-Geschäftsbericht – nur für den Inhaber.
    const buybox = inhaber ? await import("@/lib/repricing/profitguard-service").then((x) => x.buyboxMorgenZeile(tenantId)).catch(() => null) : null;
    // B35: Lead-Maschine (neue Leads, Entwürfe warten auf Freigabe, Rückmeldungen, Kosten) – nur für den Inhaber.
    const leads = inhaber ? await import("@/lib/abverkauf/lead-maschine").then((x) => x.leadsMorgen(tenantId)).catch(() => null) : null;
    // B28.8: einmal im Monat (am 3.) die Trefferquote des Vormonats – nur für den Inhaber.
    const treffer = inhaber ? await import("@/lib/deal-eingang/lernschleife").then((x) => x.trefferMorgenZeile(tenantId)).catch(() => null) : null;
    // B31.6: SKUs auf Liquidation wegen Min unter Marge – nur für den Inhaber.
    const liquidation = inhaber ? await import("@/lib/repricing/liquidation").then(async (x) => x.liquidationsZeile(await x.liquidationsStand(tenantId))).catch(() => null) : null;
    // B31.6b/B31.7/B31.8/B32: Stand des täglichen Leiter-Laufs und Listing-Check – nur für den Inhaber.
    const leiter = inhaber ? await import("@/lib/repricing/leiter-logic").then(async (x) => [...x.leiterMorgenZeilen((await (await import("@/lib/settings")).getSettings(tenantId)).repricing.leiterStand), ...(await import("@/lib/repricing/listing-check").then((c) => c.listingCheckMorgenZeilen(tenantId)).catch(() => []))]).catch(() => []) : [];
    const zahlen = { ueberNacht: gehalten.length, fristen: arten.includes("frist_heute") ? 0 : fristen, wichtig: arten.includes("frist_heute") ? 0 : wichtig, paletten: arten.includes("paletten_heute") ? 0 : paletten, persoenlich, repricing, buybox, treffer, liquidation, leiter, leads };
    // Zurückgehaltene gelten als nachgereicht (im Bericht gezählt); die neueste kommt einzeln (mit ihren Knöpfen).
    if (gehalten.length) {
      await db.update(M).set({ zustand: "ausgeliefert" }).where(inArray(M.id, gehalten.map((g) => g.id)));
      nachgereicht += gehalten.length;
    }
    // Morgenbericht (nach der Ruhezeit – zurückgehalten wird hier nichts mehr; nur „Art aus“ gilt).
    const [neu] = await db
      .insert(M)
      .values({ tenantId, userId: mg.userId, titel: "☀️ Morgenbericht liegt vor", text: morgenText(zahlen), link: "/", art: "morgenbericht", discord: null, zustand: artAn("morgenbericht", p) ? "gesendet" : "ausgeschaltet" })
      .returning({ id: M.id, userId: M.userId, nurAboId: M.nurAboId, zustand: M.zustand });
    if (neu.zustand === "gesendet") await zustellen(tenantId, [neu]);
    // Einzelne Morgen-Meldungen (eigene Arten): Frist heute und Paletten heute, wenn an.
    const morgens = async (art: "frist_heute" | "paletten_heute", titel: string, text: string, link: string) => {
      if (!artAn(art, p)) return;
      const [z] = await db.insert(M).values({ tenantId, userId: mg.userId, titel, text, link, art, discord: null, zustand: "gesendet" }).returning({ id: M.id, userId: M.userId, nurAboId: M.nurAboId });
      await zustellen(tenantId, [z]);
    };
    if (zahlen.fristen) await morgens("frist_heute", `📅 ${zahlen.fristen} Frist${zahlen.fristen === 1 ? "" : "en"} heute`, zahlen.wichtig ? `${zahlen.wichtig} wichtig – Tagesplan ansehen.` : "Tagesplan ansehen.", "/kalender/tagesplan");
    if (zahlen.paletten) await morgens("paletten_heute", `🚚 ${zahlen.paletten} Paletten-Sendung${zahlen.paletten === 1 ? "" : "en"} heute`, "Speditions-Sendungen mit Termin heute.", "/paletten/sendungen");
    // Die neueste zurückgehaltene Meldung (z. B. Deal mit „In den Warenkorb“) zuletzt – steht damit oben.
    if (gehalten[0]) {
      await db.update(M).set({ createdAt: new Date() }).where(eq(M.id, gehalten[0].id));
      await zustellen(tenantId, [gehalten[0]], "ausgeliefert");
    }
    anzahl++;
  }
  return { personen: anzahl, nachgereicht };
}

/** Morgenbericht-Zeile zum Repricing: offene Abgleich-Aufgabe (ProfitGuard) und Alter des letzten ProfitGuard-Exports. */
async function repricingMorgenZeile(tenantId: string, jetzt: Date): Promise<string | null> {
  const T = schema.tasks;
  const [a] = await db.select({ title: T.title }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.systemKey, "repricing-abgleich"), eq(T.status, "open")));
  const { profitguardStand } = await import("@/lib/repricing/profitguard-service");
  const stand = await profitguardStand(tenantId);
  const juengster = stand.reduce<Date | null>((m, x) => (x.am && (!m || x.am > m) ? x.am : m), null);
  const alt = !juengster ? "noch kein ProfitGuard-Export eingelesen" : jetzt.getTime() - juengster.getTime() > 3 * 86_400_000 ? `ProfitGuard-Export ${Math.floor((jetzt.getTime() - juengster.getTime()) / 86_400_000)} Tage alt` : null;
  const teile = [a?.title ?? null, alt].filter(Boolean);
  return teile.length ? teile.join(" · ") : null;
}
