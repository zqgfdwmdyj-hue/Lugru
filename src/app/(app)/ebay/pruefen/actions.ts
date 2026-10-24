"use server";

import { revalidatePath } from "next/cache";
import { requireArea } from "@/lib/auth/session";
import { applyRevision, checkNow, queueChecks, refreshListings, startChecks, suggestForWeakest, suggestWithAi } from "@/lib/ebay-review/service";
import type { Revision } from "@/lib/ebay-review/logic";

export type ActionState = { ok: boolean; message: string } | null;

const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
const itemIdOf = (fd: FormData) => {
  const id = String(fd.get("itemId") ?? "").trim();
  if (!/^\d{6,20}$/.test(id)) throw new Error("Ungültige Artikelnummer.");
  return id;
};

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
    return { ok: true, message: "KI-Vorschlag ist da – unten prüfen und übernehmen." };
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

/** Titel, Merkmale (Felder „a:<Name>“), Preis und Preisvorschlag bei eBay ändern. */
export async function applyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireArea("ebay");
  try {
    const id = itemIdOf(fd);
    const aspects: Record<string, string[]> = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("a:")) continue;
      const name = k.slice(2).trim().slice(0, 65);
      const values = String(v)
        .split(/\s*;\s*/)
        .map((x) => x.trim().slice(0, 65))
        .filter(Boolean);
      if (name && values.length) aspects[name] = values;
    }
    const title = String(fd.get("title") ?? "").trim();
    const r: Revision = {
      ...(title ? { title } : {}),
      ...(Object.keys(aspects).length ? { aspects } : {}),
      ...(fd.get("price") !== null ? { price: money(fd.get("price")) } : {}),
      ...(fd.get("bestOfferField") ? { bestOffer: fd.get("bestOffer") === "on" } : {}),
    };
    if (r.price === undefined) delete r.price;
    const changes = await applyRevision(session.tenantId, id, r);
    revalidatePath(`/ebay/pruefen/${id}`);
    revalidatePath("/ebay/pruefen");
    return { ok: true, message: `Bei eBay geändert: ${changes.join(" · ")}` };
  } catch (e) {
    return fail(e);
  }
}
