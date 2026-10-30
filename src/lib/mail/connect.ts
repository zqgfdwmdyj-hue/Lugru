import "server-only";
import { resolveMx } from "node:dns/promises";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { assertOutbound } from "@/lib/testenv";
import { ABSENDER_FILTER, mailFehlerArt, smtpAusweich, standardOrdner, type ImapOrdner, type MailFehlerArt } from "./ordner";
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
  assertOutbound(a.imapHost);
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
  assertOutbound(a.smtpHost);
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

export class MailFehler extends Error {
  constructor(
    msg: string,
    public art: MailFehlerArt,
  ) {
    super(msg);
  }
}

const fehler = (e: unknown, where: "IMAP" | "SMTP", port?: number) => new MailFehler(explainMailError(e, where, port), mailFehlerArt(e));

export type TestErgebnis = {
  /** Ordner/Labels des Postfachs (für die Auswahl). */
  ordner: ImapOrdner[];
  /** SMTP: ok, übersprungen (nur Abruf) oder Fehlermeldung. */
  smtp: { ok: true; port: number; ausweich: boolean } | { ok: false; meldung: string; art: MailFehlerArt } | { ok: null };
  /** Bei geglücktem Ausweichen (465 → 587) die Einstellungen zum Speichern. */
  einstellungen: ServerSettings;
};

async function smtpPruefen(a: Account): Promise<void> {
  await smtp(a).verify();
}

/**
 * Prüft Abruf (IMAP, wirft MailFehler) und – außer bei „nur abrufen“ – Versand. Ist der SMTP-Port gesperrt oder
 * läuft in eine Zeitüberschreitung, wird automatisch 587/STARTTLS (bzw. 465/SSL) versucht.
 */
export async function testAccount(a: Account, o: { nurAbruf?: boolean } = {}): Promise<TestErgebnis> {
  const ordner = await imapOrdnerListe(a);
  const { password: _pw, address: _ad, ...einstellungen } = a;
  if (o.nurAbruf) return { ordner, smtp: { ok: null }, einstellungen };
  try {
    await smtpPruefen(a);
    return { ordner, smtp: { ok: true, port: a.smtpPort, ausweich: false }, einstellungen };
  } catch (e) {
    const art = mailFehlerArt(e);
    const alt = art === "port" || art === "tls" ? smtpAusweich(a.smtpPort, a.smtpSecure) : null;
    if (alt) {
      const b = { ...a, ...alt };
      const ok = await smtpPruefen(b).then(() => true, () => false);
      if (ok) return { ordner, smtp: { ok: true, port: b.smtpPort, ausweich: true }, einstellungen: { ...einstellungen, ...alt } };
    }
    return { ordner, smtp: { ok: false, meldung: explainMailError(e, "SMTP", a.smtpPort), art }, einstellungen };
  }
}

/** Ordner/Labels des Postfachs (IMAP LIST). Wirft MailFehler. */
export async function imapOrdnerListe(a: Account): Promise<ImapOrdner[]> {
  const c = imap(a);
  try {
    await c.connect();
  } catch (e) {
    c.close();
    throw fehler(e, "IMAP", a.imapPort);
  }
  try {
    const liste = (await c.list()).filter((b) => !b.flags?.has("\\Noselect")).map((b) => ({ path: b.path, name: b.name, specialUse: b.specialUse || undefined }));
    await c.logout();
    return liste;
  } catch (e) {
    c.close();
    throw fehler(e, "IMAP", a.imapPort);
  }
}

/**
 * Rohdaten (RFC 822) seit `since`, neueste zuerst, höchstens `max` je Ordner. Ordner: eigene Auswahl, sonst
 * automatisch (Gmail „Alle Nachrichten“, sonst Posteingang + Archiv). Nur Marktplätze/Versanddienste und
 * Deal-Weiterleitungen – im Deal-Postfach (`alleAbsender`) alles.
 */
export async function imapFetchRaw(a: Account, since: Date, o: { max?: number; ordner?: string[] | null; alleAbsender?: boolean } = {}): Promise<{ id: string; raw: Buffer; ordner: string }[]> {
  const max = o.max ?? 150;
  const c = imap(a);
  try {
    await c.connect();
  } catch (e) {
    c.close();
    throw fehler(e, "IMAP", a.imapPort);
  }
  const out: { id: string; raw: Buffer; ordner: string }[] = [];
  try {
    const liste = (await c.list()).map((b) => ({ path: b.path, name: b.name, specialUse: b.specialUse || undefined }));
    const vorhanden = new Set(liste.map((b) => b.path));
    const ordner = (o.ordner?.length ? o.ordner : standardOrdner(liste, a.imapHost)).filter((p) => p.toUpperCase() === "INBOX" || vorhanden.has(p));
    const filter = o.alleAbsender ? { since } : { since, or: [...ABSENDER_FILTER.map((from) => ({ from })), { subject: "deal" }] };
    for (const pfad of ordner) {
      const lock = await c.getMailboxLock(pfad);
      try {
        const uids = ((await c.search(filter, { uid: true })) || []).sort((x, y) => y - x).slice(0, max);
        if (uids.length > 0) {
          for await (const m of c.fetch(uids, { uid: true, source: true }, { uid: true })) {
            if (m.source) out.push({ id: `imap:${pfad}:${m.uid}`, raw: m.source, ordner: pfad });
          }
        }
      } finally {
        lock.release();
      }
    }
    await c.logout();
  } catch (e) {
    c.close();
    throw fehler(e, "IMAP", a.imapPort);
  }
  return out;
}

/** Sendet eine fertige Nachricht und legt sie (außer bei Google, das es selbst tut) unter „Gesendet“ ab. */
export async function smtpSend(a: Account, raw: Buffer, envelope: { from: string; to: string[] }): Promise<void> {
  try {
    await smtp(a).sendMail({ envelope, raw });
  } catch (e) {
    throw fehler(e, "SMTP", a.smtpPort);
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
