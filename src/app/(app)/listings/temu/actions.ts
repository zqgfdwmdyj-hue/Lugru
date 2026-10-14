"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { kickTransfers, queueTransfers } from "@/lib/temu/transfer";

export type TransferState = { ok: boolean; message: string } | null;

const pack = z
  .object({ weightG: z.number().optional(), lengthCm: z.number().optional(), widthCm: z.number().optional(), heightCm: z.number().optional() })
  .partial();

const Input = z.object({
  target: z.enum(["temu", "wawi"]),
  factorPercent: z.number(),
  food: z.boolean(),
  pack,
  picks: z
    .array(z.object({ source: z.enum(["attempt", "ebay"]), ref: z.string().min(1).max(40), title: z.string().max(300).optional(), price: z.number().optional(), pack: pack.optional() }))
    .min(1)
    .max(2000),
});

/** Ausgewählte eBay-Angebote zu Temu bzw. in die Wawi – läuft danach im Hintergrund. */
export async function queueTransfersAction(raw: unknown): Promise<TransferState> {
  const session = await requireArea("wawi");
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Bitte mindestens ein Angebot auswählen." };
  const p = parsed.data;
  try {
    const r = await queueTransfers(session.tenantId, p.target, p.picks, { rule: { factor: p.factorPercent / 100, food: p.food }, pack: p.pack });
    revalidatePath("/listings/temu");
    const what = p.target === "temu" ? "zu Temu" : "in die Wawi";
    const parts = [r.queued ? `${r.queued} Angebot(e) ${what} eingereiht – läuft im Hintergrund, der Stand erscheint in der Liste.` : `Nichts eingereiht.`, ...r.problems];
    return { ok: r.queued > 0 && !r.problems.length, message: parts.join(" ") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Fehlgeschlagene noch einmal versuchen. */
export async function retryFailedAction(): Promise<void> {
  const session = await requireArea("wawi");
  const T = schema.ebayTransfers;
  await db.update(T).set({ status: "wartet", message: null, updatedAt: new Date() }).where(and(eq(T.tenantId, session.tenantId), eq(T.status, "fehler")));
  kickTransfers(session.tenantId);
  revalidatePath("/listings/temu");
}
