"use server";

import { revalidatePath } from "next/cache";
import { requireArea } from "@/lib/auth/session";
import { BQOOL_MAERKTE, type BqoolMarkt } from "@/lib/bqool/logic";
import { importBqool } from "@/lib/bqool/service";

export type BqoolState = { ok: boolean; message: string; erkannt?: string[] } | null;

/** BQool-Export „Manage Listings“ (CSV/XLSX) einlesen – ersetzt den Stand der enthaltenen Marktplätze. */
export async function importBqoolAction(_prev: BqoolState, fd: FormData): Promise<BqoolState> {
  const session = await requireArea("buchhaltung");
  if (session.readOnly) return { ok: false, message: "Nur ansehen – Einlesen nicht möglich." };
  const file = fd.get("datei");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Bitte die Export-Datei aus BQool wählen." };
  if (file.size > 20_000_000) return { ok: false, message: "Die Datei ist zu groß (höchstens 20 MB)." };
  const m = String(fd.get("markt") ?? "");
  const markt = (BQOOL_MAERKTE as readonly string[]).includes(m) ? (m as BqoolMarkt) : null;
  try {
    const r = await importBqool(session.tenantId, new Uint8Array(await file.arrayBuffer()), file.name, markt);
    if (r.ok) revalidatePath("/repricer");
    return r.ok ? { ok: true, message: r.message, erkannt: r.erkannt } : { ok: false, message: r.message };
  } catch (e) {
    return { ok: false, message: `Datei nicht lesbar: ${e instanceof Error ? e.message : String(e)}` };
  }
}
