"use server";

import { revalidatePath } from "next/cache";
import { requireArea } from "@/lib/auth/session";
import { amazonContentFor, applyRevision, checkNow, queueChecks, refreshListings, refreshTraffic, startChecks, suggestForWeakest, suggestWithAi, uploadImageFile } from "@/lib/ebay-review/service";
import type { Revision } from "@/lib/ebay-review/logic";
import type { AmazonContent } from "@/lib/ebay-review/content";

export type ActionState = { ok: boolean; message: string } | null;

const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
const checkItemId = (v: unknown) => {
  const id = String(v ?? "").trim();
  if (!/^\d{6,20}$/.test(id)) throw new Error("Ungültige Artikelnummer.");
  return id;
};
const itemIdOf = (fd: FormData) => checkItemId(fd.get("itemId"));

/** Laufende Angebote von eBay laden; neue und noch nicht geprüfte werden gleich geprüft. */
export async function refreshAction(_prev: ActionState): Promise<ActionState> {
  const session = await requireArea("ebay");
  try {
    const r = await refreshListings(session.tenantId);
    await queueChecks(session.tenantId, { staleDays: 7 });
    startChecks(session.tenantId);
    revalidatePath("/ebay/pruefen");
    return { ok: true, message: `${r.total} laufende Angebote${r.added ? `, ${r.added} neu` : ""}${r.ended ? `, ${r.ended} beendet` : ""} – Prüfung läuft.` };
  } catch (e) {
    return fail(e);
  }
}

export async function recheckAllAction(_prev: ActionState): Promise<ActionState> {
  const session = await requireArea("ebay");
  const n = await queueChecks(session.tenantId);
  startChecks(session.tenantId);
  revalidatePath("/ebay/pruefen");
  return { ok: true, message: `${n} Angebote werden neu geprüft.` };
}

/** Nur Einblendungen und Klicks neu holen (nach dem Neuverbinden mit „Verkehrsdaten“). */
export async function refreshTrafficAction(_prev: ActionState): Promise<ActionState> {
  const session = await requireArea("ebay");
  try {
    const r = await refreshTraffic(session.tenantId);
    revalidatePath("/ebay/pruefen", "layout");
    if (r.error) return { ok: false, message: r.error };
    if (!r.updated) return { ok: true, message: "Noch keine geprüften Angebote – zuerst „Angebote von eBay laden“." };
    return { ok: true, message: `Verkehrsdaten geladen: ${r.withData} von ${r.updated} Angeboten mit Einblendungen/Klicks (letzte 30 Tage).` };
  } catch (e) {
    return fail(e);
  }
}

export async function aiWeakestAction(_prev: ActionState): Promise<ActionState> {
  const session = await requireArea("ebay");
  void suggestForWeakest(session.tenantId, 10)
    .then(() => revalidatePath("/ebay/pruefen"))
    .catch((e) => console.error("[KI-Vorschläge]", e instanceof Error ? e.message : e));
  return { ok: true, message: "KI-Vorschläge für die 10 schwächsten Angebote werden geholt – nach und nach in der Liste." };
}

export async function recheckOneAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireArea("ebay");
  try {
    const id = itemIdOf(fd);
    await checkNow(session.tenantId, id);
    revalidatePath(`/ebay/pruefen/${id}`);
    return { ok: true, message: "Neu geprüft." };
  } catch (e) {
    return fail(e);
  }
}

export async function aiSuggestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireArea("ebay");
  try {
    const id = itemIdOf(fd);
    await suggestWithAi(session.tenantId, id);
    revalidatePath(`/ebay/pruefen/${id}`);
    return { ok: true, message: "KI-Vorschlag ist unten eingetragen – markierte Felder prüfen, dann „Bei eBay ändern“." };
  } catch (e) {
    return fail(e);
  }
}

const money = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(/\s|€/g, "").replace(",", ".");
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) throw new Error("Bitte einen gültigen Preis eingeben.");
  return Math.round(n * 100) / 100;
};

// ---- Bilder, Beschreibung, Merkmale (Inhalte-Editor) -------------------------------------------

export type AmazonResult = { ok: true; content: AmazonContent; tokensLeft: number | null } | { ok: false; message: string };

