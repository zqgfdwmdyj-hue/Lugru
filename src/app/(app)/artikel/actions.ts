"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import type { AmazonChannel, Contact, FoodInfo } from "@/db/tables/articles";
import { brandAllowed, canAccess } from "@/lib/auth/areas";
import { requireArea, type Session } from "@/lib/auth/session";
import { parseAttributeLines } from "@/lib/articles/logic";
import { addImages, createArticle, deleteImage, generateTexts, getArticle, makeMainImage, refreshAmazonStatus, searchProductTypes, sendToAmazon, sendToEbay, suggestEbayCategories } from "@/lib/articles/service";
import { parseAmount } from "@/lib/numbers";

const uuid = z.string().uuid();
const str = (fd: FormData, k: string, max = 5000) => String(fd.get(k) ?? "").trim().slice(0, max);
const numOrNull = (fd: FormData, k: string) => {
  const n = parseAmount(fd.get(k));
  return n !== null && n >= 0 ? n : null;
};

export type ArticleState = { ok: boolean; message: string; options?: { id: string; name: string }[]; link?: string } | null;

/** Artikel des eigenen Mandanten, den der Mitarbeiter (Marken-Freigabe) sehen darf. */
async function own(session: Session, raw: FormDataEntryValue | null) {
  const a = await getArticle(session.tenantId, uuid.parse(raw));
  if (a.brandId && !brandAllowed(session.brandIds, session.role, a.brandId)) throw new Error("Dieser Artikel gehört zu einer nicht freigegebenen Marke.");
  return a;
}

const fail = (e: unknown): ArticleState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export async function createArticleAction(fd: FormData) {
  const s = await requireArea("artikel");
  const title = str(fd, "title", 200);
  if (!title) return;
  const brandId = uuid.safeParse(fd.get("brandId")).success ? String(fd.get("brandId")) : null;
  if (brandId && !brandAllowed(s.brandIds, s.role, brandId)) return;
  const id = await createArticle(s.tenantId, { brandId, title });
  redirect(`/artikel/${id}`);
}

