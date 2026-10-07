"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import type { CollageSettings } from "@/db/schema";
import { requireLogin } from "@/lib/auth";
import { collageSettings, isPlaceholderName, nameFromFilename, PLACEHOLDER_NAME } from "@/lib/layout";
import { addProductsToEvent, checkImage, findPhoto, latestPriceChecks, loadEvent, photoIndex, storeChecked, storeImage } from "@/lib/service";
import { parseAmount, parseIsoDate } from "@/lib/numbers";
import { aiConfigured, failStaleChecks, queuePriceChecks, runPriceChecks } from "@/lib/price-research";
import { type AiMode, defaultAiMode, isAiMode } from "@/lib/ai-modes";
import { readBestBefore } from "@/lib/mhd";
import { failStalePhotoPrices, queuePhotoPrices, runPhotoPrices } from "@/lib/photo-price";

const uuid = z.string().uuid();
const P = schema.products;
const E = schema.events;
const I = schema.eventItems;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;
const price = (fd: FormData, k: string) => {
  const n = parseAmount(str(fd, k));
  return n === null || n < 0 ? null : Math.round(n * 100) / 100;
};
const images = (fd: FormData, k: string) => fd.getAll(k).filter((f): f is File => f instanceof File && f.size > 0);

// ---------- Aktionen ----------

export async function createEvent(fd: FormData) {
  await requireLogin();
  const eventDate = parseIsoDate(str(fd, "eventDate"));
  if (!eventDate) return;
  const [ev] = await db
    .insert(E)
    .values({
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
    const src = await loadEvent(copyFrom.data);
    if (src) {
      const items = await db.select().from(I).where(eq(I.eventId, src.id)).orderBy(I.sort);
      await addProductsToEvent(ev.id, items.map((i) => i.productId), new Map(items.map((i) => [i.productId, { price: i.price, priceNote: i.priceNote, caption: i.caption }])));
      await db.update(E).set({ collage: src.collage }).where(eq(E.id, ev.id));
    }
  }
  redirect(`/verteilung/${ev.id}`);
}

export async function updateEvent(fd: FormData) {
  await requireLogin();
  const id = uuid.parse(fd.get("eventId"));
  const eventDate = parseIsoDate(str(fd, "eventDate"));
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
    .where(eq(E.id, id));
  revalidatePath(`/verteilung/${id}`);
}

export async function deleteEvent(fd: FormData) {
  await requireLogin();
  const id = uuid.parse(fd.get("eventId"));
  await db.delete(E).where(eq(E.id, id));
  redirect("/");
}

export async function saveCollageSettings(eventId: string, settings: CollageSettings) {
  await requireLogin();
  const id = uuid.parse(eventId);
  await db.update(E).set({ collage: collageSettings(settings) }).where(eq(E.id, id));
}

/**
 * Speichert alle Zeilen der Produktliste einer Aktion. Der gedrückte Knopf (op) kann zusätzlich
 * eine Zeile entfernen oder verschieben – vorher werden die Eingaben gespeichert, damit nichts verloren geht.
 */
export async function saveItems(fd: FormData) {
  await requireLogin();
  const eventId = uuid.parse(fd.get("eventId"));
  const items = await db.select().from(I).where(eq(I.eventId, eventId)).orderBy(I.sort, I.createdAt);
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
        bestBefore: parseIsoDate(str(fd, `mhd_${it.id}`)),
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
      .where(eq(P.id, productId));
  }
  // Der zuletzt verwendete Preis wird zum Vorschlag für das nächste Mal.
  for (const [productId, p] of touchedPrices) {
    await db.update(P).set({ price: p, updatedAt: new Date() }).where(eq(P.id, productId));
  }

  const [op, target] = str(fd, "op").split(":");
  const idx = items.findIndex((i) => i.id === target);
  if (op === "remove" && idx >= 0) {
    await db.delete(I).where(eq(I.id, target));
  } else if ((op === "up" || op === "down") && idx >= 0) {
    const order = items.map((i) => i.id);
    const j = op === "up" ? idx - 1 : idx + 1;
    if (j >= 0 && j < order.length) {
      [order[idx], order[j]] = [order[j], order[idx]];
      for (let k = 0; k < order.length; k++) await db.update(I).set({ sort: (k + 1) * 10 }).where(eq(I.id, order[k]));
    }
  } else if (op === "ai" && idx >= 0) {
    await startChecks([items[idx].productId], defaultAiMode());
  } else if (op === "sort") {
    // Nach Kategorie und Name ordnen – so wie im Aushang.
    const rows = await db.select({ id: I.id, cat: P.category, name: P.name, variant: P.variant }).from(I).innerJoin(P, eq(P.id, I.productId)).where(eq(I.eventId, eventId));
    rows.sort((a, b) => a.cat.localeCompare(b.cat, "de") || a.name.localeCompare(b.name, "de") || (a.variant ?? "").localeCompare(b.variant ?? "", "de"));
    for (let k = 0; k < rows.length; k++) await db.update(I).set({ sort: (k + 1) * 10 }).where(eq(I.id, rows[k].id));
  }
  await db.update(E).set({ updatedAt: new Date() }).where(eq(E.id, eventId));
  revalidatePath(`/verteilung/${eventId}`);
}

