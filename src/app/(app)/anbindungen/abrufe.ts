import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { istLimitFehler } from "@/lib/sellerboard/budget-logic";
import { ABGELOESTE_ABRUFE, ABRUF_PLAN, naechsterText } from "@/lib/today/abruf-plan";
import { hinweisAktuell } from "@/lib/today/jobs";

// Hintergrund-Abrufe je Mandant: Zeitplan/Auslöser, letzter und nächster Lauf, aktueller Fehler bzw. Hinweis.
// Gemeinsam für „Anbindungen“ (Intervall je Karte) und „Hintergrund & Importe“ (Tabelle).

export async function abrufListe(tenantId: string) {
  const jobs = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.tenantId, tenantId));
  const jetzt = new Date();
  return (
    jobs
      // B29: „pausiert bis …“ nur, solange die Pause gilt
      .filter((j) => j.name !== "sellerboard: Tageslimit" || hinweisAktuell(j))
      .map((j) => {
        const plan = ABRUF_PLAN[j.name] ?? j.zeitplan ?? undefined;
        const letzter = j.lastOkAt && (!j.lastErrorAt || j.lastOkAt >= j.lastErrorAt) ? j.lastOkAt : (j.lastErrorAt ?? j.lastOkAt);
        const abgeloest = ABGELOESTE_ABRUFE[j.name];
        // B29.2: sellerboard-Tageslimit ist kein Fehler des Abrufs – „übersprungen“, wird nachgeholt
        const limitFehler = j.name.startsWith("sellerboard:") && istLimitFehler(j.lastError);
        const fehlerAktuell = Boolean(j.lastErrorAt && (!j.lastOkAt || j.lastErrorAt > j.lastOkAt));
        const status = hinweisAktuell(j) ?? (limitFehler && fehlerAktuell ? "übersprungen (sellerboard-Tageslimit) – wird nach der Rücksetzung nachgeholt" : null);
        return { name: j.name, plan, letzter, fehler: !abgeloest && !limitFehler && fehlerAktuell ? j.lastError : null, status, naechster: abgeloest ? "–" : naechsterText(plan, letzter, jetzt), abgeloest };
      })
      .sort((a, b) => Number(b.plan?.ausloeser === "live") - Number(a.plan?.ausloeser === "live") || Number(/discord/i.test(b.name)) - Number(/discord/i.test(a.name)) || a.name.localeCompare(b.name))
  );
}

export type AbrufZeile = Awaited<ReturnType<typeof abrufListe>>[number];
