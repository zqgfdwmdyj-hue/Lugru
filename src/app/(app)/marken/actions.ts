"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { CONTENT_STATUSES, IDEA_KINDS, IDEA_STATUSES, type ChecklistItem } from "@/db/tables/brands";
import { requireArea } from "@/lib/auth/session";
import { checklistFor } from "@/lib/brands/ai";
import { OCCASIONS } from "@/lib/brands/occasions";
import { generateContent, generateIdeas, refreshBrandPlanning } from "@/lib/brands/service";
import { assertBrand } from "@/lib/brands/access";
import { createFromIdea } from "@/lib/articles/service";
import { purchaseForIdea } from "@/lib/suppliers/box-purchase";
import { canAccess } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";

export type BrandState = { ok: boolean; message: string } | null;
const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const money = (v: string) => {
  if (!v) return null;
  const n = Number(v.replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 100) / 100) : null;
};
const lines = (v: string) => v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function suggestIdeasAction(_prev: BrandState, fd: FormData): Promise<BrandState> {
  const s = await requireArea("marken");
  try {
    assertBrand(s, uuid.parse(fd.get("brandId")));
    const n = await generateIdeas(s.tenantId, s.userId, uuid.parse(fd.get("brandId")), { occasion: str(fd, "occasion") || null, wish: str(fd, "wish") || undefined, count: 5 });
    await refreshBrandPlanning(s.tenantId).catch(() => {});
    revalidatePath("/", "layout");
    return { ok: true, message: `${n} neue Ideen im Board (Spalte „Idee“).` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function createIdeaAction(fd: FormData) {
  const s = await requireArea("marken");
  const brandId = uuid.parse(fd.get("brandId"));
  const kind = z.enum(IDEA_KINDS).parse(fd.get("kind") || "box");
  const title = str(fd, "title");
  if (!title) return;
  assertBrand(s, brandId);
  const [b] = await db.select({ id: schema.brands.id }).from(schema.brands).where(and(eq(schema.brands.id, brandId), eq(schema.brands.tenantId, s.tenantId)));
  if (!b) return;
  const [row] = await db
    .insert(schema.ideas)
    .values({ tenantId: s.tenantId, brandId, kind, title: title.slice(0, 200), occasion: str(fd, "occasion") || null, checklist: checklistFor(kind), createdBy: s.userId })
    .returning({ id: schema.ideas.id });
  redirect(`/marken/ideen/${row.id}`);
}

async function ownIdea(session: Session, id: string) {
  const [i] = await db.select().from(schema.ideas).where(and(eq(schema.ideas.id, id), eq(schema.ideas.tenantId, session.tenantId)));
  if (!i) throw new Error("Idee nicht gefunden.");
  assertBrand(session, i.brandId);
  return i;
}

export async function saveIdeaAction(_prev: BrandState, fd: FormData): Promise<BrandState> {
  const s = await requireArea("marken");
  const id = uuid.parse(fd.get("id"));
  await ownIdea(s, id);
  const occasion = str(fd, "occasion");
  await db
    .update(schema.ideas)
    .set({
      title: str(fd, "title").slice(0, 200) || "Ohne Titel",
      kind: z.enum(IDEA_KINDS).parse(fd.get("kind") || "box"),
      occasion: OCCASIONS.some((o) => o.key === occasion) ? occasion : null,
      concept: str(fd, "concept") || null,
      contents: lines(str(fd, "contents")),
      targetPrice: money(str(fd, "targetPrice")),
      costEstimate: money(str(fd, "costEstimate")),
      sourcing: str(fd, "sourcing") || null,
      notes: str(fd, "notes") || null,
      launchDate: /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "launchDate")) ? str(fd, "launchDate") : null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.ideas.id, id), eq(schema.ideas.tenantId, s.tenantId)));
  revalidatePath("/marken", "layout");
  return { ok: true, message: "Gespeichert." };
}

