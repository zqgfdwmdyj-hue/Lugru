"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import type { CollageSettings } from "@/db/schema";
import { requireLogin } from "@/lib/auth";
import { collageSettings, isPlaceholderName, nameFromFilename, PLACEHOLDER_NAME, cleanTileStyle, type TileStyle } from "@/lib/layout";
import { comparability, isDrink, isPackKind, isUnit, packText, splitInternal, UNSORTED_CATEGORY } from "@/lib/price-logic";
import { addProductsToEvent, rotateProductPhoto, checkImage, findPhoto, latestPriceChecks, loadEvent, photoIndex, storeChecked, storeImage } from "@/lib/service";
import { parseAmount, parseIsoDate } from "@/lib/numbers";
import { aiConfigured, failStaleChecks, queuePriceChecks, runPriceChecks } from "@/lib/price-research";
import { type AiMode, defaultAiMode, isAiMode } from "@/lib/ai-modes";
import { autoReadMhd, readBestBefore } from "@/lib/mhd";
import { logActivity } from "@/lib/activity";
import Anthropic from "@anthropic-ai/sdk";
import { generateIdeas, IDEA_MODES, type IdeaMode, isIdeaMode } from "@/lib/ideas";
import { getSetting, setSetting, SETTINGS } from "@/lib/settings";
import { formatDate } from "@/lib/numbers";
import { failStalePhotoPrices, pickFrontPhoto, queuePhotoPrices, runPhotoPrices } from "@/lib/photo-price";
import { hasSeveralPrices, parsePrintedPrice } from "@/lib/printed-price";

