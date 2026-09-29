import "server-only";
import { resolveMx } from "node:dns/promises";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { domainOf, explainMailError, parseAutoconfig, presetForDomain, presetForMx, type ServerSettings } from "./servers";

// IMAP/SMTP mit Passwort bzw. App-Passwort: Einstellungen ermitteln, prüfen, abrufen, senden.

async function fetchAutoconfig(url: string, address: string): Promise<ServerSettings | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/xml, text/xml" } });
    if (!res.ok) return null;
    return parseAutoconfig(await res.text(), address);
  } catch {
    return null;
  }
}

/** Findet die Server zu einer Adresse: bekannte Anbieter, dann Mozilla-Datenbank, dann MX-Eintrag. */
export async function detectServers(address: string): Promise<ServerSettings | null> {
  const domain = domainOf(address);
  if (!domain) return null;
  const known = presetForDomain(domain);
  if (known) return { ...known, user: address.trim() };

  // Eigene Domain: MX verrät den Anbieter (z. B. Google Workspace).
  const mx = await resolveMx(domain).then((r) => r.sort((a, b) => a.priority - b.priority).map((x) => x.exchange)).catch(() => [] as string[]);
  const byMx = presetForMx(mx);
  if (byMx) return { ...byMx, user: address.trim() };

  // Mozilla-Datenbank (nur die Domain wird abgefragt, nie die Adresse).
  const ispdb = (await fetchAutoconfig(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, address)) ?? (await fetchAutoconfig(`https://autoconfig.${domain}/mail/config-v1.1.xml`, address));
  if (ispdb) return ispdb;
  if (mx[0]) {
    const mxDomain = mx[0].replace(/\.$/, "").split(".").slice(-2).join(".");
    const viaMx = await fetchAutoconfig(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(mxDomain)}`, address);
    if (viaMx) return viaMx;
  }
  return null;
}

export type Account = ServerSettings & { address: string; password: string };

function imap(a: Account) {
  return new ImapFlow({
    host: a.imapHost,
    port: a.imapPort,
    secure: a.imapSecure,
    auth: { user: a.user, pass: a.password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
    tls: process.env.MAIL_ALLOW_SELF_SIGNED === "1" ? { rejectUnauthorized: false } : undefined,
  });
}

function smtp(a: Account) {
  return nodemailer.createTransport({
    host: a.smtpHost,
    port: a.smtpPort,
    secure: a.smtpSecure,
    requireTLS: !a.smtpSecure && process.env.MAIL_ALLOW_PLAIN !== "1",
    auth: { user: a.user, pass: a.password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    tls: process.env.MAIL_ALLOW_SELF_SIGNED === "1" ? { rejectUnauthorized: false } : undefined,
  });
}

/** Prüft Abruf und Versand; wirft mit verständlicher Meldung. */
export async function testAccount(a: Account): Promise<void> {
  const c = imap(a);
  try {
    await c.connect();
    await c.logout();
  } catch (e) {
    c.close();
    throw new Error(explainMailError(e, "IMAP"));
  }
  try {
    await smtp(a).verify();
  } catch (e) {
    throw new Error(explainMailError(e, "SMTP"));
  }
}

/** Rohdaten (RFC 822) der Nachrichten im Posteingang seit `since`, neueste zuerst, höchstens `max`. */
export async function imapFetchRaw(a: Account, since: Date, max = 150): Promise<{ id: string; raw: Buffer }[]> {
  const c = imap(a);
  try {
    await c.connect();
  } catch (e) {
    c.close();
    throw new Error(explainMailError(e, "IMAP"));
  }
  const out: { id: string; raw: Buffer }[] = [];
  try {
    // Google: „Alle Nachrichten“, damit auch archivierte oder per Filter einsortierte Mails ankommen.
    let folder = "INBOX";
    if (/gmail\.com$/i.test(a.imapHost)) {
      const all = (await c.list()).find((b) => b.specialUse === "\\All" || /^(\[gmail\]\/)?(alle nachrichten|all mail)$/i.test(b.path));
      if (all) folder = all.path;
    }
    const lock = await c.getMailboxLock(folder);
    try {
      // Nur Mails von Marktplätzen und Versanddiensten – der Posteingang wertet ohnehin nur diese aus.
      const senders = ["amazon", "ebay", "tiktok", "temu", "kuajing", "dhl"].map((from) => ({ from }));
      const uids = ((await c.search({ since, or: senders }, { uid: true })) || []).sort((x, y) => y - x).slice(0, max);
      if (uids.length > 0) {
        for await (const m of c.fetch(uids, { uid: true, source: true }, { uid: true })) {
          if (m.source) out.push({ id: `imap:${m.uid}`, raw: m.source });
        }
      }
    } finally {
      lock.release();
    }
    await c.logout();
  } catch (e) {
    c.close();
    throw new Error(explainMailError(e, "IMAP"));
  }
  return out;
}

/** Sendet eine fertige Nachricht und legt sie (außer bei Google, das es selbst tut) unter „Gesendet“ ab. */
export async function smtpSend(a: Account, raw: Buffer, envelope: { from: string; to: string[] }): Promise<void> {
  try {
    await smtp(a).sendMail({ envelope, raw });
  } catch (e) {
    throw new Error(explainMailError(e, "SMTP"));
  }
  if (/gmail\.com$/i.test(a.smtpHost)) return;
  const c = imap(a);
  try {
    await c.connect();
    const boxes = await c.list();
    const sent = boxes.find((b) => b.specialUse === "\\Sent") ?? boxes.find((b) => /^(sent|gesendet|gesendete (objekte|elemente)|sent (items|messages))$/i.test(b.name));
    if (sent) await c.append(sent.path, raw, ["\\Seen"]);
    await c.logout();
  } catch {
    c.close(); // Ablage unter „Gesendet“ ist nur ein Komfort – der Versand hat geklappt.
  }
}
