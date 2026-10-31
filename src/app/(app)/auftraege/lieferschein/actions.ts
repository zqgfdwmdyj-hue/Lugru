"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { createSlipLabels, readOpenOrders, readSlip, slipRow, type SlipLabels, type SlipRow } from "@/lib/shipping/slip-service";
import { saveSkuShipping } from "@/lib/shipping/weights-service";
import { parseWsMax } from "@/lib/shipping/warensendung";
import { parseWeightInput } from "@/lib/shipping/weight";
import type { ShipChoice } from "@/lib/shipping/packing-slip";

export type SlipState = { rows: SlipRow[]; error?: string; note?: string; labels?: SlipLabels; unclear?: number } | null;

const CHOICES = ["warensendung", "dhl", "pruefen"] as const;
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Ein Formular-Ablauf: „create“ erstellt Labels, „weights“ speichert Gewichte je Artikel, „open“ übernimmt offene
 * Aufträge (z. B. eBay), sonst wird ein Lieferschein eingelesen.
 */
export async function slipAction(prev: SlipState, fd: FormData): Promise<SlipState> {
  const intent = fd.get("intent");
  if (intent === "create") return createSlip(prev, fd);
  if (intent === "weights") return saveWeights(prev, fd);
  if (intent === "open") return openOrders(fd);
  return readSlipFile(fd);
}

/**
 * Versandangaben je Artikel speichern (Gewicht je Stück, Warensendung bis … Stück) – gilt ab sofort für alle
 * Sendungen dieses Artikels (alle Kanäle). Nur geänderte Felder werden geschrieben.
 */
async function saveWeights(prev: SlipState, fd: FormData): Promise<SlipState> {
  const session = await requireArea("wawi");
  const rows = prev?.rows ?? [];
  const bad: string[] = [];
  let saved = 0;
  const indexes = new Set([...fd.keys()].map((k) => /^(?:w|ws|sf)_(\d+)$/.exec(k)?.[1]).filter((x): x is string => Boolean(x)));
  for (const i of indexes) {
    const sku = String(fd.get(`s_${i}`) ?? "").trim();
    if (!sku) continue;
    const patch: { grams?: number | null; wsMax?: number | null; shipFrom?: "self" | "prep" | null } = {};
    const raw = String(fd.get(`w_${i}`) ?? "").trim();
    if (fd.has(`w_${i}`) && raw !== String(fd.get(`o_${i}`) ?? "")) {
      const grams = raw === "" ? 0 : parseWeightInput(raw);
      if (grams === null) bad.push(`${sku}: „${raw}“`);
      else patch.grams = grams || null;
    }
    const sf = String(fd.get(`sf_${i}`) ?? "");
    if (fd.has(`sf_${i}`) && sf !== String(fd.get(`osf_${i}`) ?? "")) patch.shipFrom = sf === "self" || sf === "prep" ? sf : null;
    const ws = String(fd.get(`ws_${i}`) ?? "");
    if (fd.has(`ws_${i}`) && ws !== String(fd.get(`ows_${i}`) ?? "")) {
      const v = parseWsMax(ws);
      if (v !== undefined) patch.wsMax = v;
    }
    if (!Object.keys(patch).length) continue;
    await saveSkuShipping(session.tenantId, sku, patch);
    saved++;
  }
  revalidatePath("/auftraege/lieferschein");
  return { rows: await refreshed(session.tenantId, rows), labels: prev?.labels, unclear: bad.length || undefined, note: [saved ? `${saved} Artikel gespeichert – gilt ab jetzt für jede Sendung dieser Artikel.` : "Keine Änderung.", bad.length ? `Nicht verstanden: ${bad.join(", ")} (z. B. 0,3 für 0,3 kg oder 300 g)` : ""].filter(Boolean).join(" ") };
}

