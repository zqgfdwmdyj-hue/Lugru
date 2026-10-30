import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ParsedMail } from "@/lib/inbox/service";
import { getSettings } from "@/lib/settings";
import { eingangAnlegen, eingangPruefen } from "./service";

// Mail-Weiterleitung in den Deal-Eingang: alles aus dem Deal-Postfach (Einstellung „Mail-Adresse“, als eigenes
// Postfach verbunden) oder Mails mit „#deal“ bzw. „Deal prüfen“ im Betreff (Weiterleitung/Regel im Postfach).
// Text und Anhänge (Bilder, PDF, Tabellen) landen im selben Eingang; Absender = Quelle.

export const istDealBetreff = (betreff: string) => /#deal\b/i.test(betreff) || /^\s*((fwd?|wg|fw|aw|re)\s*:\s*)*deal\s+pr(ü|ue)fen\b/i.test(betreff);

export async function ausMail(tenantId: string, mailboxId: string | null, m: ParsedMail): Promise<"neu" | "doppelt" | null> {
  const s = await getSettings(tenantId);
  const adresse = s.dealEingang.mailAdresse?.trim().toLowerCase();
  let dealPostfach = false;
  if (adresse && mailboxId) {
    const [mb] = await db.select({ address: schema.mailboxes.address }).from(schema.mailboxes).where(and(eq(schema.mailboxes.tenantId, tenantId), eq(schema.mailboxes.id, mailboxId)));
    dealPostfach = mb?.address.trim().toLowerCase() === adresse;
  }
  if (!dealPostfach && !istDealBetreff(m.subject)) return null;
  const text = [m.subject.replace(/#deal\b/gi, "").trim(), m.text].filter(Boolean).join("\n\n");
  const quelle = (m.fromName || m.fromAddress.split("@")[0] || null)?.slice(0, 80) ?? null;
  const r = await eingangAnlegen(tenantId, null, { weg: "mail", text, quelle, quelleRef: `mail:${m.messageKey}`.slice(0, 300), dateien: (m.anhaenge ?? []).map((a) => ({ name: a.name, mime: a.mime, bytes: a.data })) });
  if (r.neu) await eingangPruefen(tenantId, r.id);
  return r.neu ? "neu" : "doppelt";
}