export async function addToEvent(fd: FormData) {
  await requireLogin();
  const eventId = uuid.parse(fd.get("eventId"));
  if (!(await loadEvent(eventId))) return;
  const ids = fd.getAll("productId").map(String).filter((v) => uuid.safeParse(v).success);
  await addProductsToEvent(eventId, ids);
  revalidatePath(`/verteilung/${eventId}`);
}

/**
 * Viele Fotos auf einmal: Jedes Foto wird ein neues Produkt (Name aus dem Dateinamen, sonst leer
 * zum Nachtragen) und landet direkt in der Aktion.
 */
/** reused: schon in der Datenbank, jetzt in die Verteilung übernommen; alreadyInEvent: war schon drin; similar: neu, aber ähnlich wie ein vorhandenes. */
export type UploadResult = { added: number; reused: number; alreadyInEvent: number; similar: number; rejected: string[] };

/**
 * Fotos hochladen – der Browser schickt sie in kleinen Portionen (siehe PhotoUpload), damit auch 50+ Fotos
 * vom Handy ohne Absturz durchgehen. Gibt zurück, was angelegt, wiedererkannt oder abgelehnt wurde.
 */
export async function uploadPhotos(fd: FormData): Promise<UploadResult> {
  await requireLogin();
  const result: UploadResult = { added: 0, reused: 0, alreadyInEvent: 0, similar: 0, rejected: [] };
  const eventId = uuid.parse(fd.get("eventId"));
  if (!(await loadEvent(eventId))) return result;
  const category = str(fd, "category") || "Lebensmittel";
  const ids: string[] = [];
  const index = await photoIndex();
  const inEvent = new Set((await db.select({ id: I.productId }).from(I).where(eq(I.eventId, eventId))).map((r) => r.id));
  for (const file of images(fd, "photos").slice(0, 20)) {
    const img = await checkImage(file);
    if (!img) {
      result.rejected.push(file.name);
      continue;
    }
    // Dasselbe Foto schon einmal hochgeladen (auch verkleinert, per WhatsApp o. ä.)? Dann das vorhandene Produkt
    // nehmen – kein doppeltes Produkt, keine doppelte KI-Auswertung.
    const found = findPhoto(img, index);
    if (found && found.how !== "ähnlich") {
      if (inEvent.has(found.productId) || ids.includes(found.productId)) result.alreadyInEvent++;
      else {
        ids.push(found.productId);
        result.reused++;
      }
      continue;
    }
    const fileId = await storeChecked(img);
    const [p] = await db
      .insert(P)
      .values({ name: nameFromFilename(file.name) || PLACEHOLDER_NAME, category, imageFileId: fileId })
      .returning({ id: P.id, createdAt: P.createdAt });
    // Auch innerhalb derselben Auswahl doppelte Fotos erkennen.
    index.push({ productId: p.id, sha: img.sha, hash: img.hash, createdAt: p.createdAt });
    ids.push(p.id);
    result.added++;
    if (found) result.similar++;
  }
  await addProductsToEvent(eventId, ids);
  // Alte Fotos mit Preis darauf: Preis im Hintergrund ablesen und eintragen.
  if (fd.get("preisImFoto") === "1") await startPhotoPrices(eventId, ids);
  revalidatePath(`/verteilung/${eventId}`);
  return result;
}

