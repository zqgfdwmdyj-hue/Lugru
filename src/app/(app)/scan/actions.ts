"use server";

import { requireSession } from "@/lib/auth/session";
import { scanPruefen } from "@/lib/mobil/service";

export type ScanErgebnis = Awaited<ReturnType<typeof scanPruefen>>;
export type ScanState = { ok: true; code: string; preis: number; r: ScanErgebnis } | { ok: false; fehler: string; code?: string; preis?: number } | null;

/** Scan prüfen (Deal-Ampel) – wie deal_pruefen, mit Satz zum Vorlesen. */
export async function scanAction(_prev: ScanState, fd: FormData): Promise<ScanState> {
  const s = await requireSession();
  const code = String(fd.get("code") ?? "").trim();
  const preis = Number(String(fd.get("preis") ?? "").replace(",", "."));
  const menge = Number(fd.get("menge")) || null;
  if (!code) return { ok: false, fehler: "Bitte EAN scannen oder eingeben." };
  if (!(preis > 0)) return { ok: false, fehler: "Bitte den Preis eingeben.", code };
  try {
    return { ok: true, code, preis, r: await scanPruefen(s.tenantId, { ean: code, preis, menge, netto: fd.get("netto") === "on" }) };
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Prüfung fehlgeschlagen.", code, preis };
  }
}
