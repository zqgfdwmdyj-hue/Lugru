"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { applyImport, type ImportStats } from "@/lib/imports/apply";
import { ImportFormatError, parseArbitrageOne, readSheet } from "@/lib/imports/arbitrageone";

export type ImportState = { ok: true; fileName: string; stats: ImportStats } | { ok: false; error: string } | null;

const MAX_BYTES = 15 * 1024 * 1024;

export async function importFile(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Bitte eine Datei auswählen." };
  if (file.size > MAX_BYTES) return { ok: false, error: "Die Datei ist größer als 15 MB." };

  try {
    const parsed = parseArbitrageOne(readSheet(new Uint8Array(await file.arrayBuffer())));
    if (parsed.rows.length === 0) return { ok: false, error: "In der Datei stehen keine Zeilen mit SKU." };
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
    const stats = await applyImport({
      tenantId: session.tenantId,
      userId: session.userId,
      fileName: file.name,
      parsed,
      vatRate: tenant.settings.vatRate,
    });
    revalidatePath("/", "layout");
    return { ok: true, fileName: file.name, stats };
  } catch (e) {
    if (e instanceof ImportFormatError) return { ok: false, error: e.message };
    console.error("Import fehlgeschlagen", e);
    return { ok: false, error: "Die Datei konnte nicht gelesen werden. Ist es ein Export aus Arbitrage One?" };
  }
}
