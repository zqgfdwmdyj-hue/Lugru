"use server";

import { requireSession } from "@/lib/auth/session";
import type { ScanErgebnis, ScanZustand } from "@/lib/druck/scanner";

/** Eine Scan-Eingabe verarbeiten (Handscanner = Tastatur + Enter). */
export async function scanAction(zustand: ScanZustand, eingabe: string): Promise<ScanErgebnis> {
  const s = await requireSession();
  const { scanVerarbeiten } = await import("@/lib/druck/scanner");
  try {
    return await scanVerarbeiten(s, zustand, String(eingabe ?? "").slice(0, 120));
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Fehler", zustand, anzeige: { artikel: null } };
  }
}
