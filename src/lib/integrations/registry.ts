// Welche Anbindungen es gibt, welche Felder sie brauchen und wie man sie einrichtet.

export type IntegrationField = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  multiline?: boolean;
  /** Auswahlliste statt Freitext; erster Eintrag = Vorgabe. */
  options?: { value: string; label: string }[];
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
      { key: "publicImageBase", label: "Öffentliche Adresse für Produktbilder (optional)", placeholder: "https://bilder.example.de", help: "Amazon lädt Bilder per Link. Nur nötig, wenn Artikelbilder aus dem Artikelstamm mitgeschickt werden sollen – die Adresse muss aus dem Internet erreichbar sein (sonst Bilder in Seller Central hochladen)." },
    ],
    setup: [
      "Seller Central → Apps und Services → Apps entwickeln → als Entwickler registrieren (Private Developer, nur für das eigene Konto).",
      "Rollen wählen: Produktlisting (für den Artikelstamm), Bestandsverwaltung, Bestellungen, Preise, Berichte (Amazon Fulfillment), Finanzen, Direkter Versand zum Kunden (für Adressen bei FBM).",
      "Neuen App-Client anlegen (Typ SP-API) → Client-ID und Client-Secret kopieren.",
      "Bei der App auf „Autorisieren“ klicken → Refresh-Token kopieren.",
      "Hier eintragen und „Verbindung testen“.",
    ],
  },
  {
    provider: "amazon_sp_2",
    name: "Amazon – zweites Verkäuferkonto (optional)",
    purpose: "Für Marken, die über ein eigenes Verkäuferkonto laufen (z. B. die GmbH einer Marke): Artikel aus dem Artikelstamm dort anlegen. Im Markenprofil „Amazon-Konto: zweites Konto“ wählen.",
    fields: [
      { key: "clientId", label: "LWA Client-ID", placeholder: "amzn1.application-oa2-client.…" },
      { key: "clientSecret", label: "LWA Client-Secret", secret: true },
      { key: "refreshToken", label: "Refresh-Token", secret: true, placeholder: "Atzr|…" },
      { key: "sellerId", label: "Händler-ID (Merchant Token)", placeholder: "A1B2C3…" },
      { key: "marketplaceIds", label: "Marktplatz-IDs (Komma)", placeholder: "A1PA6795UKMFR9", help: "DE = A1PA6795UKMFR9, FR = A13V1IB3VIYZZH, IT = APJ6JRA9NG5V4, ES = A1RKKUPIHCS9HS" },
      { key: "publicImageBase", label: "Öffentliche Adresse für Produktbilder (optional)", placeholder: "https://bilder.example.de", help: "Amazon lädt Bilder per Link. Nur nötig, wenn Artikelbilder aus dem Artikelstamm mitgeschickt werden sollen – die Adresse muss aus dem Internet erreichbar sein (sonst Bilder in Seller Central hochladen)." },
    ],
    setup: [
      "Seller Central → Apps und Services → Apps entwickeln → als Entwickler registrieren (Private Developer, nur für das eigene Konto).",
      "Rollen wählen: Produktlisting (für den Artikelstamm), Bestandsverwaltung, Bestellungen, Preise, Berichte (Amazon Fulfillment), Finanzen, Direkter Versand zum Kunden (für Adressen bei FBM).",
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
    purpose: "Nur nötig für „Mit Google anmelden“ – einfacher geht es mit App-Passwort unter Posteingang → Postfach verbinden.",
    fields: [
      { key: "clientId", label: "OAuth Client-ID" },
      { key: "clientSecret", label: "OAuth Client-Secret", secret: true },
    ],
    setup: [
      "console.cloud.google.com → Projekt anlegen → „Gmail API“ aktivieren.",
      "OAuth-Zustimmungsbildschirm: bei Google Workspace Typ „Intern“ (dann keine Prüfung nötig), sonst „Extern“ mit dir als Testnutzer und danach „In Produktion“ (sonst laufen Logins nach 7 Tagen ab).",
      "Anmeldedaten → OAuth-Client-ID (Webanwendung) → autorisierte Weiterleitungs-URI: http://localhost (und, falls die App über https erreichbar ist, zusätzlich <deine Adresse>/api/oauth/google/callback).",
      "Client-ID und -Secret hier eintragen, dann unter Posteingang → Postfach verbinden → „Mit Google anmelden“ (Link einfügen wie bei eBay).",
    ],
  },
  {
    provider: "microsoft",
    name: "Microsoft (Outlook-Postfächer)",
    purpose: "Outlook.com- und Microsoft-365-Postfächer abrufen und darüber senden („Mit Microsoft anmelden“).",
    fields: [
      { key: "clientId", label: "Anwendungs-ID (Client-ID)" },
      { key: "clientSecret", label: "Geheimer Clientschlüssel", secret: true },
    ],
    setup: [
      "portal.azure.com → App-Registrierungen → Neue Registrierung → Kontotypen: „Konten in allen Organisationsverzeichnissen und persönliche Microsoft-Konten“.",
      "Umleitungs-URI (Web): http://localhost (und bei https-Adresse zusätzlich <deine Adresse>/api/oauth/microsoft/callback).",
      "API-Berechtigungen: Microsoft Graph → Delegiert → Mail.Read, Mail.Send, offline_access, User.Read.",
      "Zertifikate & Geheimnisse → neuer geheimer Clientschlüssel → hier eintragen, dann unter Posteingang → Postfach verbinden.",
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
    name: "Kalender (Apple iCloud, Google, Outlook)",
    purpose: "Fälligkeiten in einen eigenen iCloud-Kalender (verschieben oder löschen wirkt zurück auf die Aufgaben) – und deine eigenen Termine aus iCloud, Google oder Outlook in der Kalenderansicht und auf der Startseite.",
    fields: [
      { key: "appleId", label: "Apple-ID (E-Mail)", placeholder: "name@icloud.com" },
      { key: "appPassword", label: "App-spezifisches Passwort", secret: true, placeholder: "abcd-efgh-ijkl-mnop" },
      { key: "calendarName", label: "Name des Kalenders für das System", placeholder: "Seller-System", help: "Wird in iCloud angelegt, wenn es ihn noch nicht gibt." },
      { key: "readCalendars", label: "Welche iCloud-Kalender anzeigen? (Namen mit Komma, leer = alle)", placeholder: "Privat, Arbeit", help: "Genau die Namen aus der Kalender-App. Leer lassen, um alle zu sehen." },
      {
        key: "icsUrls",
        label: "Weitere Kalender per Link (Google, Outlook …) – einer pro Zeile",
        multiline: true,
        secret: true,
        placeholder: "Familie | https://calendar.google.com/calendar/ical/…/private-…/basic.ics",
        help: "Format: Name | Link (Name optional). Nur lesend. Die Links sind geheim und werden verschlüsselt gespeichert.",
      },
      { key: "server", label: "CalDAV-Server (nur wenn nicht iCloud)", placeholder: "https://caldav.icloud.com" },
    ],
    setup: [
      "iCloud: account.apple.com → Anmelden und Sicherheit → App-spezifische Passwörter → „+“ → Name z. B. „Seller-System“ → Passwort kopieren und oben mit der Apple-ID eintragen.",
      "Google-Kalender (auf dem iPhone z. B. unter einem Gmail-Account): am PC calendar.google.com → links beim Kalender ⋮ → „Einstellungen und Freigabe“ → ganz unten „Privatadresse im iCal-Format“ kopieren → oben unter „Weitere Kalender per Link“ einfügen, z. B. „Familie | https://…“. Für jeden Kalender eine Zeile.",
      "Outlook.com: Einstellungen → Kalender → Freigegebene Kalender → Kalender veröffentlichen → „ICS“-Link kopieren.",
      "Kalender, die nur „Auf meinem iPhone“ liegen, sind von außen nicht lesbar – in der Kalender-App in einen iCloud-Kalender verschieben.",
      "„Verbindung testen“ zeigt, welche Kalender mit wie vielen Terminen gelesen wurden. Abgleich alle 15 Minuten.",
    ],
  },
  {
    provider: "keepa",
    name: "Keepa (Amazon-Marktdaten)",
    purpose: "Für Ideen und Kalkulationen: ähnliche Produkte auf amazon.de mit Preis, FBA-Gebühr, Provision und Verkäufen im Monat. Auch für Amazon-Bilder im eBay-Tool.",
    fields: [{ key: "apiKey", label: "Keepa-API-Schlüssel", secret: true, help: "Leer lassen, wenn er schon im eBay-Tool (Einstellungen → Bildquellen) steht – dann wird der genommen." }],
    setup: ["keepa.com → Anmelden → API (Datenzugriff) buchen → „API Key“ kopieren und hier eintragen, „Verbindung testen“ zeigt die verfügbaren Tokens."],
  },
  {
    provider: "stotax",
    name: "Stotax Select (Steuerberater)",
    purpose: "Jede B2B-Rechnung aus dem System (auch Stornos) geht automatisch als PDF in deine Stotax-Belegablage (über Mail2Select); eBay-Rechnungen nur auf Wunsch, da AccountOne die eBay-Umsätze bucht. Rechnungen schreibst du unter Einkauf & Buchhaltung → Ausgangsrechnungen.",
    fields: [
      { key: "address", label: "Mail2Select-Adresse", placeholder: "deinefirma@mail2select.de", help: "Deine persönliche Adresse aus Stotax Select (endet auf @mail2select.de)." },
      {
        key: "auto",
        label: "Neue Rechnungen",
        options: [
          { value: "ja", label: "Automatisch senden – jede neue Rechnung sofort" },
          { value: "nein", label: "Nur per Knopf unter Ausgangsrechnungen" },
        ],
      },
      {
        key: "scope",
        label: "Welche Rechnungen",
        help: "Vorgabe „Nur B2B“: Die eBay-Umsätze bucht AccountOne über die eBay-Schnittstelle – sonst kämen sie doppelt an. „Alle“ nur, wenn eBay nicht in AccountOne angebunden ist.",
        options: [
          { value: "b2b", label: "Nur B2B-Rechnungen – eBay bucht AccountOne" },
          { value: "alle", label: "Alle Rechnungen – eBay und B2B" },
        ],
      },
    ],
    setup: [
      "In Stotax Select (stotax-select.de) den E-Mail-Service „Mail2Select“ einmalig aktivieren und eine Adresse festlegen – sie endet auf @mail2select.de.",
      "Die Adresse hier eintragen und speichern. Ab dann geht jede neue Rechnung als PDF dorthin; ältere unter WaWi → Ausgangsrechnungen „Nachsenden“.",
      "Gesendet wird über dein Absender-Postfach (Posteingang). Nimmt Stotax nur bestimmte Absender an, diese Adresse dort freigeben.",
      "„Verbindung testen“ prüft Adresse und Postfach – ohne einen Beleg in Stotax anzulegen.",
    ],
  },
  {
    provider: "discord",
    name: "Discord (Meldungen) – optional",
    purpose: "Neue Amazon-ToDos mit hoher Priorität sofort in einen Discord-Kanal melden.",
    fields: [{ key: "webhookUrl", label: "Webhook-URL", secret: true, placeholder: "https://discord.com/api/webhooks/…" }],
    setup: ["Discord → Server-Einstellungen → Integrationen → Webhooks → „Neuer Webhook“ → Kanal wählen (z. B. „todo“) → „Webhook-URL kopieren“ → hier einfügen und testen."],
  },
  {
    provider: "anthropic",
    name: "KI (Claude) – optional",
    purpose: "Stuft Amazon-Systemmails ein, fasst die Themen-Recherche zusammen und schreibt Marken-Ideen, Video-Skripte und Listing-Vorschläge. Ohne Schlüssel arbeiten Mails und Recherche mit festen Regeln.",
    fields: [
      { key: "apiKey", label: "API-Key", secret: true, placeholder: "sk-ant-…" },
      {
        key: "tier",
        label: "Kosten / Qualität",
        options: [
          { value: "ausgewogen", label: "Ausgewogen – Haiku für Mails und Recherche, Sonnet für Ideen und Content (empfohlen)" },
          { value: "sparsam", label: "Sparsam – überall Haiku (am günstigsten)" },
          { value: "qualitaet", label: "Qualität – überall Sonnet" },
        ],
        help: "Haiku kostet etwa die Hälfte von Sonnet und reicht für das Einstufen von Mails völlig. Ideen und Skripte klingen mit Sonnet meist besser.",
      },
      { key: "model", label: "Eigenes Modell (optional)", placeholder: "leer lassen", help: "Nur ausfüllen, wenn ein bestimmtes Modell überall genutzt werden soll (z. B. claude-haiku-4-5) – überschreibt die Auswahl oben." },
    ],
    setup: [
      "console.anthropic.com → API Keys → neuen Schlüssel anlegen und hier eintragen.",
      "Tipp: Unter Settings → Limits ein Monatslimit setzen (z. B. 10 $) – dann kann es nie teurer werden.",
    ],
  },
];

export const integrationDef = (provider: string) => INTEGRATIONS.find((i) => i.provider === provider);
