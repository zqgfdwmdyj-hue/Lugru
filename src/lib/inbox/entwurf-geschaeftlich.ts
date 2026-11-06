import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "@/lib/settings";
import { entwurfErstellen } from "./persoenlich";
import { anredeAus, antwortBetreff } from "./persoenlich-logic";

// B32 (Abschnitt 3, geschäftlich): Käuferfragen und Lieferanten-Antworten bekommen denselben Ablauf wie persönliche
// Mails – Entwurf an der Mail, Push „Antwort prüfen“. Senden nur nach Prüfung („Geprüft – jetzt senden“); hier darf
// auch die VA senden (mit Bereich Posteingang).

export async function geschaeftsEntwurf(tenantId: string, m: { id: string; fromAddress: string; fromName: string | null; subject: string; text: string; lieferant: string | null }) {
  const D = schema.emailDrafts;
  const [schon] = await db.select({ id: D.id }).from(D).where(and(eq(D.tenantId, tenantId), eq(D.emailId, m.id), isNull(D.sentAt))).limit(1);
  if (schon || !m.fromAddress.includes("@")) return null;
  const settings = await getSettings(tenantId);
  const { senderMailboxes } = await import("@/lib/mail/accounts");
  const { boxes, defaultId } = await senderMailboxes(tenantId);
  const box = boxes.find((b) => b.id === defaultId);
  const [tenant] = await db.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const unterschrift = box?.fromName || tenant?.name || "";
  const e = await entwurfErstellen(tenantId, {
    art: "geschaeftlich",
    von: m.fromAddress,
    name: m.fromName,
    betreff: m.subject,
    text: m.text,
    anrede: anredeAus({ eingang: m.text }),
    termin: null,
    slots: [],
    unterschrift,
    kontext: m.lieferant ? `Antwort eines Lieferanten (${m.lieferant}) auf unsere Anfrage/Bestellung.` : "Frage eines Käufers über den Marktplatz – höflich, lösungsorientiert, keine Zusagen erfinden.",
    ki: settings.posteingang.persoenlich.kiEntwurf !== false,
  });
  const [d] = await db.insert(D).values({ tenantId, emailId: m.id, to: m.fromAddress, subject: antwortBetreff(m.subject), body: e.entwurf, via: "app" }).returning({ id: D.id });
  const { empfaenger, melden } = await import("@/lib/push/service");
  const an = await empfaenger(tenantId, "posteingang");
  const link = `/posteingang/${m.id}#entwurf`;
  await melden(tenantId, an, { titel: `✉️ ${m.lieferant ?? m.fromName ?? "Käuferfrage"}`.slice(0, 120), text: `${e.zusammenfassung.slice(0, 160)} – Antwort prüfen`, link: `/posteingang/${m.id}`, art: "mail_entwurf", aktionen: [{ aktion: "pruefen", titel: "Antwort prüfen", link }] }, { ohneDiscord: true }).catch(() => null);
  return d.id;
}
