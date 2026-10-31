// Reine Logik für IMAP-Postfächer: Ordner-Vorauswahl, Fehlerarten, Empfänger. Ohne Netz – getestet in tests/mail-ordner.test.ts.

export type ImapOrdner = { path: string; name: string; specialUse?: string };

const GMAIL_ALLE = /^(\[(gmail|google mail)\]\/)?(alle nachrichten|all mail)$/i;

/**
 * Vorgabe ohne eigene Auswahl: bei Google „Alle Nachrichten“ (auch archivierte oder per Filter einsortierte Mails),
 * sonst Posteingang plus Archiv-Ordner, falls vorhanden.
 */
export function standardOrdner(liste: ImapOrdner[], host: string): string[] {
  if (/(^|\.)(gmail|googlemail)\.com$/i.test(host)) {
    const alle = liste.find((b) => b.specialUse === "\\All" || GMAIL_ALLE.test(b.path));
    if (alle) return [alle.path];
  }
  const out = ["INBOX"];
  const archiv = liste.find((b) => b.specialUse === "\\Archive") ?? liste.find((b) => /^(archiv|archive|archives)$/i.test(b.name));
  if (archiv && archiv.path.toUpperCase() !== "INBOX") out.push(archiv.path);
  return out;
}

/** Wählbare Ordner: alles außer Entwürfen und Gesendetem (dort kommen keine Amazon-Mails an). */
export const waehlbar = (b: ImapOrdner) => b.specialUse !== "\\Drafts" && b.specialUse !== "\\Sent" && !/^\[(gmail|google mail)\]$/i.test(b.path);

/** Auswahl vom Formular prüfen: nur vorhandene, wählbare Ordner, höchstens 20. */
export function gueltigeOrdner(wahl: string[], liste: ImapOrdner[]): string[] {
  const da = new Map(liste.filter(waehlbar).map((b) => [b.path, b]));
  return [...new Set(wahl)].filter((p) => da.has(p)).slice(0, 20);
}