export async function saveArticleAction(_prev: ArticleState, fd: FormData): Promise<ArticleState> {
  const s = await requireArea("artikel");
  try {
    const a = await own(s, fd.get("id"));
    const sku = str(fd, "sku", 40).replace(/\s+/g, "-");
    if (!sku) throw new Error("SKU fehlt.");
    const ean = str(fd, "ean", 20).replace(/\D/g, "");
    if (ean && ![8, 12, 13, 14].includes(ean.length)) throw new Error("Die EAN muss 8, 12, 13 oder 14 Ziffern haben.");
    const asin = str(fd, "asin", 10).toUpperCase();
    if (asin && !/^[A-Z0-9]{10}$/.test(asin)) throw new Error("Die ASIN hat 10 Zeichen.");
    const food: FoodInfo = Object.fromEntries(["ingredients", "allergens", "nutrition", "storage", "bestBefore", "countryOfOrigin", "netQuantity"].map((k) => [k, str(fd, `food_${k}`, 3000)]));
    const manufacturer: Contact = Object.fromEntries(["companyName", "addressLine1", "postalCode", "city", "country", "email", "phone"].map((k) => [k, str(fd, `m_${k}`, 200)]));
    const extra = str(fd, "amazon_extra", 20000);
    if (extra) {
      try {
        const v = JSON.parse(extra);
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
      } catch {
        throw new Error("Zusätzliche Amazon-Attribute: kein gültiges JSON-Objekt.");
      }
    }
    const amazon: AmazonChannel = {
      ...a.amazon,
      account: fd.get("amazon_account") === "zweit" ? "zweit" : "haupt",
      productType: str(fd, "amazon_productType", 80).toUpperCase() || undefined,
      fulfillment: fd.get("amazon_fulfillment") === "FBM" ? "FBM" : "FBA",
      quantity: Math.max(0, Math.round(numOrNull(fd, "amazon_quantity") ?? 0)),
      extraAttributes: extra || undefined,
    };
    await db
      .update(schema.articles)
      .set({
        sku,
        title: str(fd, "title", 200) || a.title,
        status: z.enum(["entwurf", "aktiv", "archiv"]).catch(a.status).parse(fd.get("status")),
        ean: ean || null,
        gtinExempt: fd.get("gtinExempt") === "on",
        asin: asin || null,
        price: numOrNull(fd, "price"),
        costPrice: numOrNull(fd, "costPrice"),
        vatRate: ["0", "7", "19"].includes(str(fd, "vatRate")) ? str(fd, "vatRate") : a.vatRate,
        weightGrams: numOrNull(fd, "weightGrams") === null ? null : Math.round(numOrNull(fd, "weightGrams")!),
        lengthCm: numOrNull(fd, "lengthCm")?.toString() ?? null,
        widthCm: numOrNull(fd, "widthCm")?.toString() ?? null,
        heightCm: numOrNull(fd, "heightCm")?.toString() ?? null,
        bullets: [1, 2, 3, 4, 5].map((n) => str(fd, `bullet${n}`, 500)).filter(Boolean),
        description: str(fd, "description", 4000) || null,
        keywords: str(fd, "keywords", 500) || null,
        contents: str(fd, "contents", 5000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        attributes: parseAttributeLines(str(fd, "attributes", 5000)),
        food,
        manufacturer,
        amazon,
        ebay: { ...a.ebay, categoryId: str(fd, "ebay_categoryId", 20).replace(/\D/g, "") || undefined, categoryName: str(fd, "ebay_categoryName", 300) || a.ebay.categoryName },
        notes: str(fd, "notes", 5000) || null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.articles.id, a.id), eq(schema.articles.tenantId, s.tenantId)));
    revalidatePath(`/artikel/${a.id}`);
    return { ok: true, message: "Gespeichert." };
  } catch (e) {
    if (e instanceof Error && /articles_sku_uq/.test(e.message + String((e as { cause?: unknown }).cause ?? ""))) return { ok: false, message: "Diese SKU gibt es schon." };
    return fail(e);
  }
}

export async function uploadImagesAction(_prev: ArticleState, fd: FormData): Promise<ArticleState> {
  const s = await requireArea("artikel");
  try {
    const a = await own(s, fd.get("id"));
    const files = fd.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error("Bitte Bilder wählen.");
    await addImages(s.tenantId, a.id, await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    revalidatePath(`/artikel/${a.id}`);
    return { ok: true, message: `${files.length} Bild${files.length === 1 ? "" : "er"} hochgeladen.` };
  } catch (e) {
    return fail(e);
  }
}

export async function imageAction(fd: FormData) {
  const s = await requireArea("artikel");
  const a = await own(s, fd.get("id"));
  const imageId = uuid.parse(fd.get("imageId"));
  if (fd.get("op") === "delete") await deleteImage(s.tenantId, imageId);
  else await makeMainImage(s.tenantId, imageId);
  revalidatePath(`/artikel/${a.id}`);
}

export async function generateTextsAction(_prev: ArticleState, fd: FormData): Promise<ArticleState> {
  const s = await requireArea("artikel");
  try {
    const a = await own(s, fd.get("id"));
    await generateTexts(s.tenantId, a.id);
    revalidatePath(`/artikel/${a.id}`);
    return { ok: true, message: "Titel, Stichpunkte, Beschreibung und Suchbegriffe neu geschrieben – bitte prüfen." };
  } catch (e) {
    return fail(e);
  }
}

export async function productTypesAction(_prev: ArticleState, fd: FormData): Promise<ArticleState> {
  const s = await requireArea("artikel");
  try {
    const a = await own(s, fd.get("id"));
    const q = str(fd, "q", 100) || a.title;
    const types = await searchProductTypes(s.tenantId, a.amazon.account ?? "haupt", q);
    return { ok: true, message: types.length ? "Produkttyp wählen:" : "Keine Vorschläge – anderen Suchbegriff versuchen.", options: types.map((t) => ({ id: t.name, name: `${t.label} (${t.name})` })) };
  } catch (e) {
    return fail(e);
  }
}

export async function setProductTypeAction(fd: FormData) {
  const s = await requireArea("artikel");
  const a = await own(s, fd.get("id"));
  const pt = str(fd, "productType", 80).toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(pt)) return;
  await db.update(schema.articles).set({ amazon: { ...a.amazon, productType: pt }, updatedAt: new Date() }).where(and(eq(schema.articles.id, a.id), eq(schema.articles.tenantId, s.tenantId)));
  revalidatePath(`/artikel/${a.id}`);
}

