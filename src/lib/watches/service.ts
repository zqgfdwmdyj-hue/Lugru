import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { brandAllowed } from "@/lib/auth/areas";
import { requireArea, type Session } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/service";
import { getIntegration } from "@/lib/integrations/store";
import { TAX_SHORT } from "./calc";
import { LESSONS, type LessonProgress } from "./lessons";
import { dealResult, DEAL_STATUS_LABEL, normRef, priceSummary, SET_LABEL, type DealLike, type PriceNote } from "./logic";

// Uhren Buy & Flip gehört zur Marke Zeitlux: Wer Zeitlux sehen darf, darf auch hier lernen und Deals führen.
// Jede Abfrage filtert nach tenant_id.

export type FlipCtx = { session: Session; brandId: string | null; brandName: string };

/** Zugang prüfen: Bereich „Marken“ und Freigabe für Zeitlux (gibt es keine Zeitlux-Marke, nur ohne Marken-Beschränkung). */
export async function requireFlip(): Promise<FlipCtx> {
  const session = await requireArea("marken");
  const brand = (await listBrands(session.tenantId)).find((b) => /zeitlux/i.test(b.name)) ?? null;
  if (brand) {
    if (!brandAllowed(session.brandIds, session.role, brand.id)) redirect("/marken?gesperrt=1");
    return { session, brandId: brand.id, brandName: brand.name };
  }
  if (session.role !== "owner" && session.brandIds !== null) redirect("/marken?gesperrt=1");
  return { session, brandId: null, brandName: "Zeitlux" };
}

export type Deal = typeof schema.watchDeals.$inferSelect;
const D = schema.watchDeals;
const P = schema.watchPrices;
const L = schema.watchLearn;

export const costSum = (d: Pick<Deal, "costs">) => Math.round(d.costs.reduce((s, c) => s + (Number(c.amount) || 0), 0) * 100) / 100;
export const asDealLike = (d: Deal): DealLike => ({ status: d.status, practice: d.practice, taxMode: d.taxMode, buyPrice: d.buyPrice, buyDate: d.buyDate, costs: costSum(d), sellPrice: d.sellPrice, sellDate: d.sellDate, targetSell: d.targetSell, feePct: d.feePct, feeFixed: d.feeFixed, shipping: d.shipping });

export async function listDeals(tenantId: string): Promise<Deal[]> {
  return db.select().from(D).where(eq(D.tenantId, tenantId)).orderBy(desc(D.updatedAt)).limit(1000);
}

export async function getDeal(tenantId: string, id: string): Promise<Deal | null> {
  const [d] = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  return d ?? null;
}

export async function listPrices(tenantId: string, refKey?: string) {
  return db
    .select()
    .from(P)
    .where(refKey ? and(eq(P.tenantId, tenantId), eq(P.refKey, refKey)) : eq(P.tenantId, tenantId))
    .orderBy(desc(P.day), desc(P.createdAt))
    .limit(2000);
}

export const asNote = (p: typeof schema.watchPrices.$inferSelect): PriceNote => ({ reference: p.reference, kind: p.kind, price: p.price, day: p.day, condition: p.condition, fullSet: p.fullSet });

export async function learnProgress(tenantId: string, userId: string): Promise<LessonProgress[]> {
  const rows = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.userId, userId))).orderBy(asc(L.lesson));
  return rows.map((r) => ({ lesson: r.lesson, done: r.done, bestCorrect: r.bestCorrect, total: r.total }));
}

/** Quiz-Ergebnis speichern; bestanden (alles richtig) = Lektion erledigt. Das beste Ergebnis bleibt. */
export async function saveQuiz(tenantId: string, userId: string, lesson: string, correct: number, total: number) {
  if (!LESSONS.some((l) => l.key === lesson)) throw new Error("Lektion nicht gefunden.");
  const [cur] = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.userId, userId), eq(L.lesson, lesson)));
  const best = Math.max(cur?.bestCorrect ?? 0, correct);
  const done = Boolean(cur?.done) || (total > 0 && correct === total);
  await db
    .insert(L)
    .values({ tenantId, userId, lesson, done, bestCorrect: best, total })
    .onConflictDoUpdate({ target: [L.tenantId, L.userId, L.lesson], set: { done, bestCorrect: best, total, updatedAt: new Date() } });
  return { done };
}