async function startPhotoPrices(eventId: string, productIds: string[], opts: { again?: boolean } = {}) {
  if (!aiConfigured() || productIds.length === 0) return;
  await failStalePhotoPrices();
  const fileIds = await queuePhotoPrices(productIds, opts);
  if (fileIds.length) after(() => runPhotoPrices(fileIds, eventId));
}

/** „Preise aus Fotos lesen“: alle Fotos der Verteilung, die noch nicht gelesen wurden (bzw. alle erneut). */
export async function scanEventPhotoPrices(eventId: string, fd: FormData) {
  await requireLogin();
  const id = uuid.parse(eventId);
  const rows = await db.select({ productId: I.productId }).from(I).where(eq(I.eventId, id));
  await startPhotoPrices(id, rows.map((r) => r.productId), { again: fd.get("umfang") === "alle" });
  revalidatePath(`/verteilung/${id}`);
}

/** Falsch erkannt: Foto gilt als „ohne Preis“, die Collage druckt den Preis wieder normal. */
export async function clearPrintedPrice(fileId: string, back: string) {
  await requireLogin();
  const id = uuid.parse(fileId);
  await db.update(schema.files).set({ printedStatus: "done", printedPrice: null, printedPriceText: null, printedPriceBox: null, printedScannedAt: new Date() }).where(eq(schema.files.id, id));
  revalidatePath(back.startsWith("/") ? back : "/");
}

// ---------- Produkte ----------

export async function createProduct(fd: FormData) {
  await requireLogin();
  const name = str(fd, "name");
  if (!name) return;
  const image = images(fd, "image")[0];
  const imageFileId = image ? await storeImage(image) : null;
  const [p] = await db
    .insert(P)
    .values({ name, variant: opt(fd, "variant"), category: str(fd, "category") || "Lebensmittel", price: price(fd, "price"), note: opt(fd, "note"), imageFileId })
    .returning({ id: P.id });
  const eventId = uuid.safeParse(fd.get("eventId"));
  if (eventId.success && (await loadEvent(eventId.data))) {
    await addProductsToEvent(eventId.data, [p.id]);
    revalidatePath(`/verteilung/${eventId.data}`);
    return;
  }
  revalidatePath("/produkte");
}

export async function updateProduct(fd: FormData) {
  await requireLogin();
  const id = uuid.parse(fd.get("productId"));
  const name = str(fd, "name");
  if (!name) return;
  const image = images(fd, "image")[0];
  const imageFileId = image ? await storeImage(image) : undefined;
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
    .where(eq(P.id, id));
  const back = str(fd, "back");
  revalidatePath(`/produkte/${id}`);
  if (back.startsWith("/verteilung/")) redirect(back);
}

/** Löscht ein Produkt nur, wenn es noch in keiner Aktion war – sonst wird es archiviert. */
export async function deleteProduct(fd: FormData) {
  await requireLogin();
  const id = uuid.parse(fd.get("productId"));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(I).where(eq(I.productId, id));
  if (n > 0) await db.update(P).set({ archived: true, updatedAt: new Date() }).where(eq(P.id, id));
  else await db.delete(P).where(eq(P.id, id));
  redirect("/produkte");
}

/** Mehrere Produkte zu einem zusammenlegen (z. B. doppelt angelegt nach dem Foto-Upload). */
export async function mergeProducts(fd: FormData) {
  await requireLogin();
  const keep = uuid.parse(fd.get("productId"));
  const drop = fd.getAll("mergeId").map(String).filter((v) => uuid.safeParse(v).success && v !== keep);
  if (drop.length === 0) return;
  const owned = await db.select({ id: P.id }).from(P).where(inArray(P.id, [keep, ...drop]));
  if (!owned.some((p) => p.id === keep)) return;
  const dropIds = owned.map((p) => p.id).filter((id) => id !== keep);
  if (dropIds.length === 0) return;
  // Einträge umhängen; wo das Produkt in derselben Aktion schon steht, bleibt der vorhandene Eintrag.
  await db.execute(sql`
    update event_items i set product_id = ${keep}
     where i.product_id in (${sql.join(dropIds.map((id) => sql`${id}`), sql`, `)})
       and not exists (select 1 from event_items j where j.event_id = i.event_id and j.product_id = ${keep})`);
  await db.delete(P).where(inArray(P.id, dropIds));
  revalidatePath(`/produkte/${keep}`);
  revalidatePath("/produkte");
}