/** Anzeigename eines Ordners („[Gmail]/Alle Nachrichten“ → „Alle Nachrichten“, INBOX → „Posteingang“). */
export const ordnerName = (path: string) => (path.toUpperCase() === "INBOX" ? "Posteingang" : path.replace(/^\[(gmail|google mail)\]\//i, "").replace(/^INBOX[./]/i, "Posteingang/"));

// ---- Fehlerarten --------------------------------------------------------------------------------

export type MailFehlerArt = "anmeldung" | "imap_aus" | "port" | "server" | "tls" | "sonst";

export const FEHLER_ART_TEXT: Record<MailFehlerArt, string> = {
  anmeldung: "Anmeldung abgelehnt",
  imap_aus: "IMAP beim Anbieter aus",
  port: "Port gesperrt / Zeitüberschreitung",
  server: "Server nicht gefunden",
  tls: "Verschlüsselung passt nicht",
  sonst: "Fehler",
};

type MailErr = { message?: string; code?: string; responseText?: string; response?: string; authenticationFailed?: boolean };

/** Ordnet einen Fehler von IMAP/SMTP ein: Anmeldung, IMAP ausgeschaltet, Port/Zeitüberschreitung, DNS, TLS. */
export function mailFehlerArt(e: unknown): MailFehlerArt {
  const err = (e ?? {}) as MailErr;
  const raw = [err.responseText, err.response, err.message, err.code].filter(Boolean).join(" ");
  if (/not enabled for IMAP|enable (your account for )?IMAP|IMAP[- ](access|zugriff)?\s*(is )?(disabled|deaktiviert|nicht aktiviert|ausgeschaltet|not enabled)|IMAP is disabled|POP3\/IMAP[- ]Abruf/i.test(raw)) return "imap_aus";
  if (err.authenticationFailed || /AUTHENTICATIONFAILED|authenticat|\b53[45]\b|invalid credentials|login failed|LOGIN failed|password|App-?Passwor|application-specific/i.test(raw)) return "anmeldung";
  if (/ENOTFOUND|EAI_AGAIN/.test(raw)) return "server";
  if (/ECONNREFUSED|ETIMEDOUT|ETIMEOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|timed? ?out|Greeting never received|Connection closed unexpectedly/i.test(raw)) return "port";
  if (/certificate|self.signed|\bTLS\b|\bSSL\b|wrong version number/i.test(raw)) return "tls";
  return "sonst";
}

/** Verständliche Meldung je Fehlerart (Wortlaut „Anmeldung abgelehnt“ wird beim Verbinden ausgewertet). */
export function mailFehlerText(e: unknown, where: "IMAP" | "SMTP", port?: number): string {
  const art = mailFehlerArt(e);
  const err = (e ?? {}) as MailErr;
  switch (art) {
    case "anmeldung":
      return `${where}: Anmeldung abgelehnt – E-Mail-Adresse/Passwort prüfen. Google, Microsoft, Apple und Yahoo verlangen ein App-Passwort statt des normalen Passworts.`;
    case "imap_aus":
      return `${where}: IMAP ist beim Anbieter ausgeschaltet – im Postfach „IMAP-Zugriff“ einschalten (Gmail: Einstellungen → Weiterleitung und POP/IMAP; GMX/WEB.DE: „POP3/IMAP Abruf“ erlauben).`;
    case "port":
      return `${where}: Server antwortet nicht${port ? ` auf Port ${port}` : ""} – Port gesperrt (Firewall/Anbieter) oder Zeitüberschreitung.`;
    case "server":
      return `${where}: Server nicht gefunden – Servername prüfen.`;
    case "tls":
      return `${where}: Verschlüsselung passt nicht – SSL/TLS bzw. STARTTLS und Port prüfen.`;
    default:
      return `${where}: ${[err.responseText, err.response, err.message].filter(Boolean).join(" ") || String(e)}`;
  }
}

/** SMTP-Ausweichweg: 465 (SSL) gesperrt → 587 mit STARTTLS (und umgekehrt). */
export function smtpAusweich(port: number, secure: boolean): { smtpPort: number; smtpSecure: boolean } | null {
  if (port === 465 && secure) return { smtpPort: 587, smtpSecure: false };
  if (port === 587 && !secure) return { smtpPort: 465, smtpSecure: true };
  return null;
}

// ---- Empfänger ----------------------------------------------------------------------------------

/** Empfangsadresse einer Mail: Delivered-To/X-Original-To (echtes Postfach bzw. Alias), sonst „An“. */
export function empfaengerAus(zugestellt: (string | undefined | null)[], an: string[]): string | null {
  const z = zugestellt.map((x) => (x ?? "").trim().toLowerCase()).find((x) => /@/.test(x));
  if (z) return z.replace(/^<|>$/g, "").slice(0, 300);
  const liste = [...new Set(an.map((x) => x.trim().toLowerCase()).filter((x) => /@/.test(x)))];
  return liste.length ? liste.join(", ").slice(0, 300) : null;
}

/** IMAP-Suche: Marktplätze und Versanddienste, dazu „Deal prüfen“/„#deal“-Weiterleitungen (Deal-Eingang). */
export const ABSENDER_FILTER = ["amazon", "ebay", "tiktok", "temu", "kuajing", "dhl"];

// ---- Warnung „keine Amazon-Mails“ ----------------------------------------------------------------

export const AMAZON_ABSENDER = /@([a-z0-9-]+\.)*amazon\.[a-z.]+$/i;
export const AMAZON_STILLE_TAGE = 7;

/**
 * Warnung, wenn keine Seller-Central-Mails ankommen: kein Postfach verbunden, oder seit 7 Tagen keine Mail von
 * *@amazon.* (typisch: Gmail-Filter archiviert sie, Benachrichtigungen gehen an eine andere Adresse).
 */
export function amazonMailWarnung(o: { postfaecher: number; letzte: Date | null; jetzt?: Date }): string | null {
  const jetzt = o.jetzt ?? new Date();
  if (o.postfaecher === 0) return "Kein Postfach verbunden – Seller-Central-Mails (Deaktivierungen, Compliance, Fälle) kommen nur per Upload an.";
  if (o.letzte && jetzt.getTime() - o.letzte.getTime() < AMAZON_STILLE_TAGE * 86_400_000) return null;
  return `${o.letzte ? `Seit über ${AMAZON_STILLE_TAGE} Tagen keine` : "Noch keine"} Mail von *@amazon.* – Seller-Central-Mails kommen nicht an. Prüfen: richtige Ordner/Labels gewählt (Gmail-Filter archiviert oft – „Alle Nachrichten“ wählen), gehen die Benachrichtigungen in Seller Central (Einstellungen → Benachrichtigungen) an diese Adresse?`;
}
