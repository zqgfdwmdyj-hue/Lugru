import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { sendMail } from "@/lib/mail/accounts";
import { getSettings } from "@/lib/settings";
import { ladeDeal, portalLink } from "./service";

// Benachrichtigung neuer Deals an Kunden mit Portal-Zugang: alle Deals oder nur bestimmte Marken/Kategorien.
// Eine Mail je Kunde (keine Sammel-Mail – Kunden sehen sich gegenseitig nicht). Preise stehen nur im Portal.

const K = schema.b2bKunden;
const Z = schema.b2bZugaenge;

export function passtZumAbo(abo: { alle?: boolean; marken?: string[]; kategorien?: string[] }, d: { marke: string | null; kategorie: string | null }): boolean {
  if (abo.alle !== false) return true;
  const gleich = (a: string | null, liste?: string[]) => !!a && (liste ?? []).some((x) => x.trim().toLowerCase() === a.trim().toLowerCase());
  return gleich(d.marke, abo.marken) || gleich(d.kategorie, abo.kategorien);
}

export async function aboMails(tenantId: string, dealId: string): Promise<{ gesendet: number; fehler: number }> {
  const d = await ladeDeal(tenantId, dealId);
  if (!d || d.status !== "aktiv") return { gesendet: 0, fehler: 0 };
  const s = await getSettings(tenantId);
  const kunden = await db
    .select({ id: K.id, firma: K.firma, email: K.email, ansprechpartner: K.ansprechpartner, abo: K.abo })
    .from(K)
    .innerJoin(Z, and(eq(Z.kundeId, K.id), eq(Z.gesperrt, false), isNotNull(Z.passwortHash)))
    .where(and(eq(K.tenantId, tenantId), eq(K.aktiv, true)));
  const absender = s.b2b.firma.handelsname || s.b2b.firma.name || undefined;
  let gesendet = 0;
  let fehler = 0;
  for (const k of kunden) {
    if (!k.email || !passtZumAbo(k.abo, d)) continue;
    try {
      await sendMail(
        tenantId,
        {
          to: k.email,
          subject: `Neuer Deal #${d.nr}: ${d.titel}`.slice(0, 200),
          text: [
            `Hallo${k.ansprechpartner ? ` ${k.ansprechpartner}` : ""},`,
            "",
            `es gibt einen neuen Deal: ${d.titel}${d.marke ? ` (${d.marke})` : ""}.`,
            d.frist ? `Reservieren bis ${d.frist.split("-").reverse().join(".")}.` : "",
            "",
            `Preis, Prognose und Reservierung im Kundenportal: ${portalLink(d.id)}`,
            "",
            "Bitte vor der Reservierung die Markenfreigabe im eigenen Amazon-Konto prüfen. Prognosen ohne Garantie.",
            "",
            "Benachrichtigungen abbestellen oder auf Marken beschränken: im Kundenportal unter „Mein Konto“.",
            absender ? `\n${absender}` : "",
          ]
            .filter((z, i, a) => z !== "" || a[i - 1] !== "")
            .join("\n"),
        },
        { fromName: absender },
      );
      gesendet++;
    } catch (e) {
      fehler++;
      console.error("B2B-Abo-Mail", e instanceof Error ? e.message : e);
    }
  }
  return { gesendet, fehler };
}
