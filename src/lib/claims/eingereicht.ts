import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// „Bei Amazon eingereicht“ – gemeinsam für das Claude-Werkzeug „anspruch_eingereicht“ und das Fall-Paket der
// Retouren-Station: Status, Fallnummer, Zeitpunkt und ein Eintrag im Verlauf des Anspruchs.

const ABGESCHLOSSEN = ["reimbursed", "partial", "rejected", "dismissed"];

export type EingereichtErgebnis =
  | { ok: true; titel: string; fallnummer: string | null; schonEingereicht: boolean }
  | { ok: false; fehler: string };

export async function markiereEingereicht(
  tenantId: string,
  claimId: string,
  o: { fallnummer?: string | null; notiz?: string | null; userId: string | null; via: string },
): Promise<EingereichtErgebnis> {
  const C = schema.claims;
  const [c] = await db.select({ id: C.id, title: C.title, status: C.status, caseId: C.amazonCaseId }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, claimId)));
  if (!c) return { ok: false, fehler: "Anspruch nicht gefunden." };
  if (ABGESCHLOSSEN.includes(c.status)) return { ok: false, fehler: `Der Anspruch „${c.title}“ ist schon abgeschlossen (${c.status}) – nichts geändert.` };
  const caseId = o.fallnummer?.trim() || c.caseId || null;
  const schon = c.status === "submitted";
  await db
    .update(C)
    .set({ status: "submitted", amazonCaseId: caseId, submittedAt: schon ? undefined : new Date(), updatedAt: new Date() })
    .where(and(eq(C.tenantId, tenantId), eq(C.id, c.id)));
  await db.insert(schema.claimEvents).values({ tenantId, claimId: c.id, userId: o.userId, action: `eingereicht${caseId ? ` (Fall ${caseId})` : ""} – über ${o.via}`, note: o.notiz?.trim() || null });
  return { ok: true, titel: c.title, fallnummer: caseId, schonEingereicht: schon };
}
