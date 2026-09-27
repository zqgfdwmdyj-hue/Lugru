"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { runAfterImport } from "@/lib/hooks";
import { importAnyFile, type FileResult } from "@/lib/imports/dispatch";

export type ImportAllState = { results: FileResult[] } | null;
const MAX_BYTES = 25 * 1024 * 1024;

export async function importFiles(_prev: ImportAllState, formData: FormData): Promise<ImportAllState> {
  const session = await requireSession();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { results: [{ fileName: "–", ok: false, summary: "Bitte mindestens eine Datei auswählen." }] };
  const results: FileResult[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      results.push({ fileName: file.name, ok: false, summary: "Größer als 25 MB." });
      continue;
    }
    try {
      results.push(
        await importAnyFile({
          tenantId: session.tenantId,
          userId: session.userId,
          fileName: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        }),
      );
    } catch (e) {
      console.error("Import fehlgeschlagen", file.name, e);
      results.push({ fileName: file.name, ok: false, summary: "Die Datei konnte nicht verarbeitet werden." });
    }
  }
  if (results.some((r) => r.ok)) await runAfterImport(session.tenantId);
  revalidatePath("/", "layout");
  return { results };
}
