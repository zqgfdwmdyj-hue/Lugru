"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { createSlipLabels, readSlip, slipRow, type SlipLabels, type SlipRow } from "@/lib/shipping/slip-service";
import type { ShipChoice } from "@/lib/shipping/packing-slip";

export type SlipState = { rows: SlipRow[]; error?: string; note?: string; labels?: SlipLabels } | null;

const CHOICES = ["warensendung", "dhl", "pruefen"] as const;
const MAX_BYTES = 20 * 1024 * 1024;

/** Ein Formular-Ablauf: „create“ erstellt Labels für die Vorschau, sonst wird ein Lieferschein eingelesen. */
export async function slipAction(prev: SlipState, fd: FormData): Promise<SlipState> {
  return fd.get("intent") === "create" ? createSlip(prev, fd) : readSlipFile(fd);
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
    const labels = await createSlipLabels(session.tenantId, rows.filter((r) => !r.done && r.choice !== "pruefen").map((r) => ({ orderId: r.orderId, choice: r.choice })));
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
    return { orderId, choice: (CHOICES as readonly string[]).includes(c) ? (c as ShipChoice) : "pruefen" };
  });
  if (!picks.some((p) => p.choice !== "pruefen")) return { rows, error: "Keine Sendung ausgewählt." };
  try {
    const labels = await createSlipLabels(session.tenantId, picks);
    revalidatePath("/auftraege", "layout");
    return { rows: await refreshed(session.tenantId, rows), labels };
  } catch (e) {
    return { rows, error: e instanceof Error ? e.message : String(e) };
  }
}
