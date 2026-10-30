import "server-only";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { aufgabeZuweisen } from "@/lib/zeit/service";
import { personAus, wochenUebersicht, zuweisungsPlan, type Person, type PersonKey, type Regel } from "./logic";

// Delegieren: Zuständigkeit je Aufgabe (intern = Konto, extern = Name), Regeln mit Bestätigung beim ersten Mal,
// Wochenübersicht je Person.

const T = schema.tasks;

export async function personen(tenantId: string): Promise<Person[]> {
  const [team, s] = await Promise.all([
    db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.readOnly, false))),
    getSettings(tenantId),
  ]);
  return [
    ...team.map((m) => ({ key: `user:${m.id}` as PersonKey, name: m.name || m.email, art: "intern" as const })),
    ...s.delegieren.extern.map((n) => ({ key: `extern:${n}` as PersonKey, name: n, art: "extern" as const })),
  ];
}

/** Zuständig setzen: intern (mit Anleitungen) oder extern (nur Name); null = niemand Bestimmtes. */
export async function zustaendigSetzen(tenantId: string, taskId: string, person: string | null): Promise<{ ok: boolean; name: string | null }> {
  const p = person ? personAus(person) : null;
  if (person && !p) return { ok: false, name: null };
  if (p && "userId" in p) {
    const r = await aufgabeZuweisen(tenantId, taskId, p.userId);
    if (!r) return { ok: false, name: null };
    await db.update(T).set({ zustaendigExtern: null }).where(and(eq(T.tenantId, tenantId), eq(T.id, taskId)));
    const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, p.userId));
    return { ok: true, name: u?.name || u?.email || null };
  }
  const [row] = await db
    .update(T)
    .set({ assigneeId: null, anleitungIds: [], zustaendigExtern: p ? p.extern : null })
    .where(and(eq(T.tenantId, tenantId), eq(T.id, taskId)))
    .returning({ id: T.id });
  return { ok: !!row, name: p ? p.extern : null };
}

async function regelnLaden(tenantId: string) {
  const s = await getSettings(tenantId);
  return { regeln: s.delegieren.regeln, ausnahmen: new Set(s.delegieren.ausnahmen) };
}

async function delegierenSpeichern(tenantId: string, patch: { regeln?: Regel[]; ausnahmen?: string[]; extern?: string[] }) {
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const alt = t?.settings ?? {};
  await db
    .update(schema.tenants)
    .set({ settings: { ...alt, delegieren: { ...(alt.delegieren ?? {}), ...patch } } })
    .where(eq(schema.tenants.id, tenantId));
}

const offeneOhneZustaendig = (tenantId: string) =>
  db
    .select({ id: T.id, title: T.title, category: T.category, systemKey: T.systemKey, status: T.status, dueDate: T.dueDate, completedAt: T.completedAt, createdAt: T.createdAt, assigneeId: T.assigneeId, zustaendigExtern: T.zustaendigExtern })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), isNull(T.assigneeId), isNull(T.zustaendigExtern)));

/** Bestätigte Regeln anwenden (Zeitplan und Seitenaufruf); liefert die noch offenen Vorschläge. */
export async function zustaendigkeitenAnwenden(tenantId: string) {
  const { regeln, ausnahmen } = await regelnLaden(tenantId);
  if (!regeln.length) return { zugewiesen: 0, vorschlaege: [] as { id: string; title: string; person: PersonKey; typ: string }[] };
  const offen = await offeneOhneZustaendig(tenantId);
  const plan = zuweisungsPlan(offen, regeln, ausnahmen);
  for (const z of plan.zuweisen) await zustaendigSetzen(tenantId, z.id, z.person);
  const titel = new Map(offen.map((a) => [a.id, a.title]));
  return { zugewiesen: plan.zuweisen.length, vorschlaege: plan.vorschlaege.map((v) => ({ ...v, title: titel.get(v.id) ?? "" })) };
}

/** Vorschlag annehmen: diese Aufgabe zuweisen; mit „immer“ wird die Regel bestätigt (künftig automatisch). */
export async function vorschlagAnnehmen(tenantId: string, taskId: string, typ: string, immer: boolean) {
  const { regeln } = await regelnLaden(tenantId);
  const r = regeln.find((x) => x.typ === typ);
  if (!r) return false;
  await zustaendigSetzen(tenantId, taskId, r.person);
  if (immer && !r.bestaetigt) {
    await delegierenSpeichern(tenantId, { regeln: regeln.map((x) => (x.typ === typ ? { ...x, bestaetigt: true } : x)) });
    await zustaendigkeitenAnwenden(tenantId);
  }
  return true;
}

/** „Mache ich selbst“: Aufgabe aus den Vorschlägen nehmen. */
export async function vorschlagAblehnen(tenantId: string, taskId: string) {
  const s = await getSettings(tenantId);
  await delegierenSpeichern(tenantId, { ausnahmen: [...s.delegieren.ausnahmen.filter((x) => x !== taskId), taskId].slice(-500) });
}

export async function regelSetzen(tenantId: string, typ: string, person: string | null) {
  const s = await getSettings(tenantId);
  const t = typ.trim().toLowerCase();
  if (!/^(kategorie|schluessel|titel):.+/.test(t)) return false;
  const rest = s.delegieren.regeln.filter((r) => r.typ !== t);
  if (person) {
    if (!personAus(person)) return false;
    rest.push({ typ: t, person: person as PersonKey, bestaetigt: false });
  }
  await delegierenSpeichern(tenantId, { regeln: rest });
  return true;
}

export async function externSetzen(tenantId: string, namen: string[]) {
  await delegierenSpeichern(tenantId, { extern: [...new Set(namen.map((n) => n.trim().slice(0, 60)).filter(Boolean))].slice(0, 20) });
}

/** Wochenübersicht je Person (offen, überfällig, diese Woche erledigt/neu). */
export async function delegationWoche(tenantId: string, heute: string) {
  const [rows, ps] = await Promise.all([
    db
      .select({ id: T.id, title: T.title, category: T.category, systemKey: T.systemKey, status: T.status, dueDate: T.dueDate, completedAt: T.completedAt, createdAt: T.createdAt, assigneeId: T.assigneeId, zustaendigExtern: T.zustaendigExtern, link: T.link })
      .from(T)
      .where(and(eq(T.tenantId, tenantId), or(eq(T.status, "open"), gte(T.completedAt, new Date(`${addDaysIso(heute, -8)}T00:00:00Z`))))),
    personen(tenantId),
  ]);
  const namen = new Map(ps.map((p) => [p.key, p.name]));
  const mitZ = rows.filter((r) => r.assigneeId || r.zustaendigExtern);
  return {
    zeilen: wochenUebersicht(mitZ, heute).map((z) => ({ ...z, name: namen.get(z.person) ?? (z.person.startsWith("extern:") ? z.person.slice(7) : "?") })),
    ueberfaellig: mitZ.filter((r) => r.status === "open" && r.dueDate && r.dueDate < heute).map((r) => ({ id: r.id, titel: r.title, faellig: r.dueDate, link: r.link, person: namen.get((r.assigneeId ? `user:${r.assigneeId}` : `extern:${r.zustaendigExtern}`) as PersonKey) ?? r.zustaendigExtern ?? "?" })),
  };
}
