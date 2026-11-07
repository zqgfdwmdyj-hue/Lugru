"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { parseAmount } from "@/lib/numbers";
import { dateiHochladen, type UploadErgebnis } from "@/lib/uploads/service";

export type UploadState = { ergebnisse: UploadErgebnis[] } | null;

/** Zentrale Uploads: alle Dateien nacheinander erkennen und verarbeiten. */
export async function hochladenAction(_prev: UploadState, fd: FormData): Promise<UploadState> {
  const session = await requireSession();
  const dateien = fd.getAll("dateien").filter((f): f is File => f instanceof File && f.size > 0);
  if (!dateien.length) return { ergebnisse: [{ datei: "–", art: null, artText: "–", ok: false, text: "Bitte mindestens eine Datei auswählen.", hinweise: [], link: null }] };
  const o = { firma: String(fd.get("firma") ?? "") || null, saldo: parseAmount(fd.get("saldo")), bqoolTage: fd.get("bqool_tage") === "30" ? (30 as const) : (7 as const) };
  // B31.5: Daily Sales zuletzt – das Land wird über die Listing-Performance-Summen derselben Sendung erkannt.
  const reihe = [...dateien].sort((a, b) => Number(/daily.?sales/i.test(a.name)) - Number(/daily.?sales/i.test(b.name)));
  const ergebnisse: UploadErgebnis[] = [];
  for (const f of reihe) ergebnisse.push(...(await dateiHochladen(session, f.name, new Uint8Array(await f.arrayBuffer()), o)));
  revalidatePath("/", "layout");
  return { ergebnisse };
}

export type LandState = { ok: boolean; text: string; link: string | null } | null;

/** B31.5 Rückfrage „Welches Land?“ bei einem BQool-Bericht beantworten. */
export async function berichtLandAction(_prev: LandState, fd: FormData): Promise<LandState> {
  const session = await requireSession();
  if (session.readOnly) return { ok: false, text: "Nur-ansehen-Konto – nicht möglich.", link: null };
  const { canAccess } = await import("@/lib/auth/areas");
  if (!canAccess(session, "buchhaltung")) return { ok: false, text: "Kein Zugriff auf diesen Bereich.", link: null };
  const land = String(fd.get("land") ?? "");
  const { istBerichtLand } = await import("@/lib/bqool/berichte-logic");
  if (!istBerichtLand(land)) return { ok: false, text: "Bitte ein Land wählen.", link: null };
  const { bqoolBerichtLandSetzen } = await import("@/lib/bqool/berichte");
  const r = await bqoolBerichtLandSetzen(session.tenantId, String(fd.get("id") ?? ""), land);
  revalidatePath("/repricer/leistung");
  return { ok: r.ok, text: r.text, link: r.ok ? `/repricer/leistung?land=${land}` : null };
}
