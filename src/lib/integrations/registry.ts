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
    provider: "dhl_tracking",
    name: "DHL Sendungsverfolgung (Paletten-Sendungen)",
    purpose: "Sendungen im Palettenlager mit DHL (Paket, Express, Freight) automatisch verfolgen: Ort, neuer Liefertag, Zustellung – mit Meldung an alle.",
    fields: [{ key: "apiKey", label: "API-Key (developer.dhl.com)", secret: true }],
    setup: [
      "developer.dhl.com → App öffnen (oder neu anlegen) → API „Shipment Tracking – Unified“ hinzufügen → API-Key kopieren. Ist es dieselbe App wie für den DHL-Versand, ist es auch derselbe Key.",
      "Hier eintragen und „Verbindung testen“.",
      "Danach fragt das System für offene DHL-Sendungen im Palettenlager etwa alle 3 Stunden den Stand ab.",
    ],
  },
  {
    provider: "deutschepost",
    name: "Deutsche Post INTERNETMARKE (Warensendung)",
    purpose: "Porto mit Anschrift kaufen – z. B. Warensendung für Lieferscheine mit einem Stück. Bezahlt wird aus der Portokasse.",
    fields: [
      { key: "clientId", label: "Client-ID / API-Key (developer.dhl.com)", secret: true },
      { key: "clientSecret", label: "Client-Secret", secret: true },
      { key: "username", label: "Portokasse – E-Mail" },
      { key: "password", label: "Portokasse – Passwort", secret: true },
    ],
    setup: [
      "developer.dhl.com → App anlegen → API „Deutsche Post INTERNETMARKE (Post & Parcel Germany)“ hinzufügen und freischalten lassen (Formular deutschepost.de/formular-ima) → Client-ID (API-Key) und Client-Secret kopieren.",
      "Portokasse (portokasse.deutschepost.de) mit Guthaben; dort unter „Meine Daten → Geschäftsanwendungen“ die Anwendung freigeben – sonst lehnt die Post die Anmeldung ab.",
      "Hier eintragen und „Verbindung testen“ – angezeigt wird das Guthaben der Portokasse.",
      "Produkt, Preis und Druckformat unter Einstellungen → Versand (Vorgabe: Warensendung 290, 2,70 €).",
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
    purpose: "Bestellungen mit Lieferadresse alle 5 Minuten abholen und nach dem Versand die Sendungsnummer an Temu melden. Für lokale Shops im Seller Center (seller-eu.temu.com).",
    fields: [
      {
        key: "region",
        label: "Region",
        options: [
          { value: "auto", label: "Automatisch erkennen (Europa zuerst)" },
          { value: "eu", label: "Europa (Deutschland, EU, UK)" },
          { value: "us", label: "USA" },
          { value: "global", label: "Andere Länder (global)" },
        ],
      },
      { key: "appKey", label: "App-Key" },
      { key: "appSecret", label: "App-Secret", secret: true },
      { key: "accessToken", label: "Access-Token", secret: true, help: "Aus dem Seller Center (Open Platform → Client-Verwaltung). Läuft nach einiger Zeit ab – das Datum zeigt „Verbindung testen“, rechtzeitig vorher kommt eine Aufgabe." },
    ],
    setup: [
      "partner-eu.temu.com → Konto als „Self-developed applications seller“ anlegen → Seller-Center-Hauptkonto verknüpfen („You are a local seller“).",
      "App-Angaben ausfüllen. Bei den Schnittstellen angeben: Bestellungen (bg.order.list.v2.get, bg.order.shippinginfo.v2.get, bg.order.decryptshippinginfo.get) und Versand (bg.logistics.companies.get, bg.logistics.shipment.v2.confirm, bg.logistics.warehouse.list.get).",
      "Im Sicherheits-Fragebogen (Frage 5) die öffentliche IP-Adresse deines Servers eintragen – Anfragen von anderen Adressen lehnt Temu ab.",
      "Nach der Freigabe: App-Key und App-Secret aus dem Partner-Portal kopieren. Im Seller Center (seller-eu.temu.com → Open Platform → Client-Verwaltung) die App autorisieren und den Access-Token kopieren.",
      "Hier eintragen, Region auf „Automatisch“ lassen, speichern und „Verbindung testen“. Danach kommen Bestellungen von selbst unter Aufträge; beim Versand (DHL-Label oder „Versendet“) geht die Sendungsnummer an Temu.",
    ],
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
    provider: "lexoffice",
    name: "Lexoffice / Lexware Office (Rechnungen B2B-Deals)",
    purpose: "Vorkasse-Rechnungen und Gutschriften für B2B-Deals im Namen der Deal-Firma (Einstellungen → B2B-Deals), Zahlungseingang zurück ins Seller-System.",
    fields: [{ key: "apiKey", label: "API-Schlüssel", secret: true, help: "Schlüssel der Firma, auf die die Deals laufen (z. B. Wittmann & Grunert GmbH)." }],
    setup: ["In Lexware Office (Lexoffice) → Erweiterungen → „Public API“ → Schlüssel erzeugen und hier eintragen.", "„Verbindung testen“ zeigt den Firmennamen des Kontos – er muss zur Deal-Firma passen."],
  },
  {
    provider: "discord_b2b",
    name: "Discord – B2B-Deal-Kanal",
    purpose: "Neue Deals, „fast weg“ und „geschlossen“ automatisch als Nachricht in den B2B-Kanal der Deal-Gruppe (mit Link ins Kundenportal).",
    fields: [{ key: "webhookUrl", label: "Webhook-Adresse", secret: true, placeholder: "https://discord.com/api/webhooks/…" }],
    setup: ["Discord → Kanal-Einstellungen → Integrationen → Webhooks → Neuer Webhook → „Webhook-URL kopieren“ und hier eintragen."],
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
    provider: "discord_calls",
    name: "Discord – Call-Kanal (Consultant-Calls) – optional",
    purpose: "Einmal pro Woche neue Google-Docs-Transkripte aus dem Discord-Kanal ins Call-Archiv holen; die KI zieht daraus Vereinbarungen, Aufgaben, Entscheidungen und offene Fragen.",
    fields: [
      { key: "botToken", label: "Bot-Token", secret: true, help: "Discord-Bot mit dem Recht „Nachrichtenverlauf lesen“ in diesem Kanal." },
      { key: "kanalId", label: "Kanal-ID", placeholder: "z. B. 123456789012345678", help: "Discord → Einstellungen → Erweitert → Entwicklermodus an → Rechtsklick auf den Kanal → „Kanal-ID kopieren“." },
    ],
    setup: [
      "discord.com/developers → New Application → Bot → „Reset Token“ → Token kopieren und hier eintragen.",
      "OAuth2 → URL Generator: „bot“ mit „View Channels“ und „Read Message History“ → Bot auf den Server einladen.",
      "Die Google Docs müssen für „Jeder mit dem Link“ lesbar sein – oder die Drive-Anbindung mit Dienstkonto hat Zugriff.",
    ],
  },
  {
    provider: "lugru_deals",
    name: "Lugru Deals (Shop-Monitor) – optional",
    purpose:
      "Lugru Deals holt sich hier das eBay-Zugangstoken für Deals, die auf eBay verkauft werden. Die eBay-Schlüssel bleiben im Seller-System; Lugru Deals bekommt nur ein kurzlebiges Token.",
    fields: [
      {
        key: "schluessel",
        label: "Verbindungsschlüssel",
        secret: true,
        placeholder: "mindestens 32 zufällige Zeichen",
        help: "Frei wählen, z. B. aus einem Passwort-Generator. Denselben Schlüssel in Lugru Deals unter Monitor → Einstellungen → eBay eintragen.",
      },
    ],
    setup: [
      "Die eBay-Anbindung (Client ID und Client Secret) muss im Seller-System eingerichtet sein.",
      "Hier einen zufälligen Verbindungsschlüssel mit mindestens 32 Zeichen eintragen und „Verbindung testen“.",
      "In Lugru Deals unter Monitor → Einstellungen → eBay die Adresse dieses Seller-Systems und denselben Schlüssel eintragen.",
    ],
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