export async function setIdeaStatusAction(fd: FormData) {
  const s = await requireArea("marken");
  const id = uuid.parse(fd.get("id"));
  await ownIdea(s, id);
  const status = z.enum(IDEA_STATUSES).parse(fd.get("status"));
  await db.update(schema.ideas).set({ status, updatedAt: new Date() }).where(and(eq(schema.ideas.id, id), eq(schema.ideas.tenantId, s.tenantId)));
  // Ab „Umsetzen“ bekommt die Idee einen Artikel im Artikelstamm (Bilder, Texte, Kanäle an einem Ort).
  if (status === "in_progress" || status === "live") await createFromIdea(s.tenantId, id);
  await refreshBrandPlanning(s.tenantId).catch(() => {});
  revalidatePath("/", "layout");
}

export async function checklistAction(fd: FormData) {
  const s = await requireArea("marken");
  const id = uuid.parse(fd.get("id"));
  const idea = await ownIdea(s, id);
  let list: ChecklistItem[] = [...idea.checklist];
  const op = str(fd, "op");
  const idx = Number(fd.get("index"));
  if (op === "toggle" && list[idx]) list[idx] = { ...list[idx], done: !list[idx].done };
  if (op === "remove" && list[idx]) list = list.filter((_, i) => i !== idx);
  if (op === "add" && str(fd, "text")) list.push({ text: str(fd, "text").slice(0, 200), done: false });
  const allDone = list.length > 0 && list.every((c) => c.done);
  await db
    .update(schema.ideas)
    .set({ checklist: list, status: idea.status === "planned" && list.some((c) => c.done) ? "in_progress" : idea.status, updatedAt: new Date() })
    .where(and(eq(schema.ideas.id, id), eq(schema.ideas.tenantId, s.tenantId)));
  revalidatePath(`/marken/ideen/${id}`);
  if (allDone) revalidatePath("/marken");
}

export async function deleteIdeaAction(fd: FormData) {
  const s = await requireArea("marken");
  await ownIdea(s, uuid.parse(fd.get("id")));
  await db.delete(schema.ideas).where(and(eq(schema.ideas.id, uuid.parse(fd.get("id"))), eq(schema.ideas.tenantId, s.tenantId)));
  revalidatePath("/marken", "layout");
  redirect("/marken");
}