export async function setLessonDone(tenantId: string, userId: string, lesson: string, done: boolean) {
  if (!LESSONS.some((l) => l.key === lesson)) throw new Error("Lektion nicht gefunden.");
  await db
    .insert(L)
    .values({ tenantId, userId, lesson, done })
    .onConflictDoUpdate({ target: [L.tenantId, L.userId, L.lesson], set: { done, updatedAt: new Date() } });
}

// ---- KI-Coach ---------------------------------------------------------------------------------------------

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

/**
 * Einschätzung eines Deals durch die KI: Risiken, offene Prüfungen, Rechenfehler, Verhandlung, Lernpunkt.
 * Bekommt nur die Angaben des Deals und die eigenen Marktpreis-Notizen – erfindet keine Marktpreise.
 */
export async function coachDeal(tenantId: string, id: string): Promise<string> {
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) throw new Error("Für den KI-Coach unter Anbindungen → „KI (Claude)“ einen Schlüssel eintragen.");
  const d = await getDeal(tenantId, id);
  if (!d) throw new Error("Deal nicht gefunden.");
  const notes = d.reference ? (await listPrices(tenantId, normRef(d.reference))).map(asNote) : [];
  const sum = d.reference ? priceSummary(notes, d.reference) : {};
  const r = dealResult(asDealLike(d));
  const open = d.checklist.filter((c) => !c.done).map((c) => `- ${c.text}`);
  const prompt = [
    "Du bist ein erfahrener, nüchterner Uhrenhändler und Coach für Einsteiger im An- und Verkauf (Buy & Flip) in Deutschland.",
    "Beurteile den folgenden Deal. Wichtig: Erfinde KEINE Marktpreise und nenne keine konkreten Preise, die nicht unten stehen. Wenn Vergleichspreise fehlen, sag, welche der Lernende erheben soll.",
    "Antworte auf Deutsch, knapp, in diesen Abschnitten mit kurzen Spiegelstrichen: **Einschätzung** (1–2 Sätze), **Risiken**, **Vor dem Kauf/Verkauf noch prüfen**, **Rechnung** (fehlende Kosten, Steuerart, Puffer), **Verhandlung**, **Lernpunkt** (ein Satz). Keine Steuer- oder Rechtsberatung, nur Hinweise, was zu klären ist.",
    "",
    `Uhr: ${d.maker} ${d.model ?? ""} · Referenz ${d.reference ?? "unbekannt"} · Baujahr ${d.year ?? "unbekannt"} · ${d.condition} · ${SET_LABEL[d.watchSet]}`,
    `Status: ${DEAL_STATUS_LABEL[d.status]}${d.practice ? " (Übungs-Deal, nur auf dem Papier)" : ""} · Quelle: ${d.source ?? "–"} · Steuer: ${TAX_SHORT[d.taxMode]}`,
    `Angebotspreis: ${eur(d.askPrice)} · Ankauf: ${eur(d.buyPrice)} · Nebenkosten: ${eur(costSum(d))} (${d.costs.map((c) => `${c.label} ${eur(c.amount)}`).join(", ") || "keine"})`,
    `Ziel-Verkauf: ${eur(d.targetSell)} · Verkauft: ${eur(d.sellPrice)} · Kanal: ${d.channel ?? "–"} · Gebühren: ${d.feePct} % + ${eur(d.feeFixed)} · Versand: ${eur(d.shipping)}`,
    r ? `Rechnung: Gewinn ${eur(r.profit)} (${r.marginPct ?? "–"} % vom Verkaufspreis), Umsatzsteuer ${eur(r.vat)}, Break-even ${eur(r.breakEven)}${r.planned ? " – geplant" : ""}` : "Rechnung: noch unvollständig (Ankauf oder Ziel-Verkauf fehlt).",
    `Eigene Marktpreis-Notizen zur Referenz: ${Object.entries(sum).map(([k, s]) => `${k}: ${s!.n}× (${eur(s!.min)} – ${eur(s!.max)}, Median ${eur(s!.median)})`).join("; ") || "keine"}`,
    `Offene Punkte der Prüfliste:\n${open.join("\n") || "- keine"}`,
    d.notes ? `Notizen: ${d.notes.slice(0, 1500)}` : "",
  ].join("\n");
  const res = await askClaude(ai.apiKey, prompt, { model: modelFor(ai, "creative"), task: "simple", maxTokens: 1200, timeoutMs: 90_000 });
  const text = res.text.trim().slice(0, 6000);
  await db.update(D).set({ aiFeedback: text, aiAt: new Date() }).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
  return text;
}
