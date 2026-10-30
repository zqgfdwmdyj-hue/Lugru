// Mailserver-Einstellungen für IMAP/SMTP ermitteln: bekannte Anbieter, Mozilla-Datenbank (ISPDB)
// und MX-Einträge der Domain. Ohne Server-Abhängigkeiten – die Netzabfragen stehen in connect.ts.

import { findAll, parseXml, textOf, type XmlNode } from "@/lib/calendar/xml";
import { mailFehlerText } from "./ordner";

export type ServerSettings = {
  imapHost: string;
  imapPort: number;
  /** true = TLS ab Verbindungsbeginn (993), false = STARTTLS (143). */
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  /** true = TLS ab Verbindungsbeginn (465), false = STARTTLS (587). */
  smtpSecure: boolean;
  /** Anmeldename; meist die E-Mail-Adresse. */
  user: string;
  /** Name des Anbieters für die Anzeige. */
  provider: string;
  /** Hinweis zum Passwort, z. B. dass ein App-Passwort nötig ist. */
  hint?: string;
};

type Preset = Omit<ServerSettings, "user">;

const GOOGLE: Preset = {
  imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true,
  provider: "Google (Gmail / Workspace)",
  hint: "Google verlangt ein App-Passwort: myaccount.google.com → Sicherheit → Bestätigung in zwei Schritten einschalten → App-Passwörter → neues anlegen (16 Zeichen). IMAP muss in Gmail an sein (Einstellungen → Weiterleitung und POP/IMAP).",
};
const MICROSOFT: Preset = {
  imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false,
  provider: "Microsoft (Outlook / Microsoft 365)",
  hint: "Microsoft: App-Kennwort verwenden (mysignins.microsoft.com → Sicherheitsinformationen → Methode hinzufügen → App-Kennwort; geht nur mit Zwei-Faktor-Anmeldung). Hat der Admin IMAP/SMTP mit Passwort abgeschaltet, unter „Erweitert“ mit Microsoft anmelden.",
};
const ICLOUD: Preset = {
  imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecure: false,
  provider: "Apple iCloud",
  hint: "App-spezifisches Passwort nötig: account.apple.com → Anmeldung und Sicherheit → App-spezifische Passwörter.",
};

/** Bekannte Anbieter nach Domain der Adresse. */
const PRESETS: Record<string, Preset> = {
  "gmail.com": GOOGLE,
  "googlemail.com": GOOGLE,
  "outlook.com": MICROSOFT,
  "outlook.de": MICROSOFT,
  "hotmail.com": MICROSOFT,
  "hotmail.de": MICROSOFT,
  "live.com": MICROSOFT,
  "live.de": MICROSOFT,
  "msn.com": MICROSOFT,
  "icloud.com": ICLOUD,
  "me.com": ICLOUD,
  "mac.com": ICLOUD,
  "gmx.de": { imapHost: "imap.gmx.net", imapPort: 993, imapSecure: true, smtpHost: "mail.gmx.net", smtpPort: 465, smtpSecure: true, provider: "GMX", hint: "In den GMX-Einstellungen „POP3/IMAP Abruf“ erlauben." },
  "gmx.net": { imapHost: "imap.gmx.net", imapPort: 993, imapSecure: true, smtpHost: "mail.gmx.net", smtpPort: 465, smtpSecure: true, provider: "GMX", hint: "In den GMX-Einstellungen „POP3/IMAP Abruf“ erlauben." },
  "gmx.at": { imapHost: "imap.gmx.net", imapPort: 993, imapSecure: true, smtpHost: "mail.gmx.net", smtpPort: 465, smtpSecure: true, provider: "GMX", hint: "In den GMX-Einstellungen „POP3/IMAP Abruf“ erlauben." },
  "gmx.ch": { imapHost: "imap.gmx.net", imapPort: 993, imapSecure: true, smtpHost: "mail.gmx.net", smtpPort: 465, smtpSecure: true, provider: "GMX", hint: "In den GMX-Einstellungen „POP3/IMAP Abruf“ erlauben." },
  "gmx.com": { imapHost: "imap.gmx.com", imapPort: 993, imapSecure: true, smtpHost: "mail.gmx.com", smtpPort: 465, smtpSecure: true, provider: "GMX", hint: "In den GMX-Einstellungen „POP3/IMAP Abruf“ erlauben." },
  "web.de": { imapHost: "imap.web.de", imapPort: 993, imapSecure: true, smtpHost: "smtp.web.de", smtpPort: 587, smtpSecure: false, provider: "WEB.DE", hint: "In den WEB.DE-Einstellungen „POP3/IMAP Abruf“ erlauben." },
  "t-online.de": { imapHost: "secureimap.t-online.de", imapPort: 993, imapSecure: true, smtpHost: "securesmtp.t-online.de", smtpPort: 465, smtpSecure: true, provider: "Telekom", hint: "Telekom verlangt ein eigenes E-Mail-Passwort (Kundencenter → E-Mail-Passwort)." },
  "posteo.de": { imapHost: "posteo.de", imapPort: 993, imapSecure: true, smtpHost: "posteo.de", smtpPort: 465, smtpSecure: true, provider: "Posteo" },
  "mailbox.org": { imapHost: "imap.mailbox.org", imapPort: 993, imapSecure: true, smtpHost: "smtp.mailbox.org", smtpPort: 465, smtpSecure: true, provider: "mailbox.org" },
  "yahoo.com": { imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecure: true, provider: "Yahoo", hint: "App-Passwort nötig (Kontosicherheit → App-Passwort generieren)." },
  "yahoo.de": { imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecure: true, provider: "Yahoo", hint: "App-Passwort nötig (Kontosicherheit → App-Passwort generieren)." },
};

