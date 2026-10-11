"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import type { CollageSettings } from "@/db/schema";
import { requireLogin } from "@/lib/auth";
import { collageSettings, isPlaceholderName, nameFromFilename, PLACEHOLDER_NAME, type TileStyle, tileStyle } from "@/lib/layout";
import { addProductsToEvent, checkImage, findPhoto, latestPriceChecks, loadEvent, photoIndex, storeChecked, storeImage } from "@/lib/service";
import { parseAmount, parseIsoDate } from "@/lib/numbers";
import { aiConfigured, failStaleChecks, queuePriceChecks, runPriceChecks } from "@/lib/price-research";
import { type AiMode, defaultAiMode, isAiMode } from "@/lib/ai-modes";
import { readBestBefore } from "@/lib/mhd";
import { logActivity } from "@/lib/activity";
import { formatDate } from "@/lib/numbers";
import { failStalePhotoPrices, queuePhotoPrices, runPhotoPrices } from "@/lib/photo-price";
import { hasSeveralPrices, parsePrintedPrice } from "@/lib/printed-price";

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
  const me = await requireLogin();
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
  await logActivity(me, `Verteilung ${formatDate(eventDate)} angelegt${copyFrom.success ? " (Produkte übernommen)" : ""}`, { eventId: ev.id });
  redirect(`/verteilung/${ev.id}`);
}

export async function updateEvent(fd: FormData) {
  const me = await requireLogin();
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
  await logActivity(me, "Eckdaten geändert", { eventId: id });
  revalidatePath(`/verteilung/${id}`);
}

export async function deleteEvent(fd: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(fd.get("eventId"));
  const ev = await loadEvent(id);
  await db.delete(E).where(eq(E.id, id));
  if (ev) await logActivity(me, `Verteilung ${formatDate(ev.eventDate)} gelöscht`);
  redirect("/");
}

export async function saveCollageSettings(eventId: string, settings: CollageSettings) {
  await requireLogin();
  const id = uuid.parse(eventId);
  await db.update(E).set({ collage: collageSettings(settings) }).where(eq(E.id, id));
}

/** Lage/Farbe des Preises für ein oder mehrere Produkte festlegen; null = wieder automatisch. */
export async function saveTileStyles(productIds: string[], style: TileStyle | null) {
  await requireLogin();
  const ids = z.array(uuid).max(500).parse(productIds);
  if (ids.length === 0) return;
  const t = tileStyle(style);
  await db.update(P).set({ collageStyle: style && t.custom ? { pos: t.pos, color: t.color } : {} }).where(inArray(P.id, ids));
}

/**
 * Speichert alle Zeilen der Produktliste einer Aktion. Der gedrückte Knopf (op) kann zusätzlich
 * eine Zeile entfernen oder verschieben – vorher werden die Eingaben gespeichert, damit nichts verloren geht.
 */