export async function amazonAction(_prev: ArticleState, fd: FormData): Promise<ArticleState> {
  const s = await requireArea("artikel");
  try {
    const a = await own(s, fd.get("id"));
    const op = String(fd.get("op"));
    if (op === "status") {
      const r = await refreshAmazonStatus(s.tenantId, a.id);
      revalidatePath(`/artikel/${a.id}`);
      return { ok: true, message: r.asin ? `Amazon: ${r.status} · ASIN ${r.asin} – in der WaWi verknüpft.` : `Amazon: ${r.status}.` };
    }
    const r = await sendToAmazon(s.tenantId, a.id, op === "senden" ? "senden" : "pruefen");
    revalidatePath(`/artikel/${a.id}`);
    const errors = r.issues.filter((i) => i.severity === "ERROR").length;
    if (op === "senden") return { ok: errors === 0, message: errors ? `Amazon hat ${errors} Fehler gemeldet – siehe Liste.` : `An Amazon gesendet (${r.status}). In ein paar Minuten „Status abrufen“ für die ASIN.` };
    return { ok: errors === 0, message: errors ? `Prüfung: ${errors} Fehler – siehe Liste.` : "Prüfung ohne Fehler – kann gesendet werden." };
  } catch (e) {
    return fail(e);
  }
}

export async function ebayCategoriesAction(_prev: ArticleState, fd: FormData): Promise<ArticleState> {
  const s = await requireArea("artikel");
  try {
    const a = await own(s, fd.get("id"));
    const cats = await suggestEbayCategories(s.tenantId, str(fd, "q", 100) || a.title);
    return { ok: true, message: cats.length ? "Kategorie wählen:" : "Keine Vorschläge.", options: cats };
  } catch (e) {
    return fail(e);
  }
}

export async function setEbayCategoryAction(fd: FormData) {
  const s = await requireArea("artikel");
  const a = await own(s, fd.get("id"));
  const id = str(fd, "categoryId", 20).replace(/\D/g, "");
  if (!id) return;
  await db.update(schema.articles).set({ ebay: { ...a.ebay, categoryId: id, categoryName: str(fd, "categoryName", 300) }, updatedAt: new Date() }).where(and(eq(schema.articles.id, a.id), eq(schema.articles.tenantId, s.tenantId)));
  revalidatePath(`/artikel/${a.id}`);
}

export async function ebayAction(_prev: ArticleState, fd: FormData): Promise<ArticleState> {
  const s = await requireArea("artikel");
  try {
    if (!canAccess(s, "ebay")) throw new Error("Für eBay braucht es Zugriff auf den Bereich eBay.");
    const a = await own(s, fd.get("id"));
    const attemptId = await sendToEbay(s.tenantId, a.id);
    revalidatePath(`/artikel/${a.id}`);
    return { ok: true, message: "Entwurf im eBay-Tool angelegt – dort prüfen und veröffentlichen.", link: `/ebay?ansicht=vorschau&id=${attemptId}` };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteArticleAction(fd: FormData) {
  const s = await requireArea("artikel");
  const a = await own(s, fd.get("id"));
  await db.delete(schema.articles).where(and(eq(schema.articles.id, a.id), eq(schema.articles.tenantId, s.tenantId)));
  redirect("/artikel");
}