/** Offene Aufträge übernehmen (vorher neu abrufen) – gleiche Automatik wie beim Lieferschein. */
async function openOrders(fd: FormData): Promise<SlipState> {
  const session = await requireArea("wawi");
  const ch = String(fd.get("channel") ?? "ebay");
  const channel = ch === "amazon" || ch === "alle" ? ch : "ebay";
  try {
    const { rows, note } = await readOpenOrders(session.tenantId, channel, fd.get("refresh") === "on");
    revalidatePath("/auftraege");
    if (fd.get("direkt") !== "on" || !rows.length) return { rows, note };
    const labels = await createSlipLabels(session.tenantId, rows.filter((r) => !r.done && r.choice !== "pruefen").map((r) => ({ orderId: r.orderId, choice: r.choice, shipper: r.shipper })));
    revalidatePath("/auftraege", "layout");
    return { rows: await refreshed(session.tenantId, rows), note, labels };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Zeilen nach dem Erstellen frisch aus der Datenbank (Status „Label schon erstellt“), Lesehinweise bleiben. */
async function refreshed(tenantId: string, rows: SlipRow[]): Promise<SlipRow[]> {
  const out: SlipRow[] = [];
  for (const r of rows) {
    const fresh = await slipRow(tenantId, r.orderId);
    if (fresh) out.push({ ...fresh, warnings: [...new Set([...r.warnings, ...fresh.warnings])] });
  }
  return out;
}

/** Lieferschein hochladen: Aufträge anlegen/zuordnen, Versandart vorschlagen – optional gleich alle Labels erstellen. */
async function readSlipFile(fd: FormData): Promise<SlipState> {
  const session = await requireArea("wawi");
  const file = fd.get("pdf");
  if (!(file instanceof File) || file.size === 0) return { rows: [], error: "Bitte den Amazon-Lieferschein (PDF) auswählen." };
  if (file.size > MAX_BYTES) return { rows: [], error: "Die Datei ist zu groß (höchstens 20 MB)." };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return { rows: [], error: "Das ist kein PDF – bitte den Lieferschein als PDF speichern und hochladen." };
  try {
    const { rows, unreadable } = await readSlip(session.tenantId, buf);
    revalidatePath("/auftraege");
    const note = unreadable ? `${unreadable} Bestellung(en) konnten nicht zugeordnet werden.` : undefined;
    if (fd.get("direkt") !== "on" || session.readOnly) return { rows, note };
    // Ein Schritt: alles, was eindeutig ist, sofort erstellen; „prüfen“ bleibt stehen.
    const labels = await createSlipLabels(session.tenantId, rows.filter((r) => !r.done && r.choice !== "pruefen").map((r) => ({ orderId: r.orderId, choice: r.choice, shipper: r.shipper })));
    revalidatePath("/auftraege", "layout");
    return { rows: await refreshed(session.tenantId, rows), note, labels };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Labels für die Vorschau erstellen – Versandart je Zeile wie ausgewählt. */
async function createSlip(prev: SlipState, fd: FormData): Promise<SlipState> {
  const session = await requireArea("wawi");
  const rows = prev?.rows ?? [];
  if (session.readOnly) return { rows, error: "Nur ansehen – Labels kann dieses Konto nicht kaufen." };
  const ids = fd.getAll("orderId").map(String).filter((s) => z.string().uuid().safeParse(s).success);
  const picks = ids.map((orderId) => {
    const c = String(fd.get(`choice_${orderId}`) ?? "");
    const sh = String(fd.get(`shipper_${orderId}`) ?? "");
    return { orderId, choice: (CHOICES as readonly string[]).includes(c) ? (c as ShipChoice) : "pruefen", ...(sh === "self" || sh === "prep" ? { shipper: sh as "self" | "prep" } : {}) };
  });
  if (!picks.some((p) => p.choice !== "pruefen")) return { rows, error: "Keine Sendung ausgewählt." };
  const mode = fd.get("postMode");
  try {
    const labels = await createSlipLabels(session.tenantId, picks, mode === "api" || mode === "csv" ? mode : undefined);
    revalidatePath("/auftraege", "layout");
    return { rows: await refreshed(session.tenantId, rows), labels };
  } catch (e) {
    return { rows, error: e instanceof Error ? e.message : String(e) };
  }
}
