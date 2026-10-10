import "server-only";
import { and, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { LEAD_SOURCES, type LeadSource } from "@/db/schema";
import { brandSearchKey, leadBrandHits } from "./logic";

// Liste „Großhändler finden“: Ansicht (Reiter), Quelle und Markenfilter. Dieselben Filter gelten auf der
// Detailseite einer Firma – für „zurück zur Suche“ und „nächste Firma“.

const L = schema.supplierLeads;

export const LEAD_VIEWS = { offen: "Offen", grosshandel: "Großhändler", entwurf: "Entwürfe", angeschrieben: "Angeschrieben", ausgeschlossen: "Ausgeschlossen" } as const;
export type LeadView = keyof typeof LEAD_VIEWS;

export type ListContext = { view: LeadView; quelle: LeadSource | null; m: string };

/** Filter aus der Adresse (unbekannte Werte fallen weg). */
export function parseListContext(sp: { ansicht?: string | null; quelle?: string | null; m?: string | null }): ListContext {
  const view = sp.ansicht && sp.ansicht in LEAD_VIEWS ? (sp.ansicht as LeadView) : "offen";
  const quelle = LEAD_SOURCES.find((q) => q === sp.quelle) ?? null;
  const m = (sp.m ?? "").trim().slice(0, 80);
  // Nur Sonderzeichen („®“) = kein Filter.
  return { view, quelle, m: brandSearchKey(m) ? m : "" };
}

/** „ansicht=…&quelle=…&m=…“ – für Links zwischen Liste und Detailseite. */
export function listQuery(ctx: ListContext, patch: Partial<ListContext> = {}): string {
  const c = { ...ctx, ...patch };
  const q = new URLSearchParams({ ansicht: c.view });
  if (c.quelle) q.set("quelle", c.quelle);
  if (c.m) q.set("m", c.m);
  return q.toString();
}

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
  const key = ctx.m ? brandSearchKey(ctx.m) : "";
  if (key)
    w.push(sql`regexp_replace(translate(lower(coalesce(${L.brands}::text, '') || ' ' || ${L.searchBrands}::text || ' ' || ${L.findings}::text), 'äöüßéèêëáàâíìîóòôúùûñç', 'aouseeeeaaaiiiooouuunc'), '[^a-z0-9]', '', 'g') like ${`%${key}%`}`);
  return w;
}

/** Reihenfolge der Liste: Score, dann Name. */
export const listOrder = [desc(L.score), L.companyName] as const;

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
    .orderBy(...listOrder)
    .limit(5000);
  if (ctx.m) rows = rows.filter((l) => leadBrandHits(l, ctx.m).length > 0);
  const shown = rows.filter((l) => inView(l, ctx.view));
  const at = rows.findIndex((l) => l.id === currentId);
  const next = at >= 0 ? rows.slice(at + 1).find((l) => inView(l, ctx.view)) ?? null : null;
  const pos = shown.findIndex((l) => l.id === currentId);
  return { total: shown.length, position: pos >= 0 ? pos + 1 : null, next: next ? { id: next.id, companyName: next.companyName } : null };
}
