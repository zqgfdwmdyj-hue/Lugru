import "server-only";
import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { standortGrob, statusSatz, vorheizFaellig, zuHause, type HeizTermin } from "./vorheizen";

// Tesla (Modul 12): Status nur bei Bedarf (Tesla berechnet je Abfrage), Klima an/aus nur auf ausdrücklichen Wunsch,
// Vorheizen vor Terminen mit Ort nur wenn eingeschaltet und das Auto zu Hause steht. Kein Laden. Nur der Inhaber.

async function cfg(tenantId: string) {
  const t = await getIntegration(tenantId, "tesla");
  if (!t?.accessToken) return null;
  const s = (await getSettings(tenantId)).mobil;
  return { c: { ...t, vin: t.vin || s.tesla.vin }, s };
}

export type AutoStatus = { verbunden: boolean; vorlesen: string; akku?: number | null; reichweite_km?: number | null; standort?: string; innen_temp?: number | null; klima_an?: boolean | null; verriegelt?: boolean | null; fenster_offen?: boolean | null; reifen_warnung?: boolean | null; software_update?: string | null; navi_ziel?: string | null; ankunft_in_min?: number | null; fehler?: string };

/** Status jetzt (eine Abfrage beim Auto) + letzte Fahrten aus dem Fahrtenbuch. */
export async function autoStatus(session: Session): Promise<AutoStatus & { fahrten: { beginn: string; ziel: string | null; km: number; art: string }[] }> {
  const F = schema.fahrten;
  const fahrten = (await db.select().from(F).where(eq(F.tenantId, session.tenantId)).orderBy(desc(F.beginn)).limit(5)).map((f) => ({ beginn: f.beginn.toISOString().slice(0, 16).replace("T", " "), ziel: f.ziel ? f.ziel.split(",")[0].slice(0, 60) : null, km: f.km, art: f.art ?? `${f.vorschlag} (Vorschlag)` }));
  const k = await cfg(session.tenantId);
  if (!k) return { verbunden: false, vorlesen: "Tesla ist nicht verbunden.", fahrten };
  const { teslaStatus } = await import("@/lib/integrations/clients/tesla");
  try {
    const st = await teslaStatus(k.c);
    const heim = { lat: k.s.tesla.heimLat, lon: k.s.tesla.heimLon };
    const ort = standortGrob(st, heim);
    return {
      verbunden: true,
      vorlesen: statusSatz(st, ort),
      akku: st.akku,
      reichweite_km: st.reichweiteKm,
      standort: ort,
      innen_temp: st.innenTemp,
      klima_an: st.klimaAn,
      verriegelt: st.verriegelt,
      fenster_offen: st.fensterOffen,
      reifen_warnung: st.reifenWarnung,
      software_update: st.update,
      navi_ziel: st.ziel,
      ankunft_in_min: st.minutenBisAnkunft,
      fahrten,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : "Tesla nicht erreichbar.";
    return { verbunden: true, vorlesen: m, fehler: m, fahrten };
  }
}

/** Klima an (optional Zieltemperatur) oder aus – nur Inhaber, nur auf ausdrücklichen Wunsch. */
export async function autoKlima(session: Session, an: boolean, temperatur?: number | null): Promise<{ ok: boolean; vorlesen: string }> {
  if (session.role !== "owner" || session.readOnly) return { ok: false, vorlesen: "Nur der Inhaber kann das Auto steuern." };
  const k = await cfg(session.tenantId);
  if (!k) return { ok: false, vorlesen: "Tesla ist nicht verbunden (Anbindungen → Tesla)." };
  const { teslaKlima, teslaKlimaAus } = await import("@/lib/integrations/clients/tesla");
  try {
    if (an) await teslaKlima(k.c, typeof temperatur === "number" ? temperatur : undefined);
    else await teslaKlimaAus(k.c);
    return { ok: true, vorlesen: an ? `Klima an${typeof temperatur === "number" ? `, ${temperatur} Grad` : ""}.` : "Klima aus." };
  } catch (e) {
    return { ok: false, vorlesen: e instanceof Error ? e.message : "Tesla nicht erreichbar." };
  }
}

/** Heim-Standort = aktueller Standort des Autos (Knopf in den Einstellungen, wenn das Auto zu Hause steht). */
export async function heimUebernehmen(session: Session): Promise<string> {
  const k = await cfg(session.tenantId);
  if (!k) return "Tesla ist nicht verbunden.";
  const { teslaStatus } = await import("@/lib/integrations/clients/tesla");
  const st = await teslaStatus(k.c);
  if (st.lat === null || st.lon === null) return "Das Auto meldet keinen Standort.";
  const tesla = { ...k.s.tesla, heimLat: Math.round(st.lat * 1e5) / 1e5, heimLon: Math.round(st.lon * 1e5) / 1e5 };
  const { sql } = await import("drizzle-orm");
  await db
    .update(schema.tenants)
    .set({ settings: sql`jsonb_set(coalesce(${schema.tenants.settings}, '{}'::jsonb), '{mobil}', coalesce(${schema.tenants.settings}->'mobil', '{}'::jsonb) || jsonb_build_object('tesla', ${JSON.stringify(tesla)}::jsonb))` })
    .where(eq(schema.tenants.id, session.tenantId));
  return "Heim-Standort gespeichert (aktueller Standort des Autos).";
}

/** Termine der nächsten 3 Stunden mit Ort: Kalender (Geschäft + Privat) und private Termine aus Mails (Adresse). */
async function termineMitOrt(tenantId: string, jetzt: Date): Promise<HeizTermin[]> {
  const E = schema.calendarEvents;
  const bis = new Date(jetzt.getTime() + 3 * 3_600_000);
  const ev = await db
    .select({ id: E.id, title: E.title, startsAt: E.startsAt, location: E.location })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), eq(E.allDay, false), isNotNull(E.location), gte(E.startsAt, jetzt), lte(E.startsAt, bis)));
  const out: HeizTermin[] = ev.map((e) => ({ key: `ev:${e.id}`, titel: e.title, start: e.startsAt, ort: e.location, privat: false }));
  const { inhaberPrivatSitzung } = await import("@/lib/private/termin-mail-service");
  const s = await inhaberPrivatSitzung(tenantId);
  if (s) {
    const { loadEntries } = await import("@/lib/private/service");
    const heute = todayIso(jetzt);
    for (const e of await loadEntries<{ day: string; time?: string; title?: string; notes?: string; status?: string }>(s, ["termin"])) {
      const d = e.data;
      if (d.day !== heute || !d.time || d.status === "ausgefallen") continue;
      const ort = /Adresse: (.+)/.exec(d.notes ?? "")?.[1] ?? null;
      if (!/^\d{1,2}:\d{2}$/.test(d.time)) continue;
      // Uhrzeit ist Berliner Zeit – über den heutigen Versatz zu UTC umrechnen.
      const versatz = Date.parse(jetzt.toLocaleString("en-US", { timeZone: "Europe/Berlin" })) - Date.parse(jetzt.toLocaleString("en-US", { timeZone: "UTC" }));
      const t = new Date(Date.parse(`${heute}T${d.time.padStart(5, "0")}:00Z`) - versatz);
      if (t < jetzt || t > bis) continue;
      out.push({ key: `pr:${e.id}`, titel: d.title ?? "Termin", start: t, ort, notiz: d.notes ?? null, privat: true });
    }
  }
  return out;
}

