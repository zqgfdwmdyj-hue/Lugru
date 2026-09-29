"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import type { CollageSettings } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { collageSettings, nameFromFilename } from "@/lib/donations/layout";
import { addProductsToEvent, loadEvent, productByImage, storeImage } from "@/lib/donations/service";
import { parseAmount, parseDate } from "@/lib/numbers";

const uuid = z.string().uuid();
const P = schema.donationProducts;
const E = schema.donationEvents;
const I = schema.donationEventItems;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;
const price = (fd: FormData, k: string) => {
  const n = parseAmount(str(fd, k));
  return n === null || n < 0 ? null : Math.round(n * 100) / 100;
};
const images = (fd: FormData, k: string) => fd.getAll(k).filter((f): f is File => f instanceof File && f.size > 0);

// ---------- Aktionen ----------

export async function createEvent(fd: FormData) {
  const session = await requireSession();
  const eventDate = parseDate(str(fd, "eventDate"));
  if (!eventDate) return;
  const [ev] = await db
    .insert(E)
    .values({
      tenantId: session.tenantId,
      eventDate,
      eventTime: opt(fd, "eventTime"),
      title: str(fd, "title") || "Unsere Spendenempfehlungen",
      subtitle: opt(fd, "subtitle") ?? "Dank eurer Spenden können wir retten!",
      location: opt(fd, "location"),
    })
    .returning({ id: E.id });
  // Produkte einer früheren Aktion übernehmen (mit deren Preisen).
  const copyFrom = uuid.safeParse(fd.get("copyFrom"));
  if (copyFrom.success) {
    const src = await loadEvent(session.tenantId, copyFrom.data);
    if (src) {
      const items = await db.select().from(I).where(and(eq(I.tenantId, session.tenantId), eq(I.eventId, src.id))).orderBy(I.sort);
      await addProductsToEvent(session.tenantId, ev.id, items.map((i) => i.productId), new Map(items.map((i) => [i.productId, { price: i.price, priceNote: i.priceNote, caption: i.caption }])));
      await db.update(E).set({ collage: src.collage }).where(eq(E.id, ev.id));
    }
  }
  redirect(`/spenden/${ev.id}`);
}

export async function updateEvent(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("eventId"));
  const eventDate = parseDate(str(fd, "eventDate"));
  await db
    .update(E)
    .set({
      title: str(fd, "title") || "Unsere Spendenempfehlungen",
      subtitle: opt(fd, "subtitle"),
      ...(eventDate ? { eventDate } : {}),
      eventTime: opt(fd, "eventTime"),
      location: opt(fd, "location"),
      note: opt(fd, "note"),
      updatedAt: new Date(),
    })
    .where(and(eq(E.id, id), eq(E.tenantId, session.tenantId)));
  revalidatePath(`/spenden/${id}`);
}

export async function deleteEvent(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("eventId"));
  await db.delete(E).where(and(eq(E.id, id), eq(E.tenantId, session.tenantId)));
  redirect("/spenden");
}

export async function saveCollageSettings(eventId: string, settings: CollageSettings) {
  const session = await requireSession();
  const id = uuid.parse(eventId);
  await db.update(E).set({ collage: collageSettings(settings) }).where(and(eq(E.id, id), eq(E.tenantId, session.tenantId)));
}

/**
 * Speichert alle Zeilen der Produktliste einer Aktion. Der gedrückte Knopf (op) kann zusätzlich
 * eine Zeile entfernen oder verschieben – vorher werden die Eingaben gespeichert, damit nichts verloren geht.
 */