// ---------- KI-Preisrecherche ----------

/** Recherchen anlegen und nach der Antwort im Hintergrund abarbeiten. */
async function startChecks(productIds: string[], mode: AiMode, opts: { skipRecent?: boolean } = {}) {
  if (!aiConfigured() || productIds.length === 0) return;
  await failStaleChecks();
  const ids = await queuePriceChecks(productIds, mode, opts);
  if (ids.length) after(() => runPriceChecks(ids));
}

const stufe = (fd: FormData): AiMode => {
  const v = fd.get("stufe");
  return isAiMode(v) ? v : defaultAiMode();
};

export async function researchProduct(fd: FormData) {
  await requireLogin();
  const id = uuid.parse(fd.get("productId"));
  await startChecks([id], stufe(fd));
  revalidatePath(`/produkte/${id}`);
}

/**
 * Für eine Verteilung: nur Produkte ohne Preis/Namen oder alle. Produkte mit einem Ergebnis aus den
 * letzten 60 Tagen werden übersprungen (kostet nichts extra).
 */
export async function researchEvent(fd: FormData) {
  await requireLogin();
  const eventId = uuid.parse(fd.get("eventId"));
  const rows = await db.select({ productId: I.productId, price: I.price, name: P.name }).from(I).innerJoin(P, eq(P.id, I.productId)).where(eq(I.eventId, eventId)).orderBy(I.sort);
  const mode = stufe(fd);
  const all = fd.get("umfang") === "alle";
  const wanted = rows.filter((r) => all || (mode === "erkennen" ? isPlaceholderName(r.name) : r.price === null || isPlaceholderName(r.name)));
  await startChecks(wanted.map((r) => r.productId), mode, { skipRecent: true });
  revalidatePath(`/verteilung/${eventId}`);
}

export type ApplyState = { ok: boolean; message: string } | null;

/**
 * Ergebnis übernehmen: Preis (und auf Wunsch den erkannten Namen) ins Produkt schreiben und in die Verteilung
 * eintragen – bei Aufruf aus einer Verteilung in diese, sonst in alle kommenden Verteilungen mit dem Produkt.
 */
