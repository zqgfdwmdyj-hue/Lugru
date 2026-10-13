import "server-only";
import { and, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { LEAD_SOURCES, type LeadSource } from "@/db/schema";
import { brandSearchKey, countryGroups, countrySpellings, leadBrandHits } from "./logic";

// Liste „Großhändler finden“: Ansicht (Reiter), Quelle, Markenfilter, Land und Sortierung. Dieselben Filter gelten auf der
// Detailseite einer Firma – für „zurück zur Suche“ und „nächste Firma“.

const L = schema.supplierLeads;

export const LEAD_VIEWS = { offen: "Offen", grosshandel: "Großhändler", entwurf: "Entwürfe", angeschrieben: "Angeschrieben", ausgeschlossen: "Ausgeschlossen" } as const;
export type LeadView = keyof typeof LEAD_VIEWS;

/** Sortierung: nach Score (Vorgabe) oder nach Land gruppiert (Deutschland zuerst). */
export type ListSort = "score" | "land";

/** `land`: einheitlicher Ländername, „ohne“ = ohne Land, leer = alle. */
export type ListContext = { view: LeadView; quelle: LeadSource | null; m: string; land: string; sort: ListSort };

export const NO_COUNTRY = "ohne";

/** Filter aus der Adresse (unbekannte Werte fallen weg). */
export function parseListContext(sp: { ansicht?: string | null; quelle?: string | null; m?: string | null; land?: string | null; sort?: string | null }): ListContext {
  const view = sp.ansicht && sp.ansicht in LEAD_VIEWS ? (sp.ansicht as LeadView) : "offen";
  const quelle = LEAD_SOURCES.find((q) => q === sp.quelle) ?? null;
  const m = (sp.m ?? "").trim().slice(0, 80);
  const land = (sp.land ?? "").trim().slice(0, 60);
  // Nur Sonderzeichen („®“) = kein Filter.
  return { view, quelle, m: brandSearchKey(m) ? m : "", land, sort: sp.sort === "land" ? "land" : "score" };
}

/** „ansicht=…&quelle=…&m=…&land=…&sort=…“ – für Links zwischen Liste und Detailseite. */
export function listQuery(ctx: ListContext, patch: Partial<ListContext> = {}): string {
  const c = { ...ctx, ...patch };
  const q = new URLSearchParams({ ansicht: c.view });
  if (c.quelle) q.set("quelle", c.quelle);
  if (c.m) q.set("m", c.m);
  if (c.land) q.set("land", c.land);
  if (c.sort === "land") q.set("sort", "land");
  return q.toString();
}

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
/** Einheitlicher Ländername in SQL (gleiche Zuordnung wie countryKey). */
export const countryKeySql = sql.raw(
  `(case ${countryGroups()
    .map(([name, aliases]) => `when lower(trim("supplier_leads"."country")) in (${aliases.map(lit).join(", ")}) then ${lit(name)}`)
    .join(" ")} else nullif(trim("supplier_leads"."country"), '') end)`,
);

/** Filter der Adresse wiederherstellen, z. B. aus einem versteckten Formularfeld. */
export const listQueryFrom = (raw: string) => listQuery(parseListContext(Object.fromEntries(new URLSearchParams(raw))));

type ViewRow = { status: string; kind: string; mailedAt: Date | null };

/** Gehört ein Kontakt in diese Ansicht? (wie viewWhere, für schon geladene Zeilen) */
export function inView(l: ViewRow, view: LeadView): boolean {
  if (view === "offen") return l.status === "neu" || l.status === "geprueft";
  if (view === "grosshandel") return l.kind === "grosshandel" && l.status !== "ausgeschlossen";
  if (view === "entwurf") return l.status === "entwurf";
  if (view === "angeschrieben") return l.mailedAt !== null;
  return l.status === "ausgeschlossen" || l.status === "kein_interesse";
}

export function viewWhere(view: LeadView): SQL[] {
  if (view === "offen") return [inArray(L.status, ["neu", "geprueft"])];
  if (view === "grosshandel") return [eq(L.kind, "grosshandel"), ne(L.status, "ausgeschlossen")];
  if (view === "entwurf") return [eq(L.status, "entwurf")];
  if (view === "angeschrieben") return [isNotNull(L.mailedAt)];
  return [inArray(L.status, ["ausgeschlossen", "kein_interesse"])];
}

/** Mandant, Quelle und grobe Marken-Vorauswahl (genau geprüft wird mit leadBrandHits). */
export function baseWhere(tenantId: string, ctx: ListContext): SQL[] {
  const w: SQL[] = [eq(L.tenantId, tenantId)];
  if (ctx.quelle) w.push(sql`${L.findings} @> ${JSON.stringify([{ source: ctx.quelle }])}::jsonb`);
  if (ctx.land === NO_COUNTRY) w.push(sql`nullif(trim(${L.country}), '') is null`);
  else if (ctx.land) w.push(sql`lower(trim(${L.country})) in (${sql.join(countrySpellings(ctx.land).map((x) => sql`${x}`), sql`, `)})`);
  const key = ctx.m ? brandSearchKey(ctx.m) : "";
  if (key)
    w.push(sql`regexp_replace(translate(lower(coalesce(${L.brands}::text, '') || ' ' || ${L.searchBrands}::text || ' ' || ${L.findings}::text), 'äöüßéèêëáàâíìîóòôúùûñç', 'aouseeeeaaaiiiooouuunc'), '[^a-z0-9]', '', 'g') like ${`%${key}%`}`);
  return w;
}

/** Reihenfolge der Liste: Score, dann Name – oder nach Land gruppiert (DACH zuerst, ohne Land zuletzt). */
export function listOrder(ctx: Pick<ListContext, "sort">): SQL[] {
  const byScore = [desc(L.score), sql`${L.companyName}`];
  if (ctx.sort !== "land") return byScore;
  return [
    sql`case ${countryKeySql} when 'Deutschland' then 0 when 'Österreich' then 1 when 'Schweiz' then 2 else (case when ${countryKeySql} is null then 9 else 5 end) end`,
    sql`lower(${countryKeySql})`,
    ...byScore,
  ];
}

/**
 * Position in der Liste und die nächste Firma danach (in derselben Ansicht, mit denselben Filtern).
 * Ist die Firma inzwischen aus der Ansicht gefallen (z. B. nach dem Senden nicht mehr „Offen“),
 * zählt ihr Platz in der Gesamtreihenfolge – „nächste“ ist dann die, die in der Liste unter ihr stand.
 */
export async function listNeighbours(tenantId: string, ctx: ListContext, currentId: string) {
  let rows = await db
    .select({ id: L.id, companyName: L.companyName, status: L.status, kind: L.kind, mailedAt: L.mailedAt, brands: L.brands, searchBrands: L.searchBrands, findings: L.findings })
    .from(L)
    .where(and(...baseWhere(tenantId, ctx)))
    .orderBy(...listOrder(ctx))
    .limit(5000);
  if (ctx.m) rows = rows.filter((l) => leadBrandHits(l, ctx.m).length > 0);
  const shown = rows.filter((l) => inView(l, ctx.view));
  const at = rows.findIndex((l) => l.id === currentId);
  const next = at >= 0 ? rows.slice(at + 1).find((l) => inView(l, ctx.view)) ?? null : null;
  const pos = shown.findIndex((l) => l.id === currentId);
  return { total: shown.length, position: pos >= 0 ? pos + 1 : null, next: next ? { id: next.id, companyName: next.companyName } : null };
}
