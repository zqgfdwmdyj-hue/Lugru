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
  const o = { firma: String(fd.get("firma") ?? "") || null, saldo: parseAmount(fd.get("saldo")) };
  const ergebnisse: UploadErgebnis[] = [];
  for (const f of dateien) ergebnisse.push(...(await dateiHochladen(session, f.name, new Uint8Array(await f.arrayBuffer()), o)));
  revalidatePath("/", "layout");
  return { ergebnisse };
}
