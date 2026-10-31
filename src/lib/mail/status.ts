import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { AMAZON_ABSENDER, amazonMailWarnung, FEHLER_ART_TEXT, type MailFehlerArt } from "./ordner";

// Stand der Postfächer für Anbindungen, Posteingang und Claude (anbindungen_status): Art, Ordner, letzter Abruf,
// Fehlerart, letzte Mail von Amazon und die Warnung „7 Tage keine Amazon-Mail“.

const ART = { imap: "IMAP (App-Passwort)", gmail: "Google (OAuth)", outlook: "Microsoft (OAuth)", upload: "Upload" } as const;

export type PostfachStand = {
  id: string;
  adresse: string;
  art: string;
  imap: boolean;
  aktiv: boolean;
  nurAbruf: boolean;
  ordner: string[] | null;
  letzterAbruf: Date | null;
  fehler: string | null;
  fehlerArt: string | null;
  letzteAmazonMail: Date | null;
};

export async function postfachStand(tenantId: string): Promise<{ postfaecher: PostfachStand[]; letzteAmazonMail: Date | null; warnung: string | null; nurImap: boolean }> {
  const M = schema.mailboxes;
  const E = schema.emails;
  const [boxes, amazon] = await Promise.all([
    db.select().from(M).where(eq(M.tenantId, tenantId)).orderBy(M.createdAt),
    db
      .select({ mailboxId: E.mailboxId, letzte: sql<Date>`max(${E.receivedAt})` })
      .from(E)
      .where(and(eq(E.tenantId, tenantId), isNotNull(E.fromAddress), sql`${E.fromAddress} ~* ${AMAZON_ABSENDER.source}`))
      .groupBy(E.mailboxId),
  ]);
  const jeBox = new Map(amazon.map((a) => [a.mailboxId, a.letzte ? new Date(a.letzte) : null]));
  const alle = amazon.map((a) => (a.letzte ? new Date(a.letzte).getTime() : 0)).filter(Boolean);
  const letzteAmazonMail = alle.length ? new Date(Math.max(...alle)) : null;
  const postfaecher = boxes
    .filter((b) => b.provider !== "upload")
    .map((b) => ({
      id: b.id,
      adresse: b.address,
      art: ART[b.provider],
      imap: b.provider === "imap",
      aktiv: b.active,
      nurAbruf: b.nurAbruf,
      ordner: b.ordner?.length ? b.ordner : null,
      letzterAbruf: b.lastSyncAt,
      fehler: b.lastError,
      fehlerArt: b.fehlerArt ? (FEHLER_ART_TEXT[b.fehlerArt as MailFehlerArt] ?? b.fehlerArt) : null,
      letzteAmazonMail: jeBox.get(b.id) ?? null,
    }));
  const aktiv = postfaecher.filter((p) => p.aktiv);
  return { postfaecher, letzteAmazonMail, warnung: amazonMailWarnung({ postfaecher: aktiv.length, letzte: letzteAmazonMail }), nurImap: aktiv.length > 0 && aktiv.every((p) => p.imap) };
}
