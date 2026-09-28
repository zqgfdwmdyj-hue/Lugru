// Welche Anbindungen es gibt, welche Felder sie brauchen und wie man sie einrichtet.

export type IntegrationField = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  multiline?: boolean;
};

export type IntegrationDef = {
  provider: string;
  name: string;
  purpose: string;
  fields: IntegrationField[];
  setup: string[];
};

export const INTEGRATIONS: IntegrationDef[] = [
  {
    provider: "amazon_sp",
    name: "Amazon Seller Central (SP-API)",
    purpose: "Bestellungen, Reports (Bestand, Ledger, Erstattungen, Retouren, Remissionen, Abrechnungen), Sendungsbestätigung, FBA-Inbound.",
    fields: [
      { key: "clientId", label: "LWA Client-ID", placeholder: "amzn1.application-oa2-client.…" },
      { key: "clientSecret", label: "LWA Client-Secret", secret: true },
      { key: "refreshToken", label: "Refresh-Token", secret: true, placeholder: "Atzr|…" },
      { key: "sellerId", label: "Händler-ID (Merchant Token)", placeholder: "A1B2C3…" },
      { key: "marketplaceIds", label: "Marktplatz-IDs (Komma)", placeholder: "A1PA6795UKMFR9", help: "DE = A1PA6795UKMFR9, FR = A13V1IB3VIYZZH, IT = APJ6JRA9NG5V4, ES = A1RKKUPIHCS9HS" },
    ],
    setup: [
      "Seller Central → Apps und Services → Apps entwickeln → als Entwickler registrieren (Private Developer, nur für das eigene Konto).",
      "Rollen wählen: Bestandsverwaltung, Bestellungen, Preise, Berichte (Amazon Fulfillment), Finanzen, Direkter Versand zum Kunden (für Adressen bei FBM).",
      "Neuen App-Client anlegen (Typ SP-API) → Client-ID und Client-Secret kopieren.",
      "Bei der App auf „Autorisieren“ klicken → Refresh-Token kopieren.",
      "Hier eintragen und „Verbindung testen“.",
    ],
  },
  {
    provider: "dhl",
    name: "DHL Geschäftskunden (Parcel DE Shipping)",
    purpose: "Versandlabels für Paket und Kleinpaket erstellen.",
    fields: [
      { key: "apiKey", label: "API-Key (developer.dhl.com)", secret: true },
      { key: "username", label: "Geschäftskundenportal-Benutzer (System-/API-Benutzer)" },
      { key: "password", label: "Passwort", secret: true },
    ],
    setup: [
      "developer.dhl.com → App anlegen → API „Parcel DE Shipping (Post & Parcel Germany)“ hinzufügen → API-Key kopieren.",
      "Im DHL Geschäftskundenportal einen System-Benutzer für die API anlegen.",
      "Abrechnungsnummern (EKP + Verfahren + Teilnahme) unter Einstellungen → Versand eintragen.",
      "Zum Testen in den Einstellungen „Sandbox“ aktiv lassen.",
    ],
  },
  {
    provider: "google",
    name: "Google (Gmail-Postfächer)",
    purpose: "Gmail- und Google-Workspace-Postfächer lesen (nur lesend).",
    fields: [
      { key: "clientId", label: "OAuth Client-ID" },
      { key: "clientSecret", label: "OAuth Client-Secret", secret: true },
    ],
    setup: [
      "console.cloud.google.com → Projekt anlegen → „Gmail API“ aktivieren.",
      "OAuth-Zustimmungsbildschirm: Typ „Extern“, dich als Testnutzer eintragen, danach auf „In Produktion“ stellen (sonst laufen Logins nach 7 Tagen ab).",
      "Anmeldedaten → OAuth-Client-ID (Webanwendung) → Weiterleitungs-URI: <deine Adresse>/api/oauth/google/callback",
      "Client-ID und -Secret hier eintragen, dann unter Posteingang Postfächer verbinden.",
    ],
  },
  {
    provider: "microsoft",
    name: "Microsoft (Outlook-Postfächer)",
    purpose: "Outlook.com- und Microsoft-365-Postfächer lesen (nur lesend).",
    fields: [
      { key: "clientId", label: "Anwendungs-ID (Client-ID)" },
      { key: "clientSecret", label: "Geheimer Clientschlüssel", secret: true },
    ],
    setup: [
      "portal.azure.com → App-Registrierungen → Neue Registrierung → Kontotypen: „Konten in allen Organisationsverzeichnissen und persönliche Microsoft-Konten“.",
      "Umleitungs-URI (Web): <deine Adresse>/api/oauth/microsoft/callback",
      "API-Berechtigungen: Microsoft Graph → Delegiert → Mail.Read, offline_access, User.Read.",
      "Zertifikate & Geheimnisse → neuer geheimer Clientschlüssel → hier eintragen.",
    ],
  },
  {
    provider: "google_drive",
    name: "Google Drive (Rechnungsordner)",
    purpose: "Rechnungs-PDFs aus dem Ordner lesen, in den Invoice Fetcher exportiert – einfach über den Freigabelink.",
    fields: [
      { key: "folderLink", label: "Ordner-Link", placeholder: "https://drive.google.com/drive/folders/…?usp=sharing", help: "Link aus „Freigeben → Link kopieren“. Unterordner werden mitgelesen." },
      { key: "apiKey", label: "Google-API-Schlüssel (optional)", secret: true, help: "Nur nötig, wenn ein Ordner mehr als ca. 50 Dateien direkt enthält." },
      { key: "serviceAccountJson", label: "Service-Account-Schlüssel (JSON, optional)", secret: true, multiline: true, help: "Nur für nicht öffentlich freigegebene Ordner." },
      { key: "folderId", label: "Ordner-ID (nur mit Dienstkonto)", placeholder: "aus der Ordner-URL: …/folders/<ID>" },
    ],
    setup: [
      "In Google Drive beim Ordner „rechnungen“ auf „Freigeben“ → Allgemeiner Zugriff: „Jeder, der über den Link verfügt“ → Rolle „Betrachter“ (Mitbearbeiter ist nicht nötig und erlaubt Fremden das Löschen).",
      "„Link kopieren“ und oben als Ordner-Link einfügen → Speichern → „Verbindung testen“.",
      "Alternative ohne öffentlichen Link: Dienstkonto in console.cloud.google.com anlegen, Ordner für dessen E-Mail freigeben, JSON-Schlüssel und Ordner-ID eintragen.",
    ],
  },
  {
    provider: "tiktok",
    name: "TikTok Shop",
    purpose: "Bestellungen abholen und Sendungsnummer melden (Vorbereitung – bis dahin CSV-Import).",
    fields: [
      { key: "appKey", label: "App-Key" },
      { key: "appSecret", label: "App-Secret", secret: true },
      { key: "accessToken", label: "Access-Token", secret: true },
      { key: "shopCipher", label: "Shop-Cipher" },
    ],
    setup: ["partner.tiktokshop.com → App anlegen und für den eigenen Shop autorisieren. Verfügbarkeit für deutsche Shops vorab prüfen."],
  },
  {
    provider: "temu",
    name: "Temu",
    purpose: "Bestellungen abholen (Vorbereitung – bis dahin CSV-Import).",
    fields: [
      { key: "appKey", label: "App-Key" },
      { key: "appSecret", label: "App-Secret", secret: true },
      { key: "accessToken", label: "Access-Token", secret: true },
    ],
    setup: ["Zugang über das Temu Seller Center / Partner-Programm beantragen. Verfügbarkeit vorab prüfen."],
  },
  {
    provider: "apple_calendar",
    name: "Apple-Kalender (iCloud)",
    purpose: "Fälligkeiten in den Kalender „Seller-System“: Aufgaben, Fristen von Fällen und Ansprüchen, Versand, geplante Zahlungen – und eigene Termine auf der Startseite. Verschieben oder Löschen im Kalender wirkt zurück auf die Aufgaben.",
    fields: [
      { key: "appleId", label: "Apple-ID (E-Mail)", placeholder: "name@icloud.com" },
      { key: "appPassword", label: "App-spezifisches Passwort", secret: true, placeholder: "abcd-efgh-ijkl-mnop" },
      { key: "calendarName", label: "Name des Kalenders für das System", placeholder: "Seller-System", help: "Wird angelegt, wenn es ihn noch nicht gibt." },
      { key: "readCalendars", label: "Eigene Kalender anzeigen (Komma, leer = alle)", placeholder: "Privat, Arbeit" },
      { key: "server", label: "CalDAV-Server (nur wenn nicht iCloud)", placeholder: "https://caldav.icloud.com" },
    ],
    setup: [
      "appleid.apple.com → Anmelden und Sicherheit → App-spezifische Passwörter → „+“ → Name z. B. „Seller-System“ → Passwort kopieren.",
      "Hier Apple-ID und das App-Passwort eintragen (nicht das normale Apple-Passwort) und „Verbindung testen“.",
      "Der Kalender „Seller-System“ erscheint danach auf iPhone, iPad und Mac (Kalender-App → Kalender → iCloud). Abgleich alle 15 Minuten.",
    ],
  },
  {
    provider: "anthropic",
    name: "KI (Claude) – optional",
    purpose: "Fasst bei der Themen-Recherche für die Wissensdatenbank die neuen Artikel zusammen.",
    fields: [
      { key: "apiKey", label: "API-Key", secret: true, placeholder: "sk-ant-…" },
      { key: "model", label: "Modell (optional)", placeholder: "claude-sonnet-5" },
    ],
    setup: ["console.anthropic.com → API Keys → neuen Schlüssel anlegen und hier eintragen."],
  },
];

export const integrationDef = (provider: string) => INTEGRATIONS.find((i) => i.provider === provider);
