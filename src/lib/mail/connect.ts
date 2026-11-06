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

/** Kopfdaten einer Mail vor dem Herunterladen (Vorfilter: bekannt, Newsletter, Marktplatz). */
export type ImapKopf = { messageId: string | null; from: string; subject: string; markt: boolean; gesendet: boolean; kopf: { listUnsubscribe: string | null; listId: string | null; precedence: string | null; autoSubmitted: string | null } };

/** Einzelne Kopfzeilen aus dem Rohtext (mehrzeilig gefaltet) lesen. */
export function kopfZeilen(raw: Buffer | string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const text = (typeof raw === "string" ? raw : raw?.toString("utf8") ?? "").replace(/\r?\n[ \t]+/g, " ");
  for (const z of text.split(/\r?\n/)) {
    const i = z.indexOf(":");
    if (i > 0) out[z.slice(0, i).trim().toLowerCase()] = z.slice(i + 1).trim();
  }
  return out;
}

const istMarkt = (from: string, subject: string) => ABSENDER_FILTER.some((x) => from.toLowerCase().includes(x)) || /deal/i.test(subject);

/** Gesendet-Ordner eines Postfachs (Sonderkennung \\Sent, sonst üblicher Name). Gmail: in „Alle Nachrichten“ enthalten. */
export function gesendetOrdner(liste: { path: string; name: string; specialUse?: string }[]): string | null {
  return (liste.find((b) => b.specialUse === "\\Sent") ?? liste.find((b) => /^(sent|gesendet|gesendete (objekte|elemente)|sent (items|messages))$/i.test(b.name)))?.path ?? null;
}

/**
 * Rohdaten (RFC 822) seit `since`, neueste zuerst, höchstens `max` je Ordner. Ordner: eigene Auswahl, sonst
 * automatisch (Gmail „Alle Nachrichten“, sonst Posteingang + Archiv). Mit `gesendet` zusätzlich der
 * Gesendet-Ordner (bei Gmail nur, wenn „Alle Nachrichten“ nicht dabei ist – dort steckt Gesendetes schon drin).
 * `nurPosteingang`: schneller Abruf nur des Posteingangs (Gmail: weiter „Alle Nachrichten“).
 *
 * Ohne `vorfilter` (alt): nur Marktplätze/Versanddienste und Deal-Weiterleitungen – im Deal-Postfach
 * (`alleAbsender`) alles. Mit `vorfilter` (B32): alle Absender, aber erst nach einem Blick auf die Kopfzeilen –
 * bekannte Mails und Newsletter werden gar nicht erst heruntergeladen.
 */
export async function imapFetchRaw(
  a: Account,
  since: Date,
  o: { max?: number; ordner?: string[] | null; alleAbsender?: boolean; gesendet?: boolean; nurPosteingang?: boolean; vorfilter?: (k: ImapKopf[]) => Promise<boolean[]> } = {},
): Promise<{ id: string; raw: Buffer; ordner: string; gesendet?: boolean }[]> {
  const max = o.max ?? 150;
  const c = imap(a);
  try {
    await c.connect();
  } catch (e) {
    c.close();
    throw fehler(e, "IMAP", a.imapPort);
  }
  const out: { id: string; raw: Buffer; ordner: string; gesendet?: boolean }[] = [];
  try {
    const liste = (await c.list()).map((b) => ({ path: b.path, name: b.name, specialUse: b.specialUse || undefined }));
    const vorhanden = new Set(liste.map((b) => b.path));
    const gmail = /(^|\.)(gmail|googlemail)\.com$/i.test(a.imapHost);
    const basis = o.nurPosteingang && !gmail ? ["INBOX"] : (o.ordner?.length ? o.ordner : standardOrdner(liste, a.imapHost)).filter((p) => p.toUpperCase() === "INBOX" || vorhanden.has(p));
    // Gmail: Gesendetes steckt in „Alle Nachrichten“ – nur wenn die nicht abgerufen wird, „[Gmail]/Gesendet“ dazu.
    const alleNachrichten = liste.find((b) => b.specialUse === "\\All")?.path;
    const sent = o.gesendet && !o.nurPosteingang && !(gmail && alleNachrichten && basis.includes(alleNachrichten)) ? gesendetOrdner(liste) : null;
    const ordner = [...basis.map((p) => ({ p, gesendet: false })), ...(sent && !basis.includes(sent) ? [{ p: sent, gesendet: true }] : [])];
    for (const { p: pfad, gesendet } of ordner) {
      const lock = await c.getMailboxLock(pfad);
      try {
        let uids: number[];
        if (o.vorfilter && !o.alleAbsender) {
          const alle = ((await c.search({ since }, { uid: true })) || []).sort((x, y) => y - x).slice(0, 1000);
          const koepfe: (ImapKopf & { uid: number })[] = [];
          if (alle.length) {
            for await (const m of c.fetch(alle, { uid: true, envelope: true, headers: ["list-unsubscribe", "list-id", "precedence", "auto-submitted"] }, { uid: true })) {
              const h = kopfZeilen(m.headers);
              const from = m.envelope?.from?.[0]?.address ?? "";
              const subject = m.envelope?.subject ?? "";
              koepfe.push({ uid: m.uid, messageId: m.envelope?.messageId ?? null, from, subject, markt: istMarkt(from, subject), gesendet, kopf: { listUnsubscribe: h["list-unsubscribe"] ?? null, listId: h["list-id"] ?? null, precedence: h["precedence"] ?? null, autoSubmitted: h["auto-submitted"] ?? null } });
            }
          }
          koepfe.sort((x, y) => y.uid - x.uid);
          const behalten = koepfe.length ? await o.vorfilter(koepfe) : [];
          uids = koepfe.filter((_, i) => behalten[i]).map((k) => k.uid).slice(0, max);
        } else {
          const filter = o.alleAbsender || gesendet ? { since } : { since, or: [...ABSENDER_FILTER.map((from) => ({ from })), { subject: "deal" }] };
          uids = ((await c.search(filter, { uid: true })) || []).sort((x, y) => y - x).slice(0, max);
        }
        if (uids.length > 0) {
          for await (const m of c.fetch(uids, { uid: true, source: true }, { uid: true })) {
            if (m.source) out.push({ id: `imap:${pfad}:${m.uid}`, raw: m.source, ordner: pfad, ...(gesendet ? { gesendet: true } : {}) });
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
    const sent = gesendetOrdner((await c.list()).map((b) => ({ path: b.path, name: b.name, specialUse: b.specialUse || undefined })));
    if (sent) await c.append(sent, raw, ["\\Seen"]);
    await c.logout();
  } catch {
    c.close(); // Ablage unter „Gesendet“ ist nur ein Komfort – der Versand hat geklappt.
  }
}