async function doApply(fd: FormData): Promise<ApplyState> {
  const checkId = uuid.parse(fd.get("checkId"));
  const [check] = await db.select().from(schema.priceChecks).where(eq(schema.priceChecks.id, checkId));
  if (!check || check.status !== "done") return { ok: false, message: "Ergebnis nicht gefunden." };
  const chosen = price(fd, "price") ?? check.suggestedPrice;
  const withName = fd.get("withName") === "on" && check.recognizedName;
  if (chosen === null && !withName) return { ok: false, message: "Bitte einen Preis eintragen." };
  await db
    .update(P)
    .set({
      ...(chosen !== null ? { price: chosen } : {}),
      ...(withName ? { name: check.recognizedName!, variant: check.recognizedVariant, ...(check.recognizedCategory ? { category: check.recognizedCategory } : {}) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(P.id, check.productId));
  let events = 0;
  if (chosen !== null) {
    const eventId = uuid.safeParse(fd.get("eventId"));
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    const target = eventId.success
      ? [eventId.data]
      : (await db.select({ id: E.id }).from(E).innerJoin(I, eq(I.eventId, E.id)).where(and(eq(I.productId, check.productId), sql`${E.eventDate} >= ${today}`))).map((r) => r.id);
    if (target.length) {
      const updated = await db.update(I).set({ price: chosen }).where(and(inArray(I.eventId, target), eq(I.productId, check.productId))).returning({ id: I.id });
      events = updated.length;
    }
    for (const id of target) revalidatePath(`/verteilung/${id}`);
  }
  revalidatePath(`/produkte/${check.productId}`);
  const parts = [chosen !== null ? `Preis ${chosen.toFixed(2).replace(".", ",")} € übernommen` : "", withName ? `Name „${check.recognizedName}“ übernommen` : ""].filter(Boolean);
  const where = chosen === null ? "" : events ? ` – eingetragen in ${events === 1 ? "1 Verteilung" : `${events} Verteilungen`}` : " – gilt als Vorschlag für die nächste Verteilung";
  return { ok: true, message: `${parts.join(", ")}${where}.` };
}

export async function applyPriceCheck(_prev: ApplyState, fd: FormData): Promise<ApplyState> {
  await requireLogin();
  return doApply(fd);
}

/** Knopf in der Tabelle einer Verteilung: KI-Vorschlag direkt als Preis übernehmen. */
export async function applySuggestion(checkId: string, eventId: string) {
  await requireLogin();
  const fd = new FormData();
  fd.set("checkId", uuid.parse(checkId));
  fd.set("eventId", uuid.parse(eventId));
  await doApply(fd);
}

/** Alle fertigen KI-Vorschläge einer Verteilung als Preis eintragen (nur Produkte ohne Preis). */
export async function applyAllSuggestions(eventId: string, fd: FormData) {
  await requireLogin();
  const id = uuid.parse(eventId);
  // Erst die Eingaben der Liste speichern, damit nichts verloren geht.
  await saveItems(fd);
  const items = await db.select({ id: I.id, productId: I.productId }).from(I).where(and(eq(I.eventId, id), sql`${I.price} is null`));
  if (items.length === 0) return;
  const checks = await latestPriceChecks(items.map((i) => i.productId));
  for (const it of items) {
    const c = checks.get(it.productId);
    if (c?.status !== "done" || c.suggestedPrice === null) continue;
    await db.update(I).set({ price: c.suggestedPrice }).where(eq(I.id, it.id));
    await db.update(P).set({ price: c.suggestedPrice, updatedAt: new Date() }).where(eq(P.id, it.productId));
  }
  revalidatePath(`/verteilung/${id}`);
}

// ---------- MHD-Foto ----------

export type MhdState = { ok: boolean; message: string; date?: string | null; fileId?: string } | null;

/**
 * MHD-Foto zu einer Zeile hochladen: wird getrennt vom Produktfoto gespeichert (nie auf Collage/Social Media)
 * und – wenn die KI eingerichtet ist – sofort abgelesen.
 */
export async function uploadMhdPhoto(itemId: string, fd: FormData): Promise<MhdState> {
  await requireLogin();
  const id = uuid.parse(itemId);
  const [item] = await db.select({ id: I.id, eventId: I.eventId }).from(I).where(eq(I.id, id));
  if (!item) return { ok: false, message: "Zeile nicht gefunden." };
  const file = images(fd, "photo")[0];
  if (!file) return { ok: false, message: "Kein Foto ausgewählt." };
  const fileId = await storeImage(file);
  if (!fileId) return { ok: false, message: "Foto nicht lesbar – bitte als JPG/PNG." };
  await db.update(I).set({ bestBeforeFileId: fileId }).where(eq(I.id, id));
  let result: MhdState = { ok: true, message: "MHD-Foto gespeichert – Datum bitte selbst eintragen.", fileId, date: null };
  if (aiConfigured()) {
    try {
      const reading = await readBestBefore({ mimeType: file.type, data: Buffer.from(await file.arrayBuffer()) });
      if (reading.date) {
        await db.update(I).set({ bestBefore: reading.date }).where(eq(I.id, id));
        result = { ok: true, message: `MHD erkannt: ${reading.raw ?? reading.date}`, fileId, date: reading.date };
      } else result = { ok: false, message: "Kein Datum lesbar – bitte schärfer fotografieren oder selbst eintragen.", fileId, date: null };
    } catch (e) {
      console.error("MHD lesen fehlgeschlagen", e);
      result = { ok: false, message: "KI nicht erreichbar – Datum bitte selbst eintragen.", fileId, date: null };
    }
  }
  revalidatePath(`/verteilung/${item.eventId}`);
  return result;
}