export async function saveItems(fd: FormData) {
  const me = await requireLogin();
  const eventId = uuid.parse(fd.get("eventId"));
  const items = await db.select().from(I).where(eq(I.eventId, eventId)).orderBy(I.sort, I.createdAt);
  const touchedPrices = new Map<string, number>();
  // Felder, die seit dem Laden der Seite nicht angefasst wurden, bleiben unverändert – so überschreibt ein
  // Speichern nichts, was inzwischen im Hintergrund eingetragen wurde (Preis aus dem Foto, Name von der KI).
  const changed = (key: string) => !fd.has(`o_${key}`) || str(fd, `o_${key}`) !== str(fd, key);
  for (const it of items) {
    if (!fd.has(`price_${it.id}`)) continue;
    const typed = str(fd, `price_${it.id}`);
    // „50 Cent“ / „50 ct“ verstehen; Unlesbares löscht den Preis nicht.
    const parsed = typed ? (parseAmount(typed) ?? parsePrintedPrice(typed)) : null;
    const priceOk = !typed || (parsed !== null && parsed >= 0 && parsed < 100000);
    const p = priceOk && parsed !== null ? Math.round(parsed * 100) / 100 : null;
    const qty = parseAmount(str(fd, `qty_${it.id}`));
    await db
      .update(I)
      .set({
        ...(changed(`price_${it.id}`) && priceOk ? { price: p } : {}),
        priceNote: opt(fd, `note_${it.id}`),
        caption: opt(fd, `caption_${it.id}`),
        quantity: qty === null || qty < 0 || qty > 1e6 ? null : Math.round(qty),
        ...(changed(`mhd_${it.id}`) ? { bestBefore: parseIsoDate(str(fd, `mhd_${it.id}`)) } : {}),
        inCollage: fd.get(`col_${it.id}`) === "on",
        inFlyer: fd.get(`fly_${it.id}`) === "on",
      })
      .where(eq(I.id, it.id));
    if (changed(`price_${it.id}`) && priceOk && p !== null && p !== it.price) touchedPrices.set(it.productId, p);
  }
  // Name, Variante und Kategorie lassen sich direkt in der Liste pflegen (z. B. nach dem Foto-Upload).
  for (const productId of new Set(items.map((i) => i.productId))) {
    if (!fd.has(`name_${productId}`)) continue;
    const name = str(fd, `name_${productId}`);
    const set: Partial<typeof P.$inferInsert> = {};
    // Leerer Name = noch ohne Namen (Platzhalter bleibt); Variante und Kategorie trotzdem speichern.
    if (name && changed(`name_${productId}`)) set.name = name;
    if (changed(`variant_${productId}`)) set.variant = opt(fd, `variant_${productId}`);
    if (changed(`cat_${productId}`)) set.category = str(fd, `cat_${productId}`) || "Lebensmittel";
    if (Object.keys(set).length) await db.update(P).set({ ...set, updatedAt: new Date() }).where(eq(P.id, productId));
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
    await startPhotoPrices(eventId, [items[idx].productId]);
  } else if (op === "sort") {
    // Nach Kategorie und Name ordnen – so wie im Aushang.
    const rows = await db.select({ id: I.id, cat: P.category, name: P.name, variant: P.variant }).from(I).innerJoin(P, eq(P.id, I.productId)).where(eq(I.eventId, eventId));
    rows.sort((a, b) => a.cat.localeCompare(b.cat, "de") || a.name.localeCompare(b.name, "de") || (a.variant ?? "").localeCompare(b.variant ?? "", "de"));
    for (let k = 0; k < rows.length; k++) await db.update(I).set({ sort: (k + 1) * 10 }).where(eq(I.id, rows[k].id));
  }
  await db.update(E).set({ updatedAt: new Date() }).where(eq(E.id, eventId));
  if (op === "auto") {
    // Automatisches Speichern einzelner Zeilen: im Protokoll die Produkte nennen.
    const saved = items.filter((it) => fd.has(`price_${it.id}`)).map((it) => it.productId);
    const names = saved.length ? await db.select({ name: P.name }).from(P).where(inArray(P.id, saved)) : [];
    if (names.length) await logActivity(me, `Geändert: ${names.map((n) => (isPlaceholderName(n.name) ? "ohne Namen" : n.name)).join(", ")}`, { eventId, productId: saved.length === 1 ? saved[0] : null });
    revalidatePath(`/verteilung/${eventId}`);
    return;
  }
  const what = op === "remove" ? "Produkt aus der Liste entfernt" : op === "sort" ? "Liste sortiert" : op === "ai" ? "KI-Suche für ein Produkt gestartet" : op === "up" || op === "down" ? "Reihenfolge geändert" : "Produktliste gespeichert";
  await logActivity(me, what, { eventId, productId: idx >= 0 ? items[idx].productId : null });
  revalidatePath(`/verteilung/${eventId}`);
}