/**
 * Hintergrund (alle 5 Min.): wenn eingeschaltet, X Minuten vor der Abfahrt zu einem Termin mit Ort Klima an –
 * nur wenn das Auto zu Hause steht (gespeicherter Heim-Standort), einmal je Termin. Meldung an den Inhaber.
 */
export async function vorheizenPruefen(tenantId: string, jetzt = new Date()): Promise<string | null> {
  const k = await cfg(tenantId);
  if (!k || !k.s.tesla.vorheizen) return null;
  const t = vorheizFaellig(await termineMitOrt(tenantId, jetzt), jetzt, { fahrzeitMin: k.s.fahrzeitMin, vorlaufMin: k.s.tesla.vorheizMin });
  if (!t) return null;
  const schluessel = `vorheizen:${t.key}:${todayIso(jetzt)}`;
  const neu = await db.insert(schema.formSubmissions).values({ tenantId, key: schluessel }).onConflictDoNothing().returning({ id: schema.formSubmissions.id });
  if (!neu.length) return null;
  const { teslaKlima, teslaStatus } = await import("@/lib/integrations/clients/tesla");
  const st = await teslaStatus(k.c);
  const heim = zuHause(st, { lat: k.s.tesla.heimLat, lon: k.s.tesla.heimLon });
  if (heim !== true) return heim === null ? "Heim-Standort fehlt – nicht vorgeheizt." : "Auto nicht zu Hause – nicht vorgeheizt.";
  await teslaKlima(k.c, k.s.tesla.zielTemp);
  const uhr = t.abfahrt.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const [owner] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"))).limit(1);
  if (owner) {
    const { melden } = await import("@/lib/push/service");
    await melden(tenantId, [owner.userId], { titel: "Auto wird vorgeheizt", text: `${k.s.tesla.zielTemp} Grad – Abfahrt ${uhr} zu ${t.privat ? "Termin außer Haus" : t.titel.slice(0, 60)}.`, link: "/kalender/tagesplan" }, { ohneDiscord: true }).catch(() => null);
  }
  return `Vorgeheizt für ${t.privat ? "Termin außer Haus" : t.titel} (Abfahrt ${uhr}).`;
}