/** Bilder, Stichpunkte, Beschreibung und Merkmale von Amazon (über Keepa) holen – per ASIN/EAN oder EAN des Angebots. */
export async function amazonContentAction(itemId: string, code: string): Promise<AmazonResult> {
  const session = await requireArea("ebay");
  try {
    const r = await amazonContentFor(session.tenantId, checkItemId(itemId), String(code ?? "").slice(0, 20));
    const { tokensLeft, ...content } = r;
    return { ok: true, content, tokensLeft };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export type UploadResult = { ok: true; urls: string[]; errors: string[] } | { ok: false; message: string };

/** Eigene Bilddateien zu eBay hochladen; die Adressen kommen in die Bilderliste (gesendet wird erst mit „Bei eBay ändern“). */
export async function uploadImagesAction(fd: FormData): Promise<UploadResult> {
  const session = await requireArea("ebay");
  const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  if (!files.length) return { ok: false, message: "Bitte Bilddateien auswählen." };
  if (files.length > 12) return { ok: false, message: "Höchstens 12 Bilder auf einmal." };
  const urls: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (!/^image\/(jpeg|png|gif|webp|bmp|tiff|heic|heif)$/i.test(f.type) && !/\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif)$/i.test(f.name)) {
      errors.push(`${f.name}: kein Bild`);
      continue;
    }
    try {
      urls.push(await uploadImageFile(session.tenantId, f.name.replace(/[^\w.\-]+/g, "_").slice(-80), Buffer.from(await f.arrayBuffer())));
    } catch (e) {
      errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!urls.length) return { ok: false, message: errors.join(" · ") || "Kein Bild hochgeladen." };
  return { ok: true, urls, errors };
}

export type ContentInput = {
  itemId: string;
  /** Neuer Titel – nur wenn geändert. */
  title?: string;
  /** Neuer Preis ohne Versand – nur wenn geändert (nicht bei Varianten). */
  price?: number;
  /** Preisvorschlag an/aus – nur wenn geändert. */
  bestOffer?: boolean;
  /** Vollständige, geordnete Bilderliste – nur wenn geändert. */
  images?: string[];
  /** Neue Beschreibung (HTML) – nur wenn geändert. */
  description?: string;
  /** Vollständige Merkmalsliste – ersetzt die vorhandene; nur wenn geändert. */
  aspects?: Record<string, string[]>;
};

/** Titel, Preis, Preisvorschlag, Bilder, Beschreibung und Merkmale bei eBay ändern – nur, was im Editor geändert wurde, in einem Schritt. */
export async function applyContentAction(input: ContentInput): Promise<ActionState> {
  const session = await requireArea("ebay");
  try {
    const id = checkItemId(input?.itemId);
    const r: Revision = {};
    if (input.title !== undefined) {
      const title = String(input.title).replace(/\s+/g, " ").trim();
      if (!title) throw new Error("Der Titel darf nicht leer sein.");
      r.title = title.slice(0, 80);
    }
    if (input.price !== undefined) r.price = money(String(input.price));
    if (input.bestOffer !== undefined) r.bestOffer = Boolean(input.bestOffer);
    if (input.images !== undefined) {
      if (!Array.isArray(input.images) || input.images.some((u) => typeof u !== "string")) throw new Error("Ungültige Bilderliste.");
      r.images = input.images.map((u) => u.trim().slice(0, 1000));
    }
    if (input.description !== undefined) {
      if (typeof input.description !== "string") throw new Error("Ungültige Beschreibung.");
      if (!input.description.trim()) throw new Error("Die Beschreibung darf nicht leer sein.");
      r.description = input.description;
    }
    let replaceAspects = false;
    if (input.aspects !== undefined) {
      const out: Record<string, string[]> = {};
      for (const [k, vs] of Object.entries(input.aspects ?? {})) {
        const name = String(k).trim().slice(0, 65);
        const values = (Array.isArray(vs) ? vs : [])
          .map((v) => String(v).trim().slice(0, 65))
          .filter(Boolean)
          .slice(0, 30);
        if (name && values.length) out[name] = [...new Set(values)];
      }
      if (!Object.keys(out).length) throw new Error("Mindestens ein Merkmal muss bleiben.");
      if (Object.keys(out).length > 45) throw new Error("eBay erlaubt höchstens 45 Merkmale.");
      r.aspects = out;
      replaceAspects = true;
    }
    if (!Object.keys(r).length) throw new Error("Nichts geändert.");
    const changes = await applyRevision(session.tenantId, id, r, { replaceAspects });
    revalidatePath(`/ebay/pruefen/${id}`);
    revalidatePath("/ebay/pruefen");
    return { ok: true, message: `Bei eBay geändert: ${changes.join(" · ")}` };
  } catch (e) {
    return fail(e);
  }
}
