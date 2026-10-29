import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { anleitungenFuer, pruefungFaellig } from "@/lib/knowledge/anleitung";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { retourenwelle, rueckblick, standardFreiZeiten, verschiebePlan, type Block } from "./bloecke";
import { bloeckeGeaendert } from "./ausweich";
export { bloeckeGeaendert };

// Zeitblöcke (freie Zeiten, reservierte Kapazität), Retourenwelle-Meilenstein, Verschieben aus freien Tagen,
// Wochenrückblick; dazu Anleitungen: beim Zuweisen anhängen, Prüf-Erinnerung.

const Z = schema.zeitbloecke;
const T = schema.tasks;

export async function ladeBloecke(tenantId: string): Promise<Block[]> {
  const rows = await db.select().from(Z).where(eq(Z.tenantId, tenantId)).orderBy(asc(Z.art), asc(Z.sortierung), asc(Z.createdAt));
  return rows.map((r) => ({ id: r.id, art: r.art, titel: r.titel, userId: r.userId, wochentage: r.wochentage, ganztags: r.ganztags, vonZeit: r.vonZeit, bisZeit: r.bisZeit, gueltigVon: r.gueltigVon, gueltigBis: r.gueltigBis, stunden: r.stunden, link: r.link, aktiv: r.aktiv }));
}

/** Einmalig: Standard-Freizeiten (für den Inhaber), Retourenwelle (Reservierung ab 15.12. + Meilenstein). */
export async function planungEinrichten(tenantId: string, heute: string): Promise<void> {
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const p = t?.settings.planung ?? {};
  if (p.standardFrei && p.retourenwelle) return;
  const [owner] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"))).limit(1);
  const neu = { ...p };
  if (!p.standardFrei) {
    const vorhanden = await db.select({ id: Z.id }).from(Z).where(and(eq(Z.tenantId, tenantId), eq(Z.art, "frei"))).limit(1);
    if (!vorhanden.length) await db.insert(Z).values(standardFreiZeiten().map((b, i) => ({ tenantId, userId: owner?.userId ?? null, ...b, sortierung: i })));
    neu.standardFrei = true;
  }
  if (!p.retourenwelle) {
    const w = retourenwelle(heute);
    await db.insert(Z).values({ tenantId, userId: null, art: "reserviert", titel: "Retouren-Prüfung (Retourenwelle Januar)", wochentage: [1, 2, 3, 4, 5], ganztags: false, gueltigVon: w.reserviertAb, gueltigBis: w.reserviertBis, stunden: 2, link: "/retouren" });
    await upsertSystemTask(db, tenantId, "meilenstein-retouren-station", {
      title: "Meilenstein: Retouren-Station Phase 1 läuft (vor der Retourenwelle im Januar)",
      notes: `Bis Anfang Januar soll mindestens Phase 1 der Retouren-Station laufen (Prüfen mit Foto/Video, Entscheidung, Fall-Paket). Ab ${w.reserviertAb.split("-").reverse().join(".")} ist werktags Zeit für die Retouren-Prüfung reserviert.`,
      priority: "critical",
      category: "amazon",
      link: "/retouren",
      dueDate: w.meilenstein,
    });
    neu.retourenwelle = true;
  }
  await db.update(schema.tenants).set({ settings: { ...t!.settings, planung: neu } }).where(eq(schema.tenants.id, tenantId));
  bloeckeGeaendert(tenantId);
}

/** Offene Aufgaben der nächsten 30 Tage aus freien Tagen schieben. Rückfragen (heute + wichtig) bleiben stehen. */
export async function freieZeitenAnwenden(tenantId: string, heute: string): Promise<{ verschoben: number; rueckfragen: string[] }> {
  const bloecke = await ladeBloecke(tenantId);
  if (!bloecke.some((b) => b.art === "frei" && b.aktiv && b.ganztags)) return { verschoben: 0, rueckfragen: [] };
  const offen = await db
    .select({ id: T.id, dueDate: T.dueDate, priority: T.priority, category: T.category, assigneeId: T.assigneeId, status: T.status })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), isNotNull(T.dueDate), gte(T.dueDate, heute), lte(T.dueDate, addDaysIso(heute, 30))));
  const plan = verschiebePlan(offen, bloecke, heute);
  for (const v of plan.verschieben) await db.update(T).set({ dueDate: v.nach }).where(and(eq(T.tenantId, tenantId), eq(T.id, v.id)));
  return { verschoben: plan.verschieben.length, rueckfragen: plan.rueckfragen };
}