/** Eigene Domains: der Mailserver verrät sich über den MX-Eintrag. */
const MX_RULES: [RegExp, Preset][] = [
  [/(^|\.)(google\.com|googlemail\.com)$/i, GOOGLE],
  [/(^|\.)(outlook\.com|protection\.outlook\.com)$/i, MICROSOFT],
  [/(^|\.)icloud\.com$/i, ICLOUD],
  [/(^|\.)(kundenserver\.de|ionos\.(de|com)|1and1\.(de|com)|perfora\.net)$/i, { imapHost: "imap.ionos.de", imapPort: 993, imapSecure: true, smtpHost: "smtp.ionos.de", smtpPort: 465, smtpSecure: true, provider: "IONOS" }],
  [/(^|\.)strato\.(de|com)$/i, { imapHost: "imap.strato.de", imapPort: 993, imapSecure: true, smtpHost: "smtp.strato.de", smtpPort: 465, smtpSecure: true, provider: "STRATO" }],
  [/(^|\.)(all-inkl\.com|kasserver\.com)$/i, { imapHost: "", imapPort: 993, imapSecure: true, smtpHost: "", smtpPort: 465, smtpSecure: true, provider: "ALL-INKL", hint: "Server steht im KAS unter E-Mail (w0…kasserver.com) – bitte unten eintragen." }],
  [/(^|\.)hetzner\.(de|com)$/i, { imapHost: "mail.your-server.de", imapPort: 993, imapSecure: true, smtpHost: "mail.your-server.de", smtpPort: 465, smtpSecure: true, provider: "Hetzner" }],
];

export function domainOf(address: string): string {
  return address.trim().toLowerCase().split("@")[1] ?? "";
}

export function presetForDomain(domain: string): Preset | null {
  return PRESETS[domain.toLowerCase()] ?? null;
}

export function presetForMx(mxHosts: string[]): Preset | null {
  for (const host of mxHosts) {
    const h = host.replace(/\.$/, "");
    for (const [re, p] of MX_RULES) if (re.test(h)) return p;
  }
  return null;
}

const child = (n: XmlNode, name: string) => n.children.find((c) => c.name === name);

/** Liest eine Thunderbird-Autoconfig-Datei (ISPDB oder autoconfig.<domain>). */
export function parseAutoconfig(xml: string, address: string): ServerSettings | null {
  const root = parseXml(xml);
  const [provider] = findAll(root, "emailprovider");
  if (!provider) return null;
  const servers = (type: string, tag: string) =>
    findAll(provider, tag)
      .filter((s) => s.attrs?.type === type)
      .map((s) => ({
        host: textOf(child(s, "hostname")),
        port: Number(textOf(child(s, "port"))),
        socket: textOf(child(s, "sockettype")).toUpperCase(),
        user: textOf(child(s, "username")),
      }))
      .filter((s) => s.host && s.port && (s.socket === "SSL" || s.socket === "STARTTLS"));
  // TLS von Anfang an bevorzugen.
  const pick = <T extends { socket: string }>(list: T[]) => list.find((s) => s.socket === "SSL") ?? list[0];
  const imap = pick(servers("imap", "incomingserver"));
  const smtp = pick(servers("smtp", "outgoingserver"));
  if (!imap || !smtp) return null;
  const [local, domain] = address.trim().split("@");
  const user = (imap.user || "%EMAILADDRESS%").replace("%EMAILADDRESS%", address.trim()).replace("%EMAILLOCALPART%", local).replace("%EMAILDOMAIN%", domain ?? "");
  return {
    imapHost: imap.host,
    imapPort: imap.port,
    imapSecure: imap.socket === "SSL",
    smtpHost: smtp.host,
    smtpPort: smtp.port,
    smtpSecure: smtp.socket === "SSL",
    user,
    provider: textOf(child(provider, "displayname")) || domain || "",
  };
}

/** Fehlermeldungen der Mailserver in verständliches Deutsch übersetzen (Fehlerarten in ordner.ts). */
export function explainMailError(e: unknown, where: "IMAP" | "SMTP", port?: number): string {
  return mailFehlerText(e, where, port);
}