export async function suggestContentAction(_prev: BrandState, fd: FormData): Promise<BrandState> {
  const s = await requireArea("marken");
  try {
    assertBrand(s, uuid.parse(fd.get("brandId")));
    if (str(fd, "ideaId")) await ownIdea(s, uuid.parse(fd.get("ideaId")));
    const n = await generateContent(s.tenantId, {
      brandId: uuid.parse(fd.get("brandId")),
      ideaId: str(fd, "ideaId") ? uuid.parse(fd.get("ideaId")) : undefined,
      platform: z.enum(["tiktok", "youtube", "instagram"]).parse(fd.get("platform") || "tiktok"),
      topic: str(fd, "topic") || undefined,
    });
    revalidatePath("/marken", "layout");
    return { ok: true, message: `${n} Content-Ideen angelegt – im Content-Plan zu finden.` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

async function ownPost(session: Session, id: string) {
  const [p] = await db.select().from(schema.contentPosts).where(and(eq(schema.contentPosts.id, id), eq(schema.contentPosts.tenantId, session.tenantId)));
  if (!p) throw new Error("Beitrag nicht gefunden.");
  assertBrand(session, p.brandId);
}

export async function updatePostAction(fd: FormData) {
  const s = await requireArea("marken");
  const id = uuid.parse(fd.get("id"));
  await ownPost(s, id);
  const status = z.enum(CONTENT_STATUSES).parse(fd.get("status"));
  const planned = str(fd, "plannedFor");
  await db
    .update(schema.contentPosts)
    .set({
      status,
      plannedFor: /^\d{4}-\d{2}-\d{2}$/.test(planned) ? planned : null,
      publishedUrl: str(fd, "publishedUrl") || null,
      publishedAt: status === "published" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.contentPosts.id, id), eq(schema.contentPosts.tenantId, s.tenantId)));
  revalidatePath("/marken", "layout");
}

export async function deletePostAction(fd: FormData) {
  const s = await requireArea("marken");
  await ownPost(s, uuid.parse(fd.get("id")));
  await db.delete(schema.contentPosts).where(and(eq(schema.contentPosts.id, uuid.parse(fd.get("id"))), eq(schema.contentPosts.tenantId, s.tenantId)));
  revalidatePath("/marken", "layout");
}

export async function saveBrandAction(_prev: BrandState, fd: FormData): Promise<BrandState> {
  const s = await requireArea("marken");
  const id = uuid.parse(fd.get("id"));
  assertBrand(s, id);
  const occasions: Record<string, number> = {};
  for (const o of OCCASIONS) {
    if (fd.get(`occ:${o.key}`) === "on") occasions[o.key] = Math.min(52, Math.max(1, Number(fd.get(`lead:${o.key}`)) || o.leadWeeks));
  }
  await db
    .update(schema.brands)
    .set({
      name: str(fd, "name").slice(0, 60) || "Marke",
      description: str(fd, "description") || null,
      audience: str(fd, "audience") || null,
      priceRange: str(fd, "priceRange") || null,
      tone: str(fd, "tone") || null,
      links: str(fd, "links") || null,
      trendTopics: str(fd, "trendTopics") || null,
      vatRate: ["0", "7", "19"].includes(str(fd, "vatRate")) ? str(fd, "vatRate") : "19",
      sellerName: str(fd, "sellerName").slice(0, 120) || null,
      sellerId: /^[A-Z0-9]{8,20}$/.test(str(fd, "sellerId").toUpperCase()) ? str(fd, "sellerId").toUpperCase() : null,
      amazonAccount: fd.get("amazonAccount") === "zweit" ? "zweit" : "haupt",
      boxAuto: fd.get("boxAuto") === "on",
      gpsr: Object.fromEntries(["companyName", "addressLine1", "postalCode", "city", "country", "email", "phone"].map((k) => [k, str(fd, `gpsr_${k}`).slice(0, 200)])),
      occasions,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.brands.id, id), eq(schema.brands.tenantId, s.tenantId)));
  await refreshBrandPlanning(s.tenantId).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true, message: "Markenprofil gespeichert." };
}

export async function createBrandAction(fd: FormData) {
  const s = await requireArea("marken");
  const name = str(fd, "name").slice(0, 60);
  if (!name || (s.role !== "owner" && s.brandIds !== null)) return;
  await db.insert(schema.brands).values({ tenantId: s.tenantId, name }).onConflictDoNothing();
  revalidatePath("/marken", "layout");
}