const uuid = z.string().uuid();
const STOCK_VALUES = ["palette", "halbe-palette", "viertel-palette", "kartons", "einzeln", "reste"] as const;
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
  // Sonst die gespeicherte Collage-Vorlage des Teams verwenden.
  const template = copyFrom.success ? null : await getSetting<Partial<CollageSettings>>(SETTINGS.collage);
  if (template) await db.update(E).set({ collage: collageSettings(template) }).where(eq(E.id, ev.id));
  if (copyFrom.success) {
    const src = await loadEvent(copyFrom.data);
    if (src) {
      const items = await db.select().from(I).where(eq(I.eventId, src.id)).orderBy(I.sort);
      await addProductsToEvent(ev.id, items.map((i) => i.productId), new Map(items.map((i) => [i.productId, { price: i.price, priceNote: i.priceNote, caption: i.caption, packNote: i.packNote, packPrice: i.packPrice, packKind: i.packKind, packCount: i.packCount, unit: i.unit, unitCount: i.unitCount, priceConfirmed: i.priceConfirmed }])));
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
  revalidatePath(`/verteilung/${id}`, "layout");
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

/** Collage-Einstellungen als Vorlage für neue Verteilungen speichern. */
export async function saveCollageTemplate(settings: CollageSettings) {
  const me = await requireLogin();
  await setSetting(SETTINGS.collage, collageSettings(settings));
  await logActivity(me, "Collage-Vorlage für neue Verteilungen gespeichert");
}

/** Highlights für Social Media: ausgewählte Einträge in der gewünschten Reihenfolge. */
export async function saveHighlights(eventId: string, itemIds: string[]) {
  await requireLogin();
  const id = uuid.parse(eventId);
  const ids = z.array(uuid).max(60).parse(itemIds);
  const valid = ids.length ? new Set((await db.select({ id: I.id }).from(I).where(and(eq(I.eventId, id), inArray(I.id, ids)))).map((r) => r.id)) : new Set<string>();
  await db.update(E).set({ highlights: ids.filter((x) => valid.has(x)) }).where(eq(E.id, id));
}

/** Account und Hashtags für Social Media – gelten fürs ganze Team. */
export async function saveSocialSettings(v: { handle: string; tags: string }) {
  await requireLogin();
  await setSetting(SETTINGS.social, { handle: String(v.handle ?? "").slice(0, 60), tags: String(v.tags ?? "").slice(0, 300) });
}

/** Produktfoto drehen (↺ / ↻). */
export async function rotatePhoto(productId: string, degrees: number) {
  const me = await requireLogin();
  const id = uuid.parse(productId);
  const deg = degrees === 180 ? 180 : degrees === 270 || degrees === -90 ? 270 : 90;
  const fileId = await rotateProductPhoto(id, deg);
  if (fileId) await logActivity(me, `Foto gedreht (${deg === 270 ? "links" : deg === 90 ? "rechts" : "180°"})`, { productId: id });
  // Das Foto erscheint auf vielen Seiten (Listen, Collage, Social Media)
  revalidatePath("/", "layout");
  return fileId;
}

/** Lage/Farbe des Preises für ein oder mehrere Produkte festlegen; null = wieder automatisch. */
export async function saveTileStyles(productIds: string[], style: TileStyle | null) {
  await requireLogin();
  const ids = z.array(uuid).max(500).parse(productIds);
  if (ids.length === 0) return;
  await db.update(P).set({ collageStyle: style ? cleanTileStyle(style) : {} }).where(inArray(P.id, ids));
}

/**
 * Speichert die Zeilen der Produktliste (alle oder – beim automatischen Speichern – nur die geänderten). Jedes Feld
 * hat ein verstecktes Gegenstück „o_…“ mit dem Stand beim Laden: Nur was sich seitdem geändert hat, wird geschrieben.
 * So überschreibt ein Speichern nichts, was inzwischen im Hintergrund eingetragen wurde (Preis aus dem Foto, Name von
 * der KI). Der gedrückte Knopf (op) kann danach eine Zeile entfernen/verschieben oder eine Stapelaktion ausführen.
 */
export async function saveItems(fd: FormData) {
  const me = await requireLogin();
  const eventId = uuid.parse(fd.get("eventId"));
  const items = await db.select().from(I).where(eq(I.eventId, eventId)).orderBy(I.sort, I.createdAt);
  const touchedPrices = new Map<string, number>();
  const changed = (key: string) => !fd.has(`o_${key}`) || str(fd, `o_${key}`) !== str(fd, key);
  const checkbox = (key: string) => fd.get(key) === "on";
  for (const it of items) {
    // Jede Zeile schickt „row_<id>“ mit – fehlt es, wurde die Zeile nicht mitgeschickt.
    if (!fd.has(`row_${it.id}`) && !fd.has(`price_${it.id}`)) continue;
    const set: Partial<typeof I.$inferInsert> = {};
    const k = (f: string) => `${f}_${it.id}`;
    if (fd.has(k("price")) && changed(k("price"))) {
      const typed = str(fd, k("price"));
      // „50 Cent“ / „50 ct“ verstehen; Unlesbares löscht den Preis nicht.
      const parsed = typed ? (parseAmount(typed) ?? parsePrintedPrice(typed)) : null;
      // Nur anders geschrieben („1.5“ statt „1,50“)? Dann nichts ändern – auch nicht den Bestätigt-Status.
      const same = parsed !== null && it.price !== null && Math.abs(parsed - it.price) < 0.005;
      if (!same && (!typed || (parsed !== null && parsed >= 0 && parsed < 100000))) {
        const p = parsed === null ? null : Math.round(parsed * 100) / 100;
        // Von Hand eingetragen = bestätigt.
        Object.assign(set, { price: p, priceSource: p === null ? null : "manuell", priceConfirmed: p !== null });
        if (p !== null && p !== it.price) touchedPrices.set(it.productId, p);
      }
    }
    if (fd.has(k("note")) && changed(k("note"))) set.priceNote = opt(fd, k("note"));
    // Einheit von Hand festgelegt = Einheit bestätigt (unabhängig vom Preis).
    if (fd.has(k("unit")) && changed(k("unit"))) {
      const u = str(fd, k("unit"));
      set.unit = isUnit(u) ? u : null;
      set.unitConfirmed = isUnit(u);
    }
    if (fd.has(k("unitcount")) && changed(k("unitcount"))) {
      const n = parseAmount(str(fd, k("unitcount")));
      set.unitCount = n === null || n < 1 || n > 10000 ? null : Math.round(n);
      set.unitConfirmed = true;
    }
    if (fd.has(k("packprice")) && (changed(k("packprice")) || changed(k("packnote")))) {
      set.packNote = opt(fd, k("packnote"));
      set.packPrice = price(fd, k("packprice")) ?? parsePrintedPrice(str(fd, k("packprice")));
    }
    if (fd.has(k("packkind")) && changed(k("packkind"))) {
      const v = str(fd, k("packkind"));
      set.packKind = isPackKind(v) ? v : null;
    }
    if (fd.has(k("packcount")) && changed(k("packcount"))) {
      const n = parseAmount(str(fd, k("packcount")));
      set.packCount = n === null || n < 2 || n > 10000 ? null : Math.round(n);
    }
    if (fd.has(k("stock")) && changed(k("stock"))) {
      const v = str(fd, k("stock"));
      set.stock = (STOCK_VALUES as readonly string[]).includes(v) ? (v as (typeof STOCK_VALUES)[number]) : null;
    }
    if (fd.has(k("outcome")) && changed(k("outcome"))) {
      const v = str(fd, k("outcome"));
      set.outcome = v === "weg" || v === "wenig" || v === "viel" ? v : null;
    }
    if (fd.has(k("caption")) && changed(k("caption"))) set.caption = opt(fd, k("caption"));
    if (fd.has(k("qty")) && changed(k("qty"))) {
      const qty = parseAmount(str(fd, k("qty")));
      set.quantity = qty === null || qty < 0 || qty > 1e6 ? null : Math.round(qty);
    }
    if (fd.has(k("mhd")) && changed(k("mhd"))) {
      set.bestBefore = parseIsoDate(str(fd, k("mhd")));
      set.bestBeforeSource = set.bestBefore ? "manuell" : null;
    }
    // Häkchen: unangehakt fehlt das Feld ganz – darum nur auswerten, wenn das Gegenstück „o_“ mitkam.
    if (fd.has(`o_${k("col")}`) && changed(k("col"))) set.inCollage = checkbox(k("col"));
    if (fd.has(`o_${k("fly")}`) && changed(k("fly"))) set.inFlyer = checkbox(k("fly"));
    if (Object.keys(set).length) await db.update(I).set(set).where(eq(I.id, it.id));
  }
  // Produktangaben (Name, Variante, Kategorie, MHD nötig?) – gelten auch für spätere Verteilungen.
  for (const productId of new Set(items.map((i) => i.productId))) {
    const k = (f: string) => `${f}_${productId}`;
    if (!["name", "variant", "cat", "mhdmode"].some((f) => fd.has(k(f)))) continue;
    const set: Partial<typeof P.$inferInsert> = {};
    const name = str(fd, k("name"));
    // Leerer Name = noch ohne Namen (Platzhalter bleibt).
    if (fd.has(k("name")) && name && changed(k("name"))) set.name = name;
    if (fd.has(k("variant")) && changed(k("variant"))) set.variant = opt(fd, k("variant"));
    // Leere Kategorie (z. B. „Neue Kategorie …“ noch ohne Text) ändert nichts.
    const cat = str(fd, k("cat"));
    if (fd.has(k("cat")) && changed(k("cat")) && cat && cat !== "__neu__") {
      set.category = cat.slice(0, 60);
      // Selbst gewählt = geprüft (keine Kategorie-Auffälligkeit mehr), außer „Noch zuordnen“.
      set.categoryChecked = cat !== UNSORTED_CATEGORY;
    }
    if (fd.has(k("mhdmode")) && changed(k("mhdmode"))) {
      const m = str(fd, k("mhdmode"));
      set.mhdMode = m === "ja" || m === "nein" ? m : null;
    }
    // Wer Name oder Variante selbst ändert, hat die KI-Angaben damit geprüft.
    if (set.name || "variant" in set) set.reviewNote = null;
    if (Object.keys(set).length) await db.update(P).set({ ...set, updatedAt: new Date() }).where(eq(P.id, productId));
  }
  // Der zuletzt verwendete Preis wird zum Vorschlag für das nächste Mal.
  for (const [productId, p] of touchedPrices) {
    await db.update(P).set({ price: p, priceConfirmed: true, updatedAt: new Date() }).where(eq(P.id, productId));
  }

  const [op, target] = str(fd, "op").split(":");
  const idx = items.findIndex((i) => i.id === target);
  const selected = fd.getAll("sel").map(String).filter((v) => items.some((i) => i.id === v));
  const selItems = items.filter((i) => selected.includes(i.id));
  let what = "Produktliste gespeichert";
  if (op === "remove" && idx >= 0) {
    await db.delete(I).where(eq(I.id, target));
    what = "Produkt aus der Liste entfernt";
  } else if ((op === "up" || op === "down") && idx >= 0) {
    const order = items.map((i) => i.id);
    const j = op === "up" ? idx - 1 : idx + 1;
    if (j >= 0 && j < order.length) {
      [order[idx], order[j]] = [order[j], order[idx]];
      for (let n = 0; n < order.length; n++) await db.update(I).set({ sort: (n + 1) * 10 }).where(eq(I.id, order[n]));
    }
    what = "Reihenfolge geändert";
  } else if (op === "ai" && idx >= 0) {
    await startChecks([items[idx].productId], defaultAiMode());
    await startPhotoPrices(eventId, [items[idx].productId]);
    what = "KI-Suche für ein Produkt gestartet";
  } else if (op === "confirm" && idx >= 0) {
    await db.update(I).set({ priceConfirmed: true }).where(and(eq(I.id, target), sql`${I.price} is not null`));
    what = "Preis bestätigt";
  } else if (op === "mhd-ok" && idx >= 0) {
    await db.update(I).set({ bestBeforeSource: "bestaetigt" }).where(eq(I.id, target));
    what = "Automatisch gelesenes MHD bestätigt";
  } else if (op === "einheit-ok" && idx >= 0) {
    await db.update(I).set({ unitConfirmed: true }).where(eq(I.id, target));
    what = "Abgabeeinheit bestätigt";
  } else if (op === "kategorie-ok" && idx >= 0) {
    await db.update(P).set({ categoryChecked: true, updatedAt: new Date() }).where(eq(P.id, items[idx].productId));
    what = "Kategorie bestätigt";
  } else if (op === "angaben-ok" && idx >= 0) {
    await db.update(P).set({ reviewNote: null, updatedAt: new Date() }).where(eq(P.id, items[idx].productId));
    what = "KI-Angaben bestätigt";
  } else if (op === "sort") {
    // Nach Kategorie und Name ordnen – so wie im Aushang.
    const rows = await db.select({ id: I.id, cat: P.category, name: P.name, variant: P.variant }).from(I).innerJoin(P, eq(P.id, I.productId)).where(eq(I.eventId, eventId));
    rows.sort((a, b) => a.cat.localeCompare(b.cat, "de") || a.name.localeCompare(b.name, "de") || (a.variant ?? "").localeCompare(b.variant ?? "", "de"));
    for (let n = 0; n < rows.length; n++) await db.update(I).set({ sort: (n + 1) * 10 }).where(eq(I.id, rows[n].id));
    what = "Liste sortiert";
  } else if (op === "bulk" && selItems.length) {
    const ids = selItems.map((i) => i.id);
    const pids = selItems.map((i) => i.productId);
    const n = selItems.length;
    if (target === "cat") {
      const cat = str(fd, "bulk_cat");
      if (!cat) {
        revalidatePath(`/verteilung/${eventId}`, "layout");
        return;
      }
      await db.update(P).set({ category: cat.slice(0, 60), categoryChecked: cat !== UNSORTED_CATEGORY, updatedAt: new Date() }).where(inArray(P.id, pids));
      what = `${n} Produkt(e) der Kategorie „${cat}“ zugeordnet`;
    } else if (target === "col-on" || target === "col-off") {
      await db.update(I).set({ inCollage: target === "col-on" }).where(inArray(I.id, ids));
      what = `${n} Produkt(e) ${target === "col-on" ? "in die" : "aus der"} Collage`;
    } else if (target === "fly-on" || target === "fly-off") {
      await db.update(I).set({ inFlyer: target === "fly-on" }).where(inArray(I.id, ids));
      what = `${n} Produkt(e) ${target === "fly-on" ? "in den" : "aus dem"} Aushang`;
    } else if (target === "confirm") {
      // Preis und KI-Angaben – Abgabeeinheit und Kategorie werden getrennt bestätigt.
      await db.update(I).set({ priceConfirmed: true }).where(and(inArray(I.id, ids), sql`${I.price} is not null`));
      await db.update(P).set({ reviewNote: null }).where(inArray(P.id, pids));
      what = `${n} Preis(e)/KI-Angaben bestätigt`;
    } else if (target === "unit-ok") {
      await db.update(I).set({ unitConfirmed: true }).where(inArray(I.id, ids));
      what = `Abgabeeinheit bei ${n} Produkt(en) bestätigt`;
    } else if (target === "cat-ok") {
      await db.update(P).set({ categoryChecked: true }).where(inArray(P.id, pids));
      what = `Kategorie bei ${n} Produkt(en) bestätigt`;
    } else if (target === "mhd-nein" || target === "mhd-ja" || target === "mhd-auto") {
      await db.update(P).set({ mhdMode: target === "mhd-auto" ? null : target === "mhd-ja" ? "ja" : "nein" }).where(inArray(P.id, pids));
      what = `MHD für ${n} Produkt(e): ${target === "mhd-nein" ? "nicht nötig" : target === "mhd-ja" ? "nötig" : "nach Kategorie"}`;
    } else if (target === "ai") {
      await startChecks(pids, stufe(fd), { skipRecent: fd.get("bulk_neu") !== "on" });
      await startPhotoPrices(eventId, pids);
      what = `KI-Suche für ${n} ausgewählte Produkt(e) gestartet`;
    } else if (target.startsWith("stock-") || target.startsWith("outcome-")) {
      // „stock-halbe-palette“ → Feld „stock“, Wert „halbe-palette“
      const field = target.slice(0, target.indexOf("-")) as "stock" | "outcome";
      const value = target.slice(target.indexOf("-") + 1);
      const v = value === "leer" ? null : value;
      if (field === "stock" && (v === null || (STOCK_VALUES as readonly string[]).includes(v))) await db.update(I).set({ stock: v as (typeof STOCK_VALUES)[number] | null }).where(inArray(I.id, ids));
      if (field === "outcome" && (v === null || v === "weg" || v === "wenig" || v === "viel")) await db.update(I).set({ outcome: v }).where(inArray(I.id, ids));
      what = `${field === "stock" ? "Bestand" : "Ergebnis"} für ${n} Produkt(e) eingetragen`;
    } else if (target === "rueckseite") {
      // Genau zwei: das obere in der Liste ist die Vorderseite, das untere wird ihr Infofoto.
      if (selItems.length !== 2) {
        revalidatePath(`/verteilung/${eventId}`, "layout");
        return;
      }
      const name = await joinBackside(selItems[0].productId, selItems[1].productId);
      what = `Vorder- und Rückseite zusammengeführt: ${name ?? ""}`;
    } else if (target === "remove") {
      await db.delete(I).where(inArray(I.id, ids));
      what = `${n} Produkt(e) aus der Verteilung entfernt`;
    }
  }
  await db.update(E).set({ updatedAt: new Date() }).where(eq(E.id, eventId));
  if (op === "auto") {
    // Automatisches Speichern einzelner Zeilen: im Protokoll die Produkte nennen.
    const saved = items.filter((it) => fd.has(`row_${it.id}`) || fd.has(`price_${it.id}`)).map((it) => it.productId);
    const names = saved.length ? await db.select({ name: P.name }).from(P).where(inArray(P.id, saved)) : [];
    if (names.length) await logActivity(me, `Geändert: ${names.map((x) => (isPlaceholderName(x.name) ? "ohne Namen" : x.name)).join(", ")}`, { eventId, productId: saved.length === 1 ? saved[0] : null });
    revalidatePath(`/verteilung/${eventId}`, "layout");
    return;
  }
  await logActivity(me, what, { eventId, productId: idx >= 0 ? items[idx].productId : null });
  revalidatePath(`/verteilung/${eventId}`, "layout");
}

/**
 * Preiswiderspruch zwischen Foto und Angabe lösen – „eingetragen“: der eingetragene Preis gilt (Collage klebt ihn über
 * den alten), „foto“: Preis aus dem Foto übernehmen, „falsch“: im Foto steht gar kein (bzw. ein falsch gelesener) Preis.
 */
export async function resolvePhotoPrice(itemId: string, decision: "eingetragen" | "foto" | "falsch", fd?: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(itemId);
  z.enum(["eingetragen", "foto", "falsch"]).parse(decision);
  if (fd?.has("eventId")) await saveItems(fd);
  const [row] = await db
    .select({ item: I, fileId: P.imageFileId, photoPrice: schema.files.printedPrice, photoText: schema.files.printedPriceText })
    .from(I)
    .innerJoin(P, eq(P.id, I.productId))
    .leftJoin(schema.files, eq(schema.files.id, P.imageFileId))
    .where(eq(I.id, id));
  if (!row) return;
  if (decision === "eingetragen" && row.fileId && row.item.price !== null) {
    await db.update(I).set({ priceConfirmed: true, priceOverPhotoFileId: row.fileId }).where(eq(I.id, id));
  } else if (decision === "foto" && row.photoPrice !== null) {
    await db.update(I).set({ price: row.photoPrice, priceSource: "foto", priceConfirmed: true, priceOverPhotoFileId: null }).where(eq(I.id, id));
    await db.update(P).set({ price: row.photoPrice, priceConfirmed: true, updatedAt: new Date() }).where(eq(P.id, row.item.productId));
  } else if (decision === "falsch" && row.fileId) {
    await db.update(schema.files).set({ printedStatus: "done", printedPrice: null, printedPriceText: null, printedPriceBox: null, printedRejected: true, printedScannedAt: new Date() }).where(eq(schema.files.id, row.fileId));
  }
  const label = decision === "eingetragen" ? "Eingetragenen Preis bestätigt (Foto zeigt anderen)" : decision === "foto" ? `Fotopreis übernommen (${row.photoText ?? ""})` : "Fotoerkennung als falsch markiert";
  await logActivity(me, label, { eventId: row.item.eventId, productId: row.item.productId });
  revalidatePath(`/verteilung/${row.item.eventId}`, "layout");
}

/**
 * Von Hand: „Im Foto steht schon ein Preis“ – wenn die automatische Erkennung ihn übersehen hat. Ohne Betrag gilt
 * der eingetragene Preis. Dann druckt die Collage keinen zweiten; weicht er ab, erscheint ein Widerspruch.
 */
export async function markPhotoPrice(itemId: string, fd?: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(itemId);
  const typed = fd ? str(fd, `photoprice_${id}`) : "";
  if (fd?.has("eventId")) await saveItems(fd);
  const [row] = await db.select({ item: I, fileId: P.imageFileId }).from(I).innerJoin(P, eq(P.id, I.productId)).where(eq(I.id, id));
  if (!row?.fileId) return;
  const amount = typed ? (parseAmount(typed) ?? parsePrintedPrice(typed)) : row.item.price;
  if (amount === null || !(amount > 0) || amount > 1000) return;
  const p = Math.round(amount * 100) / 100;
  const text = p < 1 ? `${Math.round(p * 100)} Cent` : `${p.toFixed(2).replace(".", ",").replace(",00", "")} €`;
  await db
    .update(schema.files)
    .set({ printedStatus: "done", printedPrice: p, printedPriceText: text, printedPriceBox: null, printedRejected: false, printedReader: 9, printedScannedAt: new Date() })
    .where(eq(schema.files.id, row.fileId));
  await logActivity(me, `Preis im Foto von Hand eingetragen (${text})`, { eventId: row.item.eventId, productId: row.item.productId });
  revalidatePath(`/verteilung/${row.item.eventId}`, "layout");
}

/**
 * Vorder- und Rückseite zu einem Produkt zusammenführen: Die Rückseite wird Infofoto der Vorderseite (nie auf
 * Collage/Social Media). Fehlende Angaben (Name, Variante, Kategorie, Preis) werden von der Rückseite ergänzt,
 * Einträge in anderen Verteilungen umgehängt, dann wird das Rückseiten-Produkt gelöscht.
 */
async function joinBackside(frontId: string, backId: string): Promise<string | null> {
  if (frontId === backId) return null;
  const prods = await db.select().from(P).where(inArray(P.id, [frontId, backId]));
  const front = prods.find((p) => p.id === frontId);
  const back = prods.find((p) => p.id === backId);
  if (!front || !back) return null;
  const PP = schema.productPhotos;
  const files = [back.imageFileId, ...(await db.select({ f: PP.fileId }).from(PP).where(eq(PP.productId, backId))).map((r) => r.f)].filter((f): f is string => !!f && f !== front.imageFileId);
  if (files.length) await db.insert(PP).values(files.map((fileId) => ({ productId: frontId, fileId, role: "rueckseite" as const }))).onConflictDoNothing();
  const set: Partial<typeof P.$inferInsert> = {};
  if (isPlaceholderName(front.name) && !isPlaceholderName(back.name)) set.name = back.name;
  if (!front.variant && back.variant) set.variant = back.variant;
  if (front.category === UNSORTED_CATEGORY && back.category !== UNSORTED_CATEGORY) set.category = back.category;
  if (front.price === null && back.price !== null) Object.assign(set, { price: back.price, priceConfirmed: back.priceConfirmed });
  if (back.note) set.note = [front.note, back.note].filter(Boolean).join("\n");
  if (Object.keys(set).length) await db.update(P).set({ ...set, updatedAt: new Date() }).where(eq(P.id, frontId));
  // In Verteilungen mit beiden: fehlenden Preis der Vorderseite von der Rückseite übernehmen.
  const both = await db.execute<{ fid: string; bid: string }>(sql`
    select f.id as fid, b.id as bid from event_items f join event_items b on b.event_id = f.event_id
     where f.product_id = ${frontId} and b.product_id = ${backId}`);
  for (const r of both.rows) {
    const [[fi], [bi]] = await Promise.all([db.select().from(I).where(eq(I.id, r.fid)), db.select().from(I).where(eq(I.id, r.bid))]);
    if (fi && bi && fi.price === null && bi.price !== null) {
      await db.update(I).set({ price: bi.price, priceSource: bi.priceSource, priceConfirmed: bi.priceConfirmed, priceNote: fi.priceNote ?? bi.priceNote, unit: fi.unit ?? bi.unit, unitCount: fi.unitCount ?? bi.unitCount, unitConfirmed: fi.unitConfirmed || bi.unitConfirmed }).where(eq(I.id, fi.id));
    }
  }
  // Andere Verteilungen: Einträge der Rückseite umhängen (wo die Vorderseite noch fehlt).
  await db.execute(sql`
    update event_items i set product_id = ${frontId}
     where i.product_id = ${backId}
       and not exists (select 1 from event_items j where j.event_id = i.event_id and j.product_id = ${frontId})`);
  await db.delete(P).where(eq(P.id, backId));
  return isPlaceholderName(set.name ?? front.name) ? "ohne Namen" : (set.name ?? front.name);
}

/** „Prüfen“: vorgeschlagenes Paar zusammenführen (Rückseite wird Infofoto). */
export async function mergeBackside(eventId: string, frontProductId: string, backProductId: string) {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  const name = await joinBackside(uuid.parse(frontProductId), uuid.parse(backProductId));
  if (name) await logActivity(me, `Vorder- und Rückseite zusammengeführt: ${name}`, { eventId: id, productId: frontProductId });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/** „Prüfen“: Das sind verschiedene Produkte – nicht mehr als mögliche Rückseite vorschlagen. */
export async function keepSeparate(eventId: string, aProductId: string, bProductId: string) {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  const a = uuid.parse(aProductId);
  const b = uuid.parse(bProductId);
  await db.update(P).set({ distinctFrom: sql`${P.distinctFrom} || ${JSON.stringify([b])}::jsonb` }).where(eq(P.id, a));
  await db.update(P).set({ distinctFrom: sql`${P.distinctFrom} || ${JSON.stringify([a])}::jsonb` }).where(eq(P.id, b));
  await logActivity(me, "Mögliche Rückseite: sind verschiedene Produkte", { eventId: id, productId: a });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/**
 * Weitere Fotos zu einem vorhandenen Produkt (Rückseite, Zutaten, MHD) – es entsteht kein neuer Artikel.
 * Hat das Produkt noch kein Foto, wird das erste zum Titelbild.
 */
export async function addProductPhotos(productId: string, fd: FormData): Promise<{ added: number; skipped: number }> {
  const me = await requireLogin();
  const id = uuid.parse(productId);
  const [p] = await db.select({ imageFileId: P.imageFileId }).from(P).where(eq(P.id, id));
  if (!p) return { added: 0, skipped: 0 };
  const PP = schema.productPhotos;
  const have = new Set([p.imageFileId, ...(await db.select({ f: PP.fileId }).from(PP).where(eq(PP.productId, id))).map((r) => r.f)].filter(Boolean));
  const haveSha = have.size ? new Set((await db.select({ sha: schema.files.sha256 }).from(schema.files).where(inArray(schema.files.id, [...have] as string[]))).map((r) => r.sha)) : new Set<string>();
  let added = 0;
  let skipped = 0;
  let main = p.imageFileId;
  for (const file of images(fd, "photos").slice(0, 10)) {
    const img = await checkImage(file);
    // Dasselbe Foto hängt schon an diesem Produkt → nicht doppelt.
    if (!img || haveSha.has(img.sha)) {
      skipped++;
      continue;
    }
    const fileId = await storeChecked(img);
    haveSha.add(img.sha);
    if (!main) {
      await db.update(P).set({ imageFileId: fileId, updatedAt: new Date() }).where(eq(P.id, id));
      main = fileId;
    } else await db.insert(PP).values({ productId: id, fileId, role: "info" }).onConflictDoNothing();
    added++;
  }
  if (added) {
    await logActivity(me, `${added} Foto(s) zum Produkt hinzugefügt`, { productId: id });
    // Neue Rückseite → MHD bei Lebensmitteln gleich mitlesen.
    if (aiConfigured()) after(() => autoReadMhd([id]).then(() => undefined).catch((e) => console.error("MHD automatisch", e)));
  }
  revalidatePath("/", "layout");
  return { added, skipped };
}

/** Infofoto (Rückseite) wieder vom Produkt lösen oder zum Hauptfoto machen. */
export async function changeExtraPhoto(productId: string, fileId: string, action: "hauptfoto" | "entfernen") {
  const me = await requireLogin();
  const pid = uuid.parse(productId);
  const fid = uuid.parse(fileId);
  z.enum(["hauptfoto", "entfernen"]).parse(action);
  const PP = schema.productPhotos;
  const [p] = await db.select().from(P).where(eq(P.id, pid));
  if (!p) return;
  await db.delete(PP).where(and(eq(PP.productId, pid), eq(PP.fileId, fid)));
  if (action === "hauptfoto") {
    // Bisheriges Hauptfoto wird Infofoto.
    if (p.imageFileId) await db.insert(PP).values({ productId: pid, fileId: p.imageFileId, role: "info" }).onConflictDoNothing();
    await db.update(P).set({ imageFileId: fid, updatedAt: new Date() }).where(eq(P.id, pid));
  }
  await logActivity(me, action === "hauptfoto" ? "Infofoto als Hauptfoto gesetzt" : "Infofoto entfernt", { productId: pid });
  revalidatePath("/", "layout");
}

/** „Prüfen“: MHD für Lebensmittel ohne Datum von den Fotos lesen lassen (im Hintergrund). */
export async function readEventMhd(eventId: string) {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  if (!aiConfigured()) return;
  const rows = await db.select({ productId: I.productId }).from(I).where(and(eq(I.eventId, id), sql`${I.bestBefore} is null`));
  after(() => autoReadMhd(rows.map((r) => r.productId), id).then(() => undefined).catch((e) => console.error("MHD automatisch", e)));
  await logActivity(me, "MHD aus Fotos lesen gestartet", { eventId: id });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/** Nach „Alle Fotos = ein Produkt“: Die KI sucht unter den Fotos die Vorderseite als Titelbild aus. */
export async function chooseFrontPhoto(productId: string, eventId: string) {
  await requireLogin();
  const pid = uuid.parse(productId);
  const eid = uuid.parse(eventId);
  if (aiConfigured()) after(() => pickFrontPhoto(pid).then(() => undefined).catch((e) => console.error("Titelbild wählen", e)));
  revalidatePath(`/verteilung/${eid}`, "layout");
}

/** Vorschlag für die ganze Packung übernehmen (aus den Details einer Zeile). */
export async function applyPackSuggestion(itemId: string, value: number, fd?: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(itemId);
  const v = z.number().positive().max(10000).parse(value);
  if (fd?.has("eventId")) await saveItems(fd);
  const [it] = await db.update(I).set({ packPrice: Math.round(v * 100) / 100 }).where(eq(I.id, id)).returning({ eventId: I.eventId, productId: I.productId });
  if (!it) return;
  await logActivity(me, `Packungsvorschlag ${v.toFixed(2).replace(".", ",")} € übernommen`, { eventId: it.eventId, productId: it.productId });
  revalidatePath(`/verteilung/${it.eventId}`, "layout");
}

/** „Prüfen“: MHD-Relevanz für angehakte Produkte festlegen – „ja“ (Nahrung) oder „nein“ (Zubehör). */
export async function setMhdMode(eventId: string, mode: "ja" | "nein", fd: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  const m = z.enum(["ja", "nein"]).parse(mode);
  const ids = fd.getAll("productId").map(String).filter((v) => uuid.safeParse(v).success);
  if (ids.length === 0) return;
  await db.update(P).set({ mhdMode: m, updatedAt: new Date() }).where(inArray(P.id, ids));
  await logActivity(me, `MHD ${m === "ja" ? "nötig (Nahrung)" : "nicht nötig (Zubehör)"} für ${ids.length} Produkt(e)`, { eventId: id });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/** „Prüfen“: angehakte Preise als bestätigt markieren. */
export async function confirmItems(eventId: string, fd: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  const ids = fd.getAll("itemId").map(String).filter((v) => uuid.safeParse(v).success);
  if (ids.length === 0) return;
  const done = await db.update(I).set({ priceConfirmed: true }).where(and(eq(I.eventId, id), inArray(I.id, ids), sql`${I.price} is not null`)).returning({ id: I.id });
  await logActivity(me, `${done.length} Preis(e) bestätigt`, { eventId: id });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/** „Prüfen“: von der KI eingetragene Namen/Varianten als richtig bestätigen. */
export async function confirmProducts(eventId: string, fd: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  const ids = fd.getAll("productId").map(String).filter((v) => uuid.safeParse(v).success);
  if (ids.length === 0) return;
  await db.update(P).set({ reviewNote: null, updatedAt: new Date() }).where(inArray(P.id, ids));
  await logActivity(me, `KI-Angaben bei ${ids.length} Produkt(en) bestätigt`, { eventId: id });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/** „Prüfen“: Abgabeeinheiten festlegen und bestätigen (je Zeile Einheit und Stückzahl). */
export async function confirmUnits(eventId: string, fd: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  const ids = fd.getAll("itemId").map(String).filter((v) => uuid.safeParse(v).success);
  let n = 0;
  for (const itemId of ids) {
    const u = str(fd, `unit_${itemId}`);
    const c = parseAmount(str(fd, `unitcount_${itemId}`));
    const done = await db
      .update(I)
      .set({ unit: isUnit(u) ? u : null, unitCount: isUnit(u) && u !== "stueck" && c !== null && c > 1 && c <= 10000 ? Math.round(c) : null, unitConfirmed: true })
      .where(and(eq(I.id, itemId), eq(I.eventId, id)))
      .returning({ id: I.id });
    n += done.length;
  }
  if (n) await logActivity(me, `Abgabeeinheit bei ${n} Produkt(en) bestätigt`, { eventId: id });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/** „Prüfen“: Kategorie stimmt so – keine Auffälligkeit mehr anzeigen. */
export async function confirmCategories(eventId: string, fd: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  const ids = fd.getAll("productId").map(String).filter((v) => uuid.safeParse(v).success);
  if (ids.length === 0) return;
  await db.update(P).set({ categoryChecked: true }).where(inArray(P.id, ids));
  await logActivity(me, `Kategorie bei ${ids.length} Produkt(en) bestätigt`, { eventId: id });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/**
 * „Prüfen“: interne Hinweise aus Name/Variante entfernen („Marke nicht identifiziert“ …) – sie wandern in die
 * Notiz des Produkts und erscheinen nicht mehr in Collage, Aushang und Messenger.
 */
export async function cleanInternalText(eventId: string, fd: FormData) {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  const ids = fd.getAll("productId").map(String).filter((v) => uuid.safeParse(v).success);
  if (ids.length === 0) return;
  const rows = await db.select().from(P).where(inArray(P.id, ids));
  for (const p of rows) {
    const n = splitInternal(p.name);
    const v = splitInternal(p.variant);
    const notes = [...n.notes, ...v.notes];
    if (!notes.length) continue;
    await db
      .update(P)
      .set({ name: n.clean || p.name, variant: v.clean || null, note: [p.note, `Interner Hinweis: ${notes.join("; ")}`].filter(Boolean).join("\n"), updatedAt: new Date() })
      .where(eq(P.id, p.id));
  }
  await logActivity(me, `Interne Hinweise bei ${rows.length} Produkt(en) aus Name/Variante entfernt`, { eventId: id });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/** „Ergebnisse erfassen“: Wie lief es? – ein Klick je Produkt (null = noch offen). */
export async function setOutcome(itemId: string, outcome: "weg" | "wenig" | "viel" | null) {
  await requireLogin();
  const id = uuid.parse(itemId);
  const v = outcome === null ? null : z.enum(["weg", "wenig", "viel"]).parse(outcome);
  const [it] = await db.update(I).set({ outcome: v }).where(eq(I.id, id)).returning({ eventId: I.eventId });
  if (it) revalidatePath(`/verteilung/${it.eventId}`, "layout");
}

/** „Ergebnisse erfassen“: alle noch offenen auf einmal setzen (z. B. „alles weg“). */
export async function setOpenOutcomes(eventId: string, outcome: "weg" | "wenig" | "viel") {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  const v = z.enum(["weg", "wenig", "viel"]).parse(outcome);
  const done = await db.update(I).set({ outcome: v }).where(and(eq(I.eventId, id), sql`${I.outcome} is null`)).returning({ id: I.id });
  await logActivity(me, `Ergebnis „${v}“ für ${done.length} offene Produkt(e) gesetzt`, { eventId: id });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/** Produktdatenbank → „Kategorie prüfen“: Vorschlag übernehmen oder „Stimmt so“ (für alte Bestände ohne Verteilung). */
export async function setProductCategory(productId: string, category: string | null) {
  const me = await requireLogin();
  const id = uuid.parse(productId);
  const cat = category?.trim().slice(0, 60) || null;
  await db.update(P).set({ ...(cat ? { category: cat } : {}), categoryChecked: true, updatedAt: new Date() }).where(eq(P.id, id));
  await logActivity(me, cat ? `Kategorie „${cat}“ übernommen` : "Kategorie bestätigt", { productId: id });
  revalidatePath("/produkte");
}

/** KI-Kategorie übernehmen (aus „Prüfen“) – nur für ausdrücklich gewählte Produkte. */
export async function applyCategory(productId: string, category: string, eventId: string) {
  const me = await requireLogin();
  const id = uuid.parse(productId);
  const cat = category.trim().slice(0, 60);
  if (!cat) return;
  await db.update(P).set({ category: cat, categoryChecked: true, updatedAt: new Date() }).where(eq(P.id, id));
  await logActivity(me, `Kategorie „${cat}“ übernommen`, { productId: id, eventId: uuid.parse(eventId) });
  revalidatePath(`/verteilung/${eventId}`, "layout");
}

export async function addToEvent(fd: FormData) {
  const me = await requireLogin();
  const eventId = uuid.parse(fd.get("eventId"));
  if (!(await loadEvent(eventId))) return;
  const ids = fd.getAll("productId").map(String).filter((v) => uuid.safeParse(v).success);
  const n = await addProductsToEvent(eventId, ids);
  if (n) await logActivity(me, `${n} Produkt(e) aus der Datenbank hinzugefügt`, { eventId });
  revalidatePath(`/verteilung/${eventId}`, "layout");
}

/**
 * Viele Fotos auf einmal: Jedes Foto wird ein neues Produkt (Name aus dem Dateinamen, sonst leer
 * zum Nachtragen) und landet direkt in der Aktion.
 */
/** reused: schon in der Datenbank, jetzt in die Verteilung übernommen; alreadyInEvent: war schon drin; similar: neu, aber ähnlich wie ein vorhandenes. */
export type UploadResult = { added: number; reused: number; alreadyInEvent: number; similar: number; backs: number; rejected: string[]; productId?: string | null };

/**
 * Fotos hochladen – der Browser schickt sie in kleinen Portionen (siehe PhotoUpload), damit auch 50+ Fotos
 * vom Handy ohne Absturz durchgehen. Gibt zurück, was angelegt, wiedererkannt oder abgelehnt wurde.
 */
export async function uploadPhotos(fd: FormData): Promise<UploadResult> {
  const me = await requireLogin();
  const result: UploadResult = { added: 0, reused: 0, alreadyInEvent: 0, similar: 0, backs: 0, rejected: [] };
  const eventId = uuid.parse(fd.get("eventId"));
  if (!(await loadEvent(eventId))) return result;
  // Neue Fotos landen in „Noch zuordnen“ – die KI darf das ersetzen, bestätigte Kategorien bleiben.
  const category = str(fd, "category") || UNSORTED_CATEGORY;
  const ids: string[] = [];
  const index = await photoIndex();
  const inEvent = new Set((await db.select({ id: I.productId }).from(I).where(eq(I.eventId, eventId))).map((r) => r.id));
  // „Vorder- und Rückseite abwechselnd“: jedes zweite Foto ist die Rückseite des vorherigen (nur Infofoto).
  // „Alle Fotos = ein Produkt“: das erste wird das Produkt, alle weiteren Infofotos (auch über mehrere Portionen:
  // der Browser schickt die Produkt-ID der ersten Portion als „zu“ mit).
  const mode = str(fd, "modus") || (fd.get("paare") === "1" ? "paare" : "einzeln");
  const pairs = mode === "paare";
  const continued = uuid.safeParse(fd.get("zu"));
  let single: string | null = mode === "ein-produkt" && continued.success ? continued.data : null;
  let lastFront: string | null = null;
  const files = images(fd, "photos").slice(0, 20);
  for (let n = 0; n < files.length; n++) {
    const file = files[n];
    const img = await checkImage(file);
    if (!img) {
      result.rejected.push(file.name);
      if (pairs && n % 2 === 0) lastFront = null;
      continue;
    }
    if (mode === "ein-produkt" && single) {
      const known = findPhoto(img, index);
      if (!known || known.how === "ähnlich") {
        const fileId = await storeChecked(img);
        await db.insert(schema.productPhotos).values({ productId: single, fileId, role: "info" }).onConflictDoNothing();
        index.push({ productId: single, sha: img.sha, hash: img.hash, createdAt: new Date() });
      }
      result.backs++;
      continue;
    }
    if (pairs && n % 2 === 1) {
      if (lastFront) {
        const known = findPhoto(img, index);
        if (!known || known.how === "ähnlich") {
          const fileId = await storeChecked(img);
          await db.insert(schema.productPhotos).values({ productId: lastFront, fileId, role: "rueckseite" }).onConflictDoNothing();
          index.push({ productId: lastFront, sha: img.sha, hash: img.hash, createdAt: new Date() });
        }
        result.backs++;
      }
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
      lastFront = found.productId;
      if (mode === "ein-produkt") single = found.productId;
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
    lastFront = p.id;
    if (mode === "ein-produkt") single = p.id;
    result.added++;
    if (found) result.similar++;
  }
  await addProductsToEvent(eventId, ids);
  // Steht schon ein Preis auf dem Foto (alte Collage-Bilder)? Im Hintergrund ablesen und eintragen – jedes Foto
  // nur einmal, wiedererkannte Fotos gar nicht erneut.
  await startPhotoPrices(eventId, ids);
  // Rückseiten zeigen oft das MHD: bei Lebensmitteln gleich mitlesen (im Hintergrund).
  if (result.backs && aiConfigured()) {
    const touched = [...new Set([...ids, ...(single ? [single] : [])])];
    after(() => autoReadMhd(touched, eventId).then(() => undefined).catch((e) => console.error("MHD automatisch", e)));
  }
  if (result.added + result.reused) await logActivity(me, `Fotos hochgeladen: ${result.added} neu, ${result.reused} wiedererkannt${result.backs ? `, ${result.backs} Infofoto(s)` : ""}`, { eventId });
  revalidatePath(`/verteilung/${eventId}`, "layout");
  return { ...result, productId: single };
}

async function startPhotoPrices(eventId: string, productIds: string[], opts: { again?: boolean; retry?: boolean } = {}) {
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
  await startPhotoPrices(id, rows.map((r) => r.productId), { again: fd.get("umfang") === "alle", retry: true });
  revalidatePath(`/verteilung/${id}`, "layout");
}

/** Falsch erkannt: Foto gilt als „ohne Preis“, die Collage druckt den Preis wieder normal. */
export async function clearPrintedPrice(fileId: string, back: string, fd?: FormData) {
  await requireLogin();
  const id = uuid.parse(fileId);
  // Aus der Produktliste heraus: erst deren Eingaben speichern.
  if (fd?.has("eventId")) await saveItems(fd);
  await db.update(schema.files).set({ printedStatus: "done", printedPrice: null, printedPriceText: null, printedPriceBox: null, printedRejected: true, printedScannedAt: new Date() }).where(eq(schema.files.id, id));
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
    .values({ name, variant: opt(fd, "variant"), category: str(fd, "category") || UNSORTED_CATEGORY, price: price(fd, "price"), note: opt(fd, "note"), imageFileId })
    .returning({ id: P.id });
  const eventId = uuid.safeParse(fd.get("eventId"));
  await logActivity(me, `Produkt „${name}“ angelegt`, { productId: p.id, eventId: eventId.success ? eventId.data : null });
  if (eventId.success && (await loadEvent(eventId.data))) {
    const pr = price(fd, "price");
    // Von Hand angelegt = eingetragener, bestätigter Preis.
    await addProductsToEvent(eventId.data, [p.id], new Map([[p.id, { price: pr, priceNote: null, caption: null, priceConfirmed: pr !== null, priceSource: pr === null ? null : ("manuell" as const) }]]));
    revalidatePath(`/verteilung/${eventId.data}`, "layout");
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
      category: str(fd, "category") || UNSORTED_CATEGORY,
      price: price(fd, "price"),
      priceConfirmed: true,
      categoryChecked: (str(fd, "category") || UNSORTED_CATEGORY) !== UNSORTED_CATEGORY,
      note: opt(fd, "note"),
      ...(fd.has("mhdMode") ? { mhdMode: fd.get("mhdMode") === "ja" ? ("ja" as const) : fd.get("mhdMode") === "nein" ? ("nein" as const) : null } : {}),
      // Von Hand gespeichert = Angaben geprüft.
      reviewNote: null,
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
  revalidatePath(`/verteilung/${eventId}`, "layout");
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
      ...(chosen !== null ? { price: chosen, priceConfirmed: true } : {}),
      ...(withName ? { name: check.recognizedName!, variant: check.recognizedVariant, reviewNote: null, ...(check.recognizedCategory ? { category: check.recognizedCategory } : {}) } : {}),
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
      // Von Hand übernommen = bestätigt.
      const updated = await db.update(I).set({ price: chosen, priceSource: "ki", priceConfirmed: true }).where(and(inArray(I.eventId, target), eq(I.productId, check.productId))).returning({ id: I.id });
      events = updated.length;
    }
    for (const id of target) revalidatePath(`/verteilung/${id}`, "layout");
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
  // Aus der Produktliste heraus: erst deren Eingaben speichern, damit nichts verloren geht.
  if ([...fd.keys()].some((k) => k.startsWith("row_"))) await saveItems(fd);
  const items = await db
    .select({ id: I.id, productId: I.productId, photoText: schema.files.printedPriceText, variant: P.variant })
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
    // Andere Packungsgröße im Handel → nicht vergleichbar, bleibt zur Prüfung.
    if (comparability(it.variant, c).level === "abweichend") continue;
    // Als Stapel übernommen → noch unbestätigt, erscheint unter „Prüfen“.
    await db.update(I).set({ price: c.suggestedPrice, priceSource: "ki", priceConfirmed: false }).where(eq(I.id, it.id));
    await db.update(P).set({ price: c.suggestedPrice, priceConfirmed: false, updatedAt: new Date() }).where(eq(P.id, it.productId));
  }
  revalidatePath(`/verteilung/${id}`, "layout");
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
    .select({ id: I.id, productId: I.productId, price: I.price, confirmed: I.priceConfirmed, over: I.priceOverPhotoFileId, fileId: P.imageFileId, photoPrice: schema.files.printedPrice, photoText: schema.files.printedPriceText })
    .from(I)
    .innerJoin(P, eq(P.id, I.productId))
    .innerJoin(schema.files, eq(schema.files.id, P.imageFileId))
    .where(and(eq(I.eventId, id), only.success ? eq(I.id, only.data) : undefined));
  for (const r of rows) {
    if (r.photoPrice === null || hasSeveralPrices(r.photoText) || r.price === r.photoPrice) continue;
    // Im Stapel nie einen bestätigten oder bewusst gegen das Foto entschiedenen Preis ersetzen.
    if (!only.success && r.price !== null && (r.confirmed || r.over === r.fileId)) continue;
    await db.update(I).set({ price: r.photoPrice, priceSource: "foto", priceConfirmed: true, priceOverPhotoFileId: null }).where(eq(I.id, r.id));
    await db.update(P).set({ price: r.photoPrice, updatedAt: new Date() }).where(eq(P.id, r.productId));
  }
  revalidatePath(`/verteilung/${id}`, "layout");
}

// ---------- Ideen (Themenpakete, Rezepte, Werbetext) ----------

export type IdeasState = { ok: boolean; message: string } | null;

export async function createIdeas(eventId: string, _prev: IdeasState, fd: FormData): Promise<IdeasState> {
  const me = await requireLogin();
  const id = uuid.parse(eventId);
  if (!aiConfigured()) return { ok: false, message: "KI ist aus – auf dem Server ANTHROPIC_API_KEY setzen." };
  const event = await loadEvent(id);
  if (!event) return { ok: false, message: "Verteilung nicht gefunden." };
  const rows = await db
    .select({ name: P.name, variant: P.variant, category: P.category, price: I.price, priceNote: I.priceNote, quantity: I.quantity, bestBefore: I.bestBefore, packNote: I.packNote, packPrice: I.packPrice, packKind: I.packKind, packCount: I.packCount })
    .from(I)
    .innerJoin(P, eq(P.id, I.productId))
    .where(eq(I.eventId, id))
    .orderBy(I.sort);
  // Packungsbezeichnung wie in Aushang und Collage („Kasten (12 × 0,5 l)“)
  const items = rows.filter((r) => !isPlaceholderName(r.name)).map((r) => ({ ...r, packNote: r.packPrice != null ? packText(r, isDrink(r), r.variant) : r.packNote }));
  if (items.length === 0) return { ok: false, message: "Noch keine Produkte mit Namen in dieser Verteilung." };
  const themes = fd.getAll("thema").map(String).filter(Boolean).slice(0, 6);
  const wish = str(fd, "wunsch").slice(0, 500);
  const mode = isIdeaMode(fd.get("modus")) ? (fd.get("modus") as IdeaMode) : "alles";
  try {
    const { result, inputTokens, outputTokens } = await generateIdeas({ dateLabel: formatDate(event.eventDate), items, themes, wish, mode });
    const what = mode === "alles" ? [] : [IDEA_MODES[mode].label.replace(/^\S+\s/, "")];
    await db.insert(schema.eventIdeas).values({ eventId: id, request: [...what, ...themes, wish].filter(Boolean).join(" · ") || "Vorschläge der KI", result, userName: me.name, inputTokens, outputTokens });
    await logActivity(me, `Ideen erzeugt${themes.length ? `: ${themes.join(", ")}` : ""}`, { eventId: id });
  } catch (e) {
    console.error("Ideen fehlgeschlagen", e);
    const message =
      e instanceof Anthropic.AuthenticationError ? "API-Schlüssel ungültig (ANTHROPIC_API_KEY prüfen)."
      : e instanceof Anthropic.RateLimitError ? "Zu viele Anfragen – bitte gleich nochmal versuchen."
      : e instanceof Anthropic.APIConnectionError ? "KI nicht erreichbar – Internetverbindung des Servers prüfen und erneut versuchen."
      : e instanceof Anthropic.APIError ? `KI-Dienst meldet Fehler ${e.status}.`
      : e instanceof Error ? e.message
      : "Unbekannter Fehler";
    return { ok: false, message };
  }
  revalidatePath(`/verteilung/${id}/ideen`);
  return { ok: true, message: "Neue Ideen sind da." };
}

export async function deleteIdeas(ideaId: string, eventId: string) {
  await requireLogin();
  await db.delete(schema.eventIdeas).where(and(eq(schema.eventIdeas.id, uuid.parse(ideaId)), eq(schema.eventIdeas.eventId, uuid.parse(eventId))));
  revalidatePath(`/verteilung/${eventId}/ideen`);
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
  revalidatePath(`/verteilung/${item.eventId}`, "layout");
  return result;
}