export async function saveItems(fd: FormData) {
  const session = await requireSession();
  const t = session.tenantId;
  const eventId = uuid.parse(fd.get("eventId"));
  const items = await db.select().from(I).where(and(eq(I.tenantId, t), eq(I.eventId, eventId))).orderBy(I.sort, I.createdAt);
  const touchedPrices = new Map<string, number>();
  for (const it of items) {
    if (!fd.has(`price_${it.id}`)) continue;
    const p = price(fd, `price_${it.id}`);
    const qty = parseAmount(str(fd, `qty_${it.id}`));
    await db
      .update(I)
      .set({
        price: p,
        priceNote: opt(fd, `note_${it.id}`),
        caption: opt(fd, `caption_${it.id}`),
        quantity: qty === null ? null : Math.max(0, Math.round(qty)),
        inCollage: fd.get(`col_${it.id}`) === "on",
        inFlyer: fd.get(`fly_${it.id}`) === "on",
      })
      .where(eq(I.id, it.id));
    if (p !== null && p !== it.price) touchedPrices.set(it.productId, p);
  }
  // Name, Variante und Kategorie lassen sich direkt in der Liste pflegen (z. B. nach dem Foto-Upload).
  for (const productId of new Set(items.map((i) => i.productId))) {
    if (!fd.has(`name_${productId}`)) continue;
    const name = str(fd, `name_${productId}`);
    if (!name) continue;
    await db
      .update(P)
      .set({ name, variant: opt(fd, `variant_${productId}`), category: str(fd, `cat_${productId}`) || "Lebensmittel", updatedAt: new Date() })
      .where(and(eq(P.id, productId), eq(P.tenantId, t)));
  }
  // Der zuletzt verwendete Preis wird zum Vorschlag für das nächste Mal.
  for (const [productId, p] of touchedPrices) {
    await db.update(P).set({ price: p, updatedAt: new Date() }).where(and(eq(P.id, productId), eq(P.tenantId, t)));
  }

  const [op, target] = str(fd, "op").split(":");
  const idx = items.findIndex((i) => i.id === target);
  if (op === "remove" && idx >= 0) {
    await db.delete(I).where(and(eq(I.id, target), eq(I.tenantId, t)));
  } else if ((op === "up" || op === "down") && idx >= 0) {
    const order = items.map((i) => i.id);
    const j = op === "up" ? idx - 1 : idx + 1;
    if (j >= 0 && j < order.length) {
      [order[idx], order[j]] = [order[j], order[idx]];
      for (let k = 0; k < order.length; k++) await db.update(I).set({ sort: (k + 1) * 10 }).where(eq(I.id, order[k]));
    }
  } else if (op === "sort") {
    // Nach Kategorie und Name ordnen – so wie im Aushang.
    const rows = await db.select({ id: I.id, cat: P.category, name: P.name, variant: P.variant }).from(I).innerJoin(P, eq(P.id, I.productId)).where(and(eq(I.tenantId, t), eq(I.eventId, eventId)));
    rows.sort((a, b) => a.cat.localeCompare(b.cat, "de") || a.name.localeCompare(b.name, "de") || (a.variant ?? "").localeCompare(b.variant ?? "", "de"));
    for (let k = 0; k < rows.length; k++) await db.update(I).set({ sort: (k + 1) * 10 }).where(eq(I.id, rows[k].id));
  }
  await db.update(E).set({ updatedAt: new Date() }).where(and(eq(E.id, eventId), eq(E.tenantId, t)));
  revalidatePath(`/spenden/${eventId}`);
}

export async function addToEvent(fd: FormData) {
  const session = await requireSession();
  const eventId = uuid.parse(fd.get("eventId"));
  if (!(await loadEvent(session.tenantId, eventId))) return;
  const ids = fd.getAll("productId").map(String).filter((v) => uuid.safeParse(v).success);
  await addProductsToEvent(session.tenantId, eventId, ids);
  revalidatePath(`/spenden/${eventId}`);
}

/**
 * Viele Fotos auf einmal: Jedes Foto wird ein neues Produkt (Name aus dem Dateinamen, sonst leer
 * zum Nachtragen) und landet direkt in der Aktion.
 */
export async function uploadPhotos(fd: FormData) {
  const session = await requireSession();
  const t = session.tenantId;
  const eventId = uuid.parse(fd.get("eventId"));
  if (!(await loadEvent(t, eventId))) return;
  const category = str(fd, "category") || "Lebensmittel";
  const ids: string[] = [];
  for (const file of images(fd, "photos").slice(0, 60)) {
    // Dasselbe Foto schon einmal hochgeladen? Dann das vorhandene Produkt nehmen statt ein doppeltes anzulegen.
    const existing = await productByImage(t, file);
    if (existing) {
      ids.push(existing);
      continue;
    }
    const fileId = await storeImage(t, file);
    if (!fileId) continue;
    const [p] = await db
      .insert(P)
      .values({ tenantId: t, name: nameFromFilename(file.name) || "Neues Produkt", category, imageFileId: fileId })
      .returning({ id: P.id });
    ids.push(p.id);
  }
  await addProductsToEvent(t, eventId, ids);
  revalidatePath(`/spenden/${eventId}`);
}