export async function addToEvent(fd: FormData) {
  const me = await requireLogin();
  const eventId = uuid.parse(fd.get("eventId"));
  if (!(await loadEvent(eventId))) return;
  const ids = fd.getAll("productId").map(String).filter((v) => uuid.safeParse(v).success);
  const n = await addProductsToEvent(eventId, ids);
  if (n) await logActivity(me, `${n} Produkt(e) aus der Datenbank hinzugefügt`, { eventId });
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
  const me = await requireLogin();
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
  // Steht schon ein Preis auf dem Foto (alte Collage-Bilder)? Im Hintergrund ablesen und eintragen – jedes Foto
  // nur einmal, wiedererkannte Fotos gar nicht erneut.
  await startPhotoPrices(eventId, ids);
  if (result.added + result.reused) await logActivity(me, `Fotos hochgeladen: ${result.added} neu, ${result.reused} wiedererkannt`, { eventId });
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
export async function clearPrintedPrice(fileId: string, back: string, fd?: FormData) {
  await requireLogin();
  const id = uuid.parse(fileId);
  // Aus der Produktliste heraus: erst deren Eingaben speichern.
  if (fd?.has("eventId")) await saveItems(fd);
  await db.update(schema.files).set({ printedStatus: "done", printedPrice: null, printedPriceText: null, printedPriceBox: null, printedScannedAt: new Date() }).where(eq(schema.files.id, id));
  revalidatePath(back.startsWith("/") ? back : "/");
}

// ---------- Produkte ----------

export async function createProduct(fd: FormData) {
  const me = await requireLogin();
  const name = str(fd, "name");
  if (!name) return;
  const image = images(fd, "image")[0];
  const imageFileId = image ? await storeImage(image) : null;
  const [p] = await db
    .insert(P)
    .values({ name, variant: opt(fd, "variant"), category: str(fd, "category") || "Lebensmittel", price: price(fd, "price"), note: opt(fd, "note"), imageFileId })
    .returning({ id: P.id });
  const eventId = uuid.safeParse(fd.get("eventId"));
  await logActivity(me, `Produkt „${name}“ angelegt`, { productId: p.id, eventId: eventId.success ? eventId.data : null });
  if (eventId.success && (await loadEvent(eventId.data))) {
    await addProductsToEvent(eventId.data, [p.id]);
    revalidatePath(`/verteilung/${eventId.data}`);
    return;
  }
  revalidatePath("/produkte");
}

export async function updateProduct(fd: FormData) {
  const me = await requireLogin();
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
  await logActivity(me, `Produkt „${name}“ bearbeitet${imageFileId ? " (neues Foto)" : ""}`, { productId: id });
  const back = str(fd, "back");
  revalidatePath(`/produkte/${id}`);
  if (back.startsWith("/verteilung/")) redirect(back);
}

/** Löscht ein Produkt nur, wenn es noch in keiner Aktion war – sonst wird es archiviert. */
export async function deleteProduct(fd: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(fd.get("productId"));
  const [prod] = await db.select({ name: P.name }).from(P).where(eq(P.id, id));
  if (prod) await logActivity(me, `Produkt „${prod.name}“ gelöscht bzw. archiviert`, { productId: id });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(I).where(eq(I.productId, id));
  if (n > 0) await db.update(P).set({ archived: true, updatedAt: new Date() }).where(eq(P.id, id));
  else await db.delete(P).where(eq(P.id, id));
  redirect("/produkte");
}

/** Mehrere Produkte zu einem zusammenlegen (z. B. doppelt angelegt nach dem Foto-Upload). */
export async function mergeProducts(fd: FormData) {
  const me = await requireLogin();
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
  await logActivity(me, `${dropIds.length} doppelte(s) Produkt(e) zusammengeführt`, { productId: keep });
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
  const me = await requireLogin();
  const eventId = uuid.parse(fd.get("eventId"));
  const rows = await db.select({ productId: I.productId, price: I.price, name: P.name }).from(I).innerJoin(P, eq(P.id, I.productId)).where(eq(I.eventId, eventId)).orderBy(I.sort);
  const mode = stufe(fd);
  const all = fd.get("umfang") === "alle";
  const wanted = rows.filter((r) => all || (mode === "erkennen" ? isPlaceholderName(r.name) : r.price === null || isPlaceholderName(r.name)));
  await startChecks(wanted.map((r) => r.productId), mode, { skipRecent: true });
  // Dabei auch Preise ablesen, die schon auf den Fotos stehen (jedes Foto nur einmal).
  await startPhotoPrices(eventId, rows.map((r) => r.productId));
  await logActivity(me, `KI-Suche gestartet (${mode}, ${all ? "alle" : "nur fehlende"})`, { eventId });
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
export async function applySuggestion(checkId: string, eventId: string, form?: FormData) {
  await requireLogin();
  // Erst die übrigen Eingaben der Liste speichern, damit nichts verloren geht.
  if (form?.has("eventId")) await saveItems(form);
  const fd = new FormData();
  fd.set("checkId", uuid.parse(checkId));
  fd.set("eventId", uuid.parse(eventId));
  await doApply(fd);
}

/** Alle fertigen KI-Vorschläge einer Verteilung als Preis eintragen (nur Produkte ohne Preis). */
export async function applyAllSuggestions(eventId: string, fd: FormData) {
  const me = await requireLogin();
  await logActivity(me, "Alle KI-Vorschläge als Preis übernommen", { eventId: uuid.parse(eventId) });
  const id = uuid.parse(eventId);
  // Erst die Eingaben der Liste speichern, damit nichts verloren geht.
  await saveItems(fd);
  const items = await db
    .select({ id: I.id, productId: I.productId, photoText: schema.files.printedPriceText })
    .from(I)
    .innerJoin(P, eq(P.id, I.productId))
    .leftJoin(schema.files, eq(schema.files.id, P.imageFileId))
    .where(and(eq(I.eventId, id), sql`${I.price} is null`));
  if (items.length === 0) return;
  const checks = await latestPriceChecks(items.map((i) => i.productId));
  for (const it of items) {
    // Steht der Preis schon im Foto, gilt der – nicht die Schätzung der KI.
    if (it.photoText) continue;
    const c = checks.get(it.productId);
    if (c?.status !== "done" || c.suggestedPrice === null) continue;
    await db.update(I).set({ price: c.suggestedPrice }).where(eq(I.id, it.id));
    await db.update(P).set({ price: c.suggestedPrice, updatedAt: new Date() }).where(eq(P.id, it.productId));
  }
  revalidatePath(`/verteilung/${id}`);
}

/** Für alle Produkte, deren Foto schon einen Preis zeigt, genau diesen Preis eintragen (statt KI-Vorschlag o. ä.). */
export async function applyPhotoPrices(eventId: string, itemId: string | null, fd: FormData) {
  const me = await requireLogin();
  await logActivity(me, itemId ? "Preis vom Foto übernommen" : "Preise vom Foto übernommen", { eventId: uuid.parse(eventId) });
  const id = uuid.parse(eventId);
  // Aus der Produktliste heraus: erst deren Eingaben speichern.
  if (fd.has("eventId")) await saveItems(fd);
  const only = uuid.safeParse(itemId);
  const rows = await db
    .select({ id: I.id, productId: I.productId, price: I.price, photoPrice: schema.files.printedPrice, photoText: schema.files.printedPriceText })
    .from(I)
    .innerJoin(P, eq(P.id, I.productId))
    .innerJoin(schema.files, eq(schema.files.id, P.imageFileId))
    .where(and(eq(I.eventId, id), only.success ? eq(I.id, only.data) : undefined));
  for (const r of rows) {
    if (r.photoPrice === null || hasSeveralPrices(r.photoText) || r.price === r.photoPrice) continue;
    await db.update(I).set({ price: r.photoPrice }).where(eq(I.id, r.id));
    await db.update(P).set({ price: r.photoPrice, updatedAt: new Date() }).where(eq(P.id, r.productId));
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