/** Für die Startseite: heute freier Tag/Abend, reservierte Zeit, Rückfragen (wichtig + Frist heute). */
export async function heuteZeit(tenantId: string, userId: string, heute: string) {
  const bloecke = (await ladeBloecke(tenantId)).filter((b) => b.userId === null || b.userId === userId);
  const { bloeckeAm, reserviertAm } = await import("./bloecke");
  const frei = bloeckeAm(bloecke, heute, "frei");
  const reserviert = reserviertAm(bloecke, heute);
  const freierTagHeute = frei.some((b) => b.ganztags);
  const rueckfragen = freierTagHeute
    ? await db.select({ id: T.id, title: T.title, link: T.link }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), eq(T.dueDate, heute), eq(T.priority, "critical")))
    : [];
  return { frei, reserviert, freierTagHeute, rueckfragen };
}

export async function wochenRueckblick(tenantId: string, userId: string, heute: string) {
  const bloecke = (await ladeBloecke(tenantId)).filter((b) => b.art === "frei" && (b.userId === null || b.userId === userId));
  if (!bloecke.length) return [];
  const erledigt = await db
    .select({ completedAt: T.completedAt, category: T.category })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "done"), gte(T.completedAt, new Date(`${addDaysIso(heute, -8)}T00:00:00Z`))));
  return rueckblick(bloecke, erledigt.filter((e): e is { completedAt: Date; category: (typeof erledigt)[number]["category"] } => !!e.completedAt), heute);
}

// ---- Anleitungen

const K = schema.knowledgeEntries;

/** Aufgabe zuweisen; passende Anleitungen hängen automatisch an. */
export async function aufgabeZuweisen(tenantId: string, taskId: string, userId: string | null): Promise<{ anleitungen: number } | null> {
  const [t] = await db.select({ title: T.title, category: T.category, systemKey: T.systemKey }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.id, taskId)));
  if (!t) return null;
  if (userId) {
    const [m] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.userId, userId)));
    if (!m) return null;
  }
  const anl = userId ? await db.select({ id: K.id, anleitung: K.anleitung }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.kind, "anleitung"))) : [];
  const ids = userId ? anleitungenFuer(t, anl) : [];
  await db.update(T).set({ assigneeId: userId, anleitungIds: ids }).where(and(eq(T.tenantId, tenantId), eq(T.id, taskId)));
  return { anleitungen: ids.length };
}

/** Prüf-Erinnerung: Anleitungen ungeprüft oder älter als 6 Monate → eine Sammelaufgabe „Anleitungen prüfen“. */
export async function anleitungenPruefen(tenantId: string): Promise<number> {
  const rows = await db.select({ id: K.id, title: K.title, verifiedAt: K.verifiedAt }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.kind, "anleitung")));
  const faellig = rows.filter((r) => pruefungFaellig(r.verifiedAt));
  if (!faellig.length) {
    await resolveSystemTask(db, tenantId, "anleitungen-pruefen");
    return 0;
  }
  await upsertSystemTask(db, tenantId, "anleitungen-pruefen", {
    title: faellig.length === 1 ? "Anleitung prüfen" : `${faellig.length} Anleitungen prüfen`,
    notes: faellig.slice(0, 15).map((r) => `• ${r.title} (${r.verifiedAt ? `zuletzt geprüft ${r.verifiedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}` : "noch nie geprüft"})`).join("\n"),
    category: "eigene",
    link: "/wissen?bereich=anleitung&pruefen=1",
  });
  return faellig.length;
}

/** Titel der angehängten Anleitungen (für Aufgabenkarten). */
export async function anleitungTitel(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: K.id, title: K.title }).from(K).where(and(eq(K.tenantId, tenantId), inArray(K.id, ids)));
  return new Map(rows.map((r) => [r.id, r.title]));
}