// ---------- Produkte ----------

export async function createProduct(fd: FormData) {
  const session = await requireSession();
  const t = session.tenantId;
  const name = str(fd, "name");
  if (!name) return;
  const image = images(fd, "image")[0];
  const imageFileId = image ? await storeImage(t, image) : null;
  const [p] = await db
    .insert(P)
    .values({ tenantId: t, name, variant: opt(fd, "variant"), category: str(fd, "category") || "Lebensmittel", price: price(fd, "price"), note: opt(fd, "note"), imageFileId })
    .returning({ id: P.id });
  const eventId = uuid.safeParse(fd.get("eventId"));
  if (eventId.success && (await loadEvent(t, eventId.data))) {
    await addProductsToEvent(t, eventId.data, [p.id]);
    revalidatePath(`/spenden/${eventId.data}`);
    return;
  }
  revalidatePath("/spenden/produkte");
}

export async function updateProduct(fd: FormData) {
  const session = await requireSession();
  const t = session.tenantId;
  const id = uuid.parse(fd.get("productId"));
  const name = str(fd, "name");
  if (!name) return;
  const image = images(fd, "image")[0];
  const imageFileId = image ? await storeImage(t, image) : undefined;
  await db
    .update(P)
    .set({
      name,
      variant: opt(fd, "variant"),
      category: str(fd, "category") || "Lebensmittel",
      price: price(fd, "price"),
      note: opt(fd, "note"),
      archived: fd.get("archived") === "on",
      ...(imageFileId ? { imageFileId } : {}),
      ...(fd.get("removeImage") === "on" && !imageFileId ? { imageFileId: null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(P.id, id), eq(P.tenantId, t)));
  const back = str(fd, "back");
  revalidatePath(`/spenden/produkte/${id}`);
  if (back.startsWith("/spenden/")) redirect(back);
}

/** Löscht ein Produkt nur, wenn es noch in keiner Aktion war – sonst wird es archiviert. */
export async function deleteProduct(fd: FormData) {
  const session = await requireSession();
  const t = session.tenantId;
  const id = uuid.parse(fd.get("productId"));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(I).where(and(eq(I.tenantId, t), eq(I.productId, id)));
  if (n > 0) await db.update(P).set({ archived: true, updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.tenantId, t)));
  else await db.delete(P).where(and(eq(P.id, id), eq(P.tenantId, t)));
  redirect("/spenden/produkte");
}

/** Mehrere Produkte zu einem zusammenlegen (z. B. doppelt angelegt nach dem Foto-Upload). */
export async function mergeProducts(fd: FormData) {
  const session = await requireSession();
  const t = session.tenantId;
  const keep = uuid.parse(fd.get("productId"));
  const drop = fd.getAll("mergeId").map(String).filter((v) => uuid.safeParse(v).success && v !== keep);
  if (drop.length === 0) return;
  const owned = await db.select({ id: P.id }).from(P).where(and(eq(P.tenantId, t), inArray(P.id, [keep, ...drop])));
  if (!owned.some((p) => p.id === keep)) return;
  const dropIds = owned.map((p) => p.id).filter((id) => id !== keep);
  if (dropIds.length === 0) return;
  // Einträge umhängen; wo das Produkt in derselben Aktion schon steht, bleibt der vorhandene Eintrag.
  await db.execute(sql`
    update donation_event_items i set product_id = ${keep}
     where i.tenant_id = ${t} and i.product_id in (${sql.join(dropIds.map((id) => sql`${id}`), sql`, `)})
       and not exists (select 1 from donation_event_items j where j.event_id = i.event_id and j.product_id = ${keep})`);
  await db.delete(P).where(and(eq(P.tenantId, t), inArray(P.id, dropIds)));
  revalidatePath(`/spenden/produkte/${keep}`);
}