export async function marketKeepaAction(_prev: BrandState, fd: FormData): Promise<BrandState> {
  const s = await requireArea("marken");
  const id = uuid.parse(fd.get("id"));
  await ownIdea(s, id);
  const term = str(fd, "term");
  if (term.length < 3) return { ok: false, message: "Bitte einen Suchbegriff eingeben, z. B. „Halloween Süßigkeiten Box“." };
  const { keepaKey, keepaSearch } = await import("@/lib/integrations/clients/keepa");
  const key = await keepaKey(s.tenantId);
  if (!key) return { ok: false, message: "Kein Keepa-Schlüssel – unter Anbindungen → Keepa eintragen (oder im eBay-Tool unter Bildquellen)." };
  try {
    const r = await keepaSearch(key, term);
    if (!r.products.length) return { ok: false, message: `Keepa hat zu „${term}“ nichts gefunden – anderen Begriff versuchen.` };
    await db
      .update(schema.ideas)
      .set({ market: { source: "keepa", term, fetchedAt: new Date().toISOString(), products: r.products.slice(0, 30) }, updatedAt: new Date() })
      .where(and(eq(schema.ideas.id, id), eq(schema.ideas.tenantId, s.tenantId)));
    revalidatePath(`/marken/ideen/${id}`);
    return { ok: true, message: `${r.products.length} Vergleichsprodukte geladen${r.tokensLeft !== null ? ` · noch ${r.tokensLeft} Keepa-Tokens` : ""}.` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function marketHelium10Action(_prev: BrandState, fd: FormData): Promise<BrandState> {
  const s = await requireArea("marken");
  const id = uuid.parse(fd.get("id"));
  await ownIdea(s, id);
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Bitte den Xray-Export (CSV oder Excel) auswählen." };
  try {
    const { readTable } = await import("@/lib/tabular");
    const { parseHelium10 } = await import("@/lib/brands/market");
    const t = readTable(new Uint8Array(await file.arrayBuffer()));
    const products = parseHelium10([t.headers, ...t.rows]);
    if (!products.length) return { ok: false, message: "In der Datei wurden keine Produkte mit ASIN gefunden." };
    await db
      .update(schema.ideas)
      .set({ market: { source: "helium10", term: file.name, fetchedAt: new Date().toISOString(), products }, updatedAt: new Date() })
      .where(and(eq(schema.ideas.id, id), eq(schema.ideas.tenantId, s.tenantId)));
    revalidatePath(`/marken/ideen/${id}`);
    return { ok: true, message: `${products.length} Produkte aus Helium 10 übernommen.` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

/** Idee jederzeit in den Artikelstamm übernehmen und dorthin wechseln. */
export async function ideaToArticleAction(fd: FormData) {
  const s = await requireArea("marken");
  const id = uuid.parse(fd.get("id"));
  await ownIdea(s, id);
  const articleId = await createFromIdea(s.tenantId, id);
  redirect(`/artikel/${articleId}`);
}

/** Vergleichsprodukt als Referenz für FBA-Gebühr und Provision wählen (oder zurück zum Median). */
export async function setReferenceAction(fd: FormData) {
  const s = await requireArea("marken");
  const id = uuid.parse(fd.get("id"));
  const idea = await ownIdea(s, id);
  if (!idea.market) return;
  const asin = String(fd.get("asin") ?? "").trim().toUpperCase();
  const referenceAsin = /^[A-Z0-9]{10}$/.test(asin) && idea.market.products.some((p) => p.asin === asin) ? asin : undefined;
  await db.update(schema.ideas).set({ market: { ...idea.market, referenceAsin }, updatedAt: new Date() }).where(and(eq(schema.ideas.id, id), eq(schema.ideas.tenantId, s.tenantId)));
  revalidatePath(`/marken/ideen/${id}`);
}

/** Box einkaufen: Bestellung(en) im Einkauf anlegen (je Lieferant, ganze Kartons) und dorthin wechseln. */
export async function purchaseIdeaAction(_prev: BrandState, fd: FormData): Promise<BrandState> {
  const s = await requireArea("marken");
  let target = "";
  try {
    if (!canAccess(s, "wawi")) throw new Error("Für Bestellungen braucht es Zugriff auf die WaWi (Einkauf).");
    const idea = await ownIdea(s, uuid.parse(fd.get("id")));
    const boxes = Math.min(10000, Math.max(1, Math.round(Number(fd.get("boxes")) || 1)));
    const [brand] = await db.select({ vatRate: schema.brands.vatRate }).from(schema.brands).where(eq(schema.brands.id, idea.brandId));
    const ids = await purchaseForIdea(s.tenantId, s.userId, idea, boxes, Number(brand?.vatRate ?? 19));
    target = ids.length === 1 ? `/einkauf/${ids[0]}` : "/einkauf?ansicht=entwuerfe";
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  redirect(target);
}
