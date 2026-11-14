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
  /** Leeres Feld mit einem aus einem anderen Feld abgeleiteten Wert vorbelegen (z. B. eine Adresse je Land aus der DE-Adresse). */
  vorbelegen?: { aus: string; von: string; nach: string };
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
      "Für Abholungen (Versand → Abholung): in derselben App zusätzlich die API „Parcel DE Pickup (Post & Parcel Germany)“ hinzufügen; der Benutzer braucht im Geschäftskundenportal das Recht „Abholung beauftragen“.",
    ],
  },
  {
    provider: "ups",
    name: "UPS (Abholung)",
    purpose: "UPS-Abholungen aus dem Seller-System buchen und stornieren (Versand → Abholung, auch per Claude).",
    fields: [
      { key: "clientId", label: "Client-ID (UPS Developer Portal)" },
      { key: "clientSecret", label: "Client-Secret", secret: true },
      { key: "kontonummer", label: "UPS-Kontonummer (6 Zeichen)", placeholder: "A1B2C3", help: "Gilt für alle Abholorte ohne eigene Kontonummer." },
      { key: "umgebung", label: "Umgebung", options: [{ value: "produktion", label: "Produktion (echte Abholungen)" }, { value: "test", label: "Testumgebung (wwwcie.ups.com)" }] },
    ],
    setup: [
      "developer.ups.com → mit dem UPS-Konto anmelden → „Apps“ → neue App anlegen, Kontonummer zuordnen.",
      "APIs „Authorization (OAuth)“ und „Pickup“ hinzufügen → Client-ID und Client-Secret kopieren.",
      "Hier eintragen (nie im Chat), Umgebung wählen und „Verbindung testen“.",
      "Abholorte (Adresse, Ansprechpartner, Telefon) stehen unter Einstellungen → Abholung.",
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
    name: "Google (Gmail-Postfächer, YouTube)",
    purpose: "Nur nötig für „Mit Google anmelden“ (Postfächer – einfacher geht es mit App-Passwort unter Posteingang → Postfach verbinden) und für den privaten YouTube-Upload der Video-Pipeline.",
    fields: [
      { key: "clientId", label: "OAuth Client-ID" },
      { key: "clientSecret", label: "OAuth Client-Secret", secret: true },
    ],
    setup: [
      "console.cloud.google.com → Projekt anlegen → „Gmail API“ aktivieren.",
      "OAuth-Zustimmungsbildschirm: bei Google Workspace Typ „Intern“ (dann keine Prüfung nötig), sonst „Extern“ mit dir als Testnutzer und danach „In Produktion“ (sonst laufen Logins nach 7 Tagen ab).",
      "Anmeldedaten → OAuth-Client-ID (Webanwendung) → autorisierte Weiterleitungs-URI: http://localhost (und, falls die App über https erreichbar ist, zusätzlich <deine Adresse>/api/oauth/google/callback).",
      "Client-ID und -Secret hier eintragen, dann unter Posteingang → Postfach verbinden → „Mit Google anmelden“ (Link einfügen wie bei eBay).",
      "YouTube (Video-Pipeline): im selben Projekt „YouTube Data API v3“ aktivieren, beim Zustimmungsbildschirm die Bereiche youtube.upload und youtube.readonly hinzufügen und die Weiterleitungs-URI <deine Adresse>/api/oauth/youtube/callback eintragen. Dann unter Marken & Content → Video beim Kanal „Mit YouTube verbinden“. Hochgeladen wird immer privat.",
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
    fields: [{ key: "apiKey", label: "API-Schlüssel", secret: true, help: "Schlüssel der Firma, auf die die Deals laufen." }],
    setup: ["In Lexware Office (Lexoffice) → Erweiterungen → „Public API“ → Schlüssel erzeugen und hier eintragen.", "„Verbindung testen“ zeigt den Firmennamen des Kontos – er muss zur Deal-Firma passen."],
  },
  {
    provider: "ebrief",
    name: "eBrief (Briefversand)",
    purpose: "B34.3a Briefe an Händler drucken und verschicken lassen – nur nach Freigabe je Charge, Testmodus zuerst. Vorschlag als erster Anbieter (noch zu bestätigen).",
    fields: [
      { key: "username", label: "API-Benutzername" },
      { key: "password", label: "API-Passwort", secret: true, help: "Zugang zur eBrief-REST-API (vom eBrief-Support)." },
    ],
    setup: ["Bei eBrief einen API-Zugang anfragen (Benutzername/Passwort für die REST-API).", "Hier eintragen → „Verbindung testen“.", "AV-Vertrag mit eBrief abschließen und unter Abverkauf → Einstellungen bestätigen – sonst nur Testmodus.", "Preise je Brief unter Abverkauf → Einstellungen eintragen (für Kostenvorschau und Budget)."],
  },
  {
    provider: "letterxpress",
    name: "LetterXpress (Briefversand)",
    purpose: "B34.3a Briefe an Händler drucken und verschicken lassen – nur nach Freigabe je Charge. Testmodus = Warenkorb (nichts gedruckt).",
    fields: [
      { key: "username", label: "Benutzername" },
      { key: "apiKey", label: "API-Schlüssel", secret: true, help: "Im LetterXpress-Konto unter API." },
    ],
    setup: ["Im LetterXpress-Konto den API-Schlüssel anzeigen und hier mit dem Benutzernamen eintragen → „Verbindung testen“.", "AV-Vertrag abschließen und unter Abverkauf → Einstellungen bestätigen – sonst nur Testmodus."],
  },
  {
    provider: "apify",
    name: "Apify (Lead-Quellen, Stufe 2)",
    purpose: "B35 automatische Firmensuche über Apify-Läufe (z. B. Branchen-Einträge, Marktplatz-Verkäufer) mit Budget je Lauf/Monat – erst nach rechtlicher Prüfung, nie Versand. Nutzungsbedingungen der Quelle beachten.",
    fields: [{ key: "token", label: "API-Token", secret: true, help: "Apify Console → Settings → Integrations → API token." }],
    setup: ["API-Token in der Apify Console erzeugen und hier eintragen → „Verbindung testen“.", "In Apify selbst ein Monatslimit setzen; im Seller-System unter B2B → Leads → Quellen Budget je Lauf und Monat eintragen."],
  },
  {
    provider: "google_places",
    name: "Google Places (Lead-Quellen, Stufe 2)",
    purpose: "B35 Firmen nach Branche und Umkreis über die Places-Text-Suche (kein Auslesen der Google-Ergebnisseite) – erst nach rechtlicher Prüfung, mit Budget. Speicherregeln der Google-Nutzungsbedingungen bei der Prüfung klären.",
    fields: [{ key: "apiKey", label: "API-Schlüssel", secret: true, help: "Google Cloud Console → APIs & Dienste → Anmeldedaten (Places API (New) aktivieren, Schlüssel einschränken)." }],
    setup: ["Places API (New) aktivieren, API-Schlüssel anlegen und auf diese API beschränken, hier eintragen.", "Preis je Abruf und Budget unter B2B → Leads → Quellen eintragen."],
  },
  {
    provider: "epost",
    name: "Deutsche Post E-POST (Briefversand, vorbereitet)",
    purpose: "B34.3a dritter Anbieter – Schnittstelle vorbereitet, noch nicht angebunden. Bis dahin Sammel-PDF oder eBrief/LetterXpress.",
    fields: [
      { key: "username", label: "Benutzername" },
      { key: "password", label: "Passwort", secret: true },
    ],
    setup: ["Noch nicht angebunden – Zugangsdaten können schon hinterlegt werden."],
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
    provider: "sellerboard_web",
    name: "sellerboard – Anmeldung für den Kostenimport (Browser-Automatik) – optional",
    purpose: "EK nach dem EK-Import auf Knopfdruck zu sellerboard übertragen (Produkte → Kosten importieren). Ohne diese Anbindung: Importdatei herunterladen und selbst hochladen.",
    fields: [
      { key: "email", label: "Anmelde-E-Mail" },
      { key: "password", label: "Passwort", secret: true },
      { key: "loginUrl", label: "Anmeldeseite", placeholder: "https://app.sellerboard.com/de/auth/login" },
      { key: "importUrl", label: "Seite „Kosten importieren“", help: "In sellerboard die Seite zum Kostenimport öffnen und die Adresse aus der Adresszeile hier einfügen." },
      { key: "feldEmail", label: "Feld E-Mail (nur wenn die Automatik es nicht findet)", placeholder: "z. B. #login-email", help: "CSS-Selektor aus dem Browser: Anmeldeseite öffnen → Rechtsklick auf das Feld → Untersuchen → id bzw. name, z. B. #email oder input[name=login]. Wird zuerst probiert." },
      { key: "feldPasswort", label: "Feld Passwort (optional)", placeholder: "z. B. #login-password" },
      { key: "feldKnopf", label: "Anmelde-Knopf (optional)", placeholder: "z. B. button.login-submit" },
    ],
    setup: [
      "Am besten einen eigenen sellerboard-Benutzer ohne Zwei-Faktor-Anmeldung nur für den Import anlegen – mit Zwei-Faktor bricht die Automatik ab und legt eine Aufgabe an.",
      "Die Automatik läuft nur auf Knopfdruck, nie von selbst; jeder Schritt wird mit Bildschirmfoto protokolliert.",
      "Der Browser wird beim Update automatisch auf dem Server mitgebaut (abschalten nur mit MIT_BROWSER=0 in der .env).",
    ],
  },
  {
    provider: "arbitrageone_web",
    name: "ArbitrageOne – Exporte automatisch abholen (Browser-Automatik) – optional",
    purpose: "Jede Nacht um 05:30 die Exporte aus ArbitrageOne holen: Einkäufe, Lagerbestand und sellerboard-COG täglich, Inventory Reimbursement montags, AccountOne COG am 1. – verarbeitet wie ein Datei-Import.",
    fields: [
      { key: "email", label: "Anmelde-E-Mail" },
      { key: "password", label: "Passwort", secret: true },
      { key: "loginUrl", label: "Anmeldeseite", placeholder: "https://app.arbitrageone.de/login" },
      { key: "exportUrl", label: "Export-Seite", placeholder: "https://app.arbitrageone.de/export", help: "In ArbitrageOne „Export“ öffnen und die Adresse aus der Adresszeile hier einfügen." },
      { key: "automatik", label: "Nachtlauf 05:30", options: [{ value: "an", label: "an – jede Nacht fällige Exporte holen" }, { value: "aus", label: "aus – nur über „Jetzt abholen“" }] },
      { key: "sellerboardWeiterreichen", label: "sellerboard-Datei weiterreichen", options: [{ value: "nein", label: "nein – nur EK im Seller-System übernehmen" }, { value: "ja", label: "ja – die sellerboard-Datei von ArbitrageOne unverändert zu sellerboard hochladen" }], help: "„ja“ braucht die Anbindung „sellerboard – Anmeldung für den Kostenimport“." },
      { key: "titelEinkaeufe", label: "Name der Karte „Einkäufe“ (nur wenn anders)", placeholder: "Einkäufe" },
      { key: "titelLagerbestand", label: "Name der Karte „Lagerbestand“ (nur wenn anders)", placeholder: "Lagerbestand" },
      { key: "titelSellerboard", label: "Name der Karte „Sellerboard“ (nur wenn anders)", placeholder: "Sellerboard" },
      { key: "titelReimbursement", label: "Name der Karte „Inventory Reimbursement“ (nur wenn anders)", placeholder: "Inventory Reimbursement" },
      { key: "titelAccountone", label: "Name der Karte „AccountOne COG (NEU)“ (nur wenn anders)", placeholder: "AccountOne COG (NEU)" },
      { key: "feldEmail", label: "Feld E-Mail (nur wenn die Automatik es nicht findet)", placeholder: "z. B. #login-email", help: "CSS-Selektor aus dem Browser: Anmeldeseite öffnen → Rechtsklick auf das Feld → Untersuchen → id bzw. name, z. B. #email oder input[name=login]. Wird zuerst probiert." },
      { key: "feldPasswort", label: "Feld Passwort (optional)", placeholder: "z. B. #login-password" },
      { key: "feldKnopf", label: "Anmelde-Knopf (optional)", placeholder: "z. B. button.login-submit" },
    ],
    setup: [
      "ArbitrageOne hat keine öffentliche Schnittstelle und keine Export-Links mit Token (geprüft 01.11.) – deshalb meldet sich die Automatik an und drückt auf der Export-Seite den Download-Knopf. Exportvorlagen werden nur gelesen, nie verändert.",
      "Am besten ein eigenes ArbitrageOne-Konto nur fürs System ohne Zwei-Faktor-Anmeldung – mit Zwei-Faktor bricht die Automatik ab und legt eine Aufgabe an.",
      "„Verbindung testen“ meldet sich an und sucht auf der Export-Seite jede Karte (lädt nichts herunter).",
      "Gleiche Datei zweimal wird übersprungen (Prüfsumme). Ergebnis je Abruf unter Einstellungen → Hintergrund & Importe – ArbitrageOne; Fehler → Aufgabe.",
      "EK ohne Warnung wird gleich übernommen; EK-Sprünge über 20 % und Platzhalter bleiben als Vorschau zum Prüfen (Aufgabe).",
      "Der Browser wird beim Update automatisch auf dem Server mitgebaut (abschalten nur mit MIT_BROWSER=0 in der .env).",
    ],
  },
  {
    provider: "discord_calls",
    name: "Discord – Call-Kanal (Consultant- oder Gruppen-Calls) – optional",
    purpose: "Transkripte aus dem Discord-Call-Kanal sofort beim Hochladen ins Call-Archiv holen (Datei .txt/.md/.vtt/.srt/.json/.docx/.pdf, langer Text oder Link auf Google Doc, Notion, Fireflies, tl;dv, Otter); die KI zieht daraus Wissen, Aufgaben, Vereinbarungen und offene Fragen, danach kommt ein Push. Sicherheitsnetz täglich 06:00.",
    fields: [
      {
        key: "art",
        label: "Art der Calls",
        options: [
          { value: "gruppe", label: "Wochen-Calls der Deal-Gruppe" },
          { value: "consultant", label: "Calls mit dem Consultant" },
        ],
      },
      { key: "botToken", label: "Bot-Token", secret: true, help: "Discord-Bot mit dem Recht „Nachrichtenverlauf lesen“ in diesem Kanal." },
      { key: "kanalId", label: "Kanal-ID", placeholder: "z. B. 123456789012345678", help: "Discord → Einstellungen → Erweitert → Entwicklermodus an → Rechtsklick auf den Kanal → „Kanal-ID kopieren“." },
    ],
    setup: [
      "discord.com/developers → New Application → Bot → „Reset Token“ → Token kopieren und hier eintragen.",
      "Bot → Privileged Gateway Intents → „Message Content Intent“ einschalten (sonst kann der Bot Nachrichten und Anhänge nicht live lesen).",
      "OAuth2 → URL Generator: „bot“ mit „View Channels“ und „Read Message History“ → Bot auf den Server einladen.",
      "Die Google Docs müssen für „Jeder mit dem Link“ lesbar sein – oder die Drive-Anbindung mit Dienstkonto hat Zugriff.",
    ],
  },
  {
    provider: "discord_va",
    name: "Discord – VA-Kanal (Assistenz) – optional",
    purpose:
      "Aufgaben an die VA gehen als eigener Thread in den VA-Kanal (mit Anleitung und Anhängen); ✅ oder „erledigt“ schließt die Aufgabe, Fragen landen als Rückfrage bei dir. Neue Nachrichten der VA ordnet die KI ein und beantwortet Datenfragen (Rechnungen, Sendungen, Ansprüche, Aufträge, Produkte, Anleitungen) direkt im Thread.",
    fields: [
      { key: "botToken", label: "Bot-Token", secret: true, help: "Nur auf dem Server gespeichert – erscheint nie in der Oberfläche oder in Protokollen." },
      { key: "serverId", label: "Server-ID", placeholder: "z. B. 123456789012345678", help: "Rechtsklick auf den Server → „Server-ID kopieren“ (Entwicklermodus an)." },
      { key: "kanalId", label: "VA-Kanal-ID", placeholder: "z. B. 123456789012345678", help: "Der Bot liest nur diesen Kanal und seine Threads." },
      { key: "vaDiscordId", label: "Discord-Nutzer-ID der VA", placeholder: "z. B. 123456789012345678", help: "Rechtsklick auf die VA → „Benutzer-ID kopieren“. Nur ihre Nachrichten werden verarbeitet." },
      { key: "vaEmail", label: "Konto der VA im Seller-System (E-Mail)", help: "Ihre Bereichsrechte gelten auch für Links und automatische Antworten – ohne Privat-, Finanz- und B2B-Kundendaten." },
    ],
    setup: [
      "discord.com/developers → New Application → Bot → „Reset Token“ → Token kopieren und hier eintragen.",
      "Unter Bot → Privileged Gateway Intents „Message Content Intent“ einschalten (sonst sieht der Bot den Text der VA nicht).",
      "OAuth2 → URL Generator: „bot“ mit View Channels, Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Attach Files → Bot auf den Server einladen.",
      "Den Bot nur im VA-Kanal berechtigen. Aufgaben gibst du über Delegation (Zuständig = VA) oder in Claude mit aufgabe_zuweisen(an=\"va\").",
    ],
  },
  {
    provider: "discord_profitpath",
    name: "Discord – ProfitPath-Deals (Dealwatch, SpySearch, A2A) – optional",
    purpose:
      "Der Bot des Seller-Systems liest die ProfitPath-Kanäle in deinem Discord-Server mit. Jede Meldung landet im Deal-Eingang und wird gegengeprüft (echte Gebühren je Land, eigener Bestand, Kapital-Ampel, Amazon-Anteil, Liquidität). Push nur bei Grün/Gelb; Trefferquote je Modul.",
    fields: [
      { key: "kanalIds", label: "ProfitPath-Kanäle (IDs, mit Komma getrennt)", placeholder: "123456789012345678, 234567890123456789", help: "Je Modul/Alarmgruppe ein Kanal. Rechtsklick auf den Kanal → „Kanal-ID kopieren“." },
      { key: "ppBotId", label: "Nutzer-ID des ProfitPath-Bots", placeholder: "z. B. 123456789012345678", help: "Rechtsklick auf den ProfitPath-Bot → „Benutzer-ID kopieren“. Dann werden nur seine Nachrichten verarbeitet (leer = alle Bot-Nachrichten in den Kanälen)." },
      { key: "serverId", label: "Server-ID (optional)" },
      { key: "botToken", label: "Bot-Token (optional)", secret: true, help: "Leer = derselbe Bot wie beim VA-Kanal. Nur auf dem Server gespeichert." },
    ],
    setup: [
      "Den Bot des Seller-Systems (siehe „Discord – VA-Kanal“) in den Server mit den ProfitPath-Kanälen einladen – in diesen Kanälen „View Channel“ und „Read Message History“; im Developer Portal unter Bot → Privileged Gateway Intents „Message Content Intent“ einschalten.",
      "„Verbindung testen“ liest die letzte ProfitPath-Nachricht je Kanal und zeigt, was erkannt wurde (ASIN, EK).",
      "Fällt der Abruf aus, holt das System verpasste Meldungen der letzten 24 Stunden nach.",
      "Wichtig: Discord-Meldungen kommen aus den Alert-Einstellungen in ProfitPath (je Alarmgruppe ein Kanal), nicht aus Presets/Filtern.",
      "Beim ersten Abgleich merkt sich das System nur den Stand je Kanal; ab dann kommen neue Meldungen in den Deal-Eingang.",
    ],
  },
  {
    provider: "lugru_deals",
    name: "Lugru Deals (Deal-Kanäle in Discord + Shop-Monitor) – optional",
    purpose:
      "Das Seller-System liest die Deal-Kanäle der Lugru-Gruppe in Discord selbst: neue Posts in 1–2 Minuten in den Deal-Eingang (Ampel, Deal-Wert, Push bei Grün/Gelb), die ganze History einmalig rückwärts, Reaktionen (✅ gekauft, ❌ weg) nur als Anzahl – nie Namen. Läuft auf dem Server, unabhängig davon, ob der PC mit Lugru Deals an ist. Optional: Lugru Deals holt sich hier außerdem das eBay-Zugangstoken.",
    fields: [
      { key: "kanalIds", label: "Deal-Kanäle (Kanal-IDs)", multiline: true, placeholder: "123456789012345678\n234567890123456789", help: "Die Discord-Kanäle, in die Lugru Deals postet (je Zeile eine ID; Rechtsklick auf den Kanal → „Kanal-ID kopieren“, Entwicklermodus an)." },
      { key: "botToken", label: "Bot-Token (optional)", secret: true, help: "Leer = derselbe Bot wie bei „Discord-Kanäle der Deal-Gruppe“ bzw. „VA-Kanal“. Geht auch: der Reaktions-Bot aus Lugru Deals (er ist schon im Server). Nur „View Channel“ und „Read Message History“, „Message Content Intent“ an." },
      { key: "emojiGekauft", label: "Weitere Emojis für „gekauft“ (optional)", placeholder: "lugru_gekauft", help: "✅ zählt immer; eigene Server-Emojis mit Namen ergänzen (mit Komma getrennt)." },
      { key: "emojiWeg", label: "Weitere Emojis für „nicht mehr verfügbar“ (optional)", placeholder: "weg", help: "❌ zählt immer." },
      {
        key: "schluessel",
        label: "Verbindungsschlüssel für Lugru Deals (optional)",
        secret: true,
        placeholder: "mindestens 32 zufällige Zeichen",
        help: "Nur für das eBay-Token und die Übertragung aus Lugru Deals (Weg A, ergänzend). Denselben Schlüssel in Lugru Deals unter Monitor → Einstellungen → eBay eintragen.",
      },
    ],
    setup: [
      "Den Bot in den Discord-Server der Deal-Gruppe einladen (Server-Admin) und in den Deal-Kanälen „View Channel“ + „Read Message History“ geben; im Developer Portal unter Bot → Privileged Gateway Intents „Message Content Intent“ einschalten.",
      "Die IDs der Deal-Kanäle eintragen und „Verbindung testen“ – der Test zeigt den letzten erkannten Deal je Kanal.",
      "Danach unter Deal-Eingang → Lugru Deals „History importieren“; neue Posts kommen von selbst.",
      "Optional (eBay-Token, Übertragung aus Lugru Deals): Verbindungsschlüssel eintragen und in Lugru Deals unter Monitor → Einstellungen → eBay Adresse und Schlüssel hinterlegen.",
    ],
  },
  {
    provider: "asana",
    name: "Asana (Anwalt) – nur lesen",
    purpose: "Fälle beim Anwalt (Status, Fristen, Kommentare) als Rechtsfälle im Seller-System – geschäftliche unter „Rechtsfälle“, private nur im Privatbereich. Es wird nie etwas in Asana geschrieben.",
    fields: [
      { key: "token", label: "Persönlicher Zugangstoken", secret: true, help: "Nur auf dem Server gespeichert." },
      { key: "projekte", label: "Projekte (gids, optional)", placeholder: "leer = alle sichtbaren Projekte", help: "Mit Komma getrennt. Private Projekte unter Einstellungen → Rechtsfälle kennzeichnen." },
    ],
    setup: [
      "Einladung des Anwalts in Asana annehmen.",
      "Asana → Profilbild → Einstellungen → Apps → Entwickler-Apps → „Persönlichen Zugangstoken erstellen“ → hier eintragen.",
      "„Verbindung testen“ zeigt, wie viele Projekte sichtbar sind. Abruf alle 30 Minuten.",
    ],
  },
  {
    provider: "discord_wissen",
    name: "Discord – Gruppen-Kanäle (Wissen) – optional",
    purpose: "Liest freigegebene Kanäle der Deal-Gruppe (nur lesen): Zusammenfassung je Kanal, Insider-Wissen, Frühwarnung bei gehäuften Problemen, Deals in den Deal-Eingang. Rohnachrichten höchstens 30 Tage.",
    fields: [
      { key: "kanaele", label: "Kanäle", multiline: true, placeholder: "123456789012345678 | Amazon | täglich\n234567890123456789 | Temu | wöchentlich", help: "Je Zeile: Kanal-ID | Name | täglich / wöchentlich / aus. (Grauer Text ist nur ein Beispiel.) Kanal-ID: Discord → Einstellungen → Erweitert → Entwicklermodus an, dann Rechtsklick auf den Kanal → „Kanal-ID kopieren“." },
      { key: "serverId", label: "Server-ID (für Links zur Nachricht)" },
      { key: "botToken", label: "Bot-Token (optional)", secret: true, help: "Leer = derselbe Bot wie beim VA-Kanal. Nur der Server-Admin lädt ihn ein; nur „View Channel“ und „Read Message History“ – keine Schreibrechte." },
    ],
    setup: [
      "Noch kein Bot? discord.com/developers → „New Application“ → „Bot“ → Token kopieren und hier eintragen (oder leer lassen, wenn der VA-Kanal schon einen Bot hat). Dort „Message Content Intent“ einschalten.",
      "Einladung: OAuth2 → URL Generator → Scope „bot“, Rechte nur „View Channels“ und „Read Message History“ → den Link dem Server-Admin der Deal-Gruppe schicken. Keine Nutzer-Tokens (Selfbots) – das verstößt gegen die Discord-Regeln.",
      "Die Gruppe informieren, z. B.: „Ich lasse unsere Kanäle Amazon/eBay/Fragen von einem Lese-Bot zusammenfassen – nur für mich, Rohtexte werden nach 30 Tagen gelöscht.“",
      "Kanal-IDs hier eintragen (je Zeile „ID | Name | täglich“), speichern und „Verbindung testen“ – zeigt je Kanal, ob er lesbar ist.",
    ],
  },
  {
    provider: "tesla",
    name: "Tesla (Fleet API) – optional",
    purpose: "Navi-Ziel aus dem Seller-System ins Auto („Ins Auto“), Ankunftszeit für Verspätungs-Entwürfe, Fahrten fürs Fahrtenbuch, Vorheizen nur auf Knopfdruck. Kein Laden, keine Fernsteuerung sonst.",
    fields: [
      { key: "accessToken", label: "Access-Token", secret: true, help: "Nur auf dem Server gespeichert – nie in der Oberfläche oder in Protokollen." },
      { key: "refreshToken", label: "Refresh-Token", secret: true },
      { key: "clientId", label: "Client-ID (Tesla-Entwicklerkonto)" },
      { key: "clientSecret", label: "Client-Secret", secret: true },
      { key: "vin", label: "Fahrgestellnummer (VIN)", placeholder: "z. B. XP7Y…" },
      { key: "region", label: "Region", options: [{ value: "eu", label: "Europa" }, { value: "na", label: "Nordamerika" }] },
      { key: "befehlsProxy", label: "Befehls-Proxy (optional)", placeholder: "https://…", help: "Adresse des „Tesla Vehicle Command Proxy“ – neuere Fahrzeuge (z. B. Model Y Juniper) nehmen Befehle nur signiert an." },
      { key: "publicKey", label: "Öffentlicher Schlüssel (PEM)", multiline: true, placeholder: "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----", help: "Wird unter /.well-known/appspecific/com.tesla.3p.public-key.pem veröffentlicht (verlangt Tesla bei der App-Registrierung). Nur den öffentlichen Teil eintragen – den privaten Schlüssel nie hier." },
    ],
    setup: [
      "developer.tesla.com → Anwendung registrieren (Fleet API), Scopes: Fahrzeuginformationen, Fahrzeugstandort, Fahrzeugbefehle (ohne Laden).",
      "Öffentlichen Schlüssel unter https://<deine Adresse>/.well-known/appspecific/com.tesla.3p.public-key.pem bereitstellen und den Schlüssel im Auto koppeln (Tesla-App → Sicherheit).",
      "Für signierte Befehle den „Vehicle Command Proxy“ auf dem Server starten und oben als Befehls-Proxy eintragen.",
      "Token per OAuth holen und hier eintragen, „Verbindung testen“ zeigt den Fahrzeugnamen.",
    ],
  },
  {
    provider: "twilio",
    name: "SMS (Twilio) – optional",
    purpose: "Nur Wichtiges als SMS an deine Nummer (Konto/Angebot deaktiviert, Frist morgen, grüner Deal über Schwelle, VA-Rückfrage) – der Tesla liest sie vor; Antwort per Sprache: VA / SPÄTER / OK / KAUFEN n.",
    fields: [
      { key: "accountSid", label: "Account SID", placeholder: "AC…" },
      { key: "authToken", label: "Auth-Token", secret: true, help: "Prüft auch die Antworten (Signatur)." },
      { key: "absender", label: "Absender-Nummer", placeholder: "+49…" },
    ],
    setup: [
      "twilio.com → Konto (Region Irland/EU wählen) → Nummer mit SMS kaufen → Account SID, Auth-Token und Nummer hier eintragen.",
      "Bei der Nummer unter „Messaging → A message comes in“ den Webhook https://<deine Adresse>/api/sms/antwort (POST) eintragen.",
      "Deine Handynummer und das Tageslimit stehen unter Einstellungen → Handy & Tesla. Keine Kunden- oder Privatdaten in SMS.",
    ],
  },
  {
    provider: "elevenlabs",
    name: "ElevenLabs (Sprache für Videos)",
    purpose: "Sprecherstimme je Szene für die Video-Pipeline (Marken & Content → Video). Der Worker am Arbeits-PC ruft ElevenLabs über das Seller-System auf – der Schlüssel bleibt hier.",
    fields: [{ key: "apiKey", label: "API-Key", secret: true, placeholder: "sk_…" }],
    setup: [
      "elevenlabs.io → Profil → API Keys → neuen Schlüssel anlegen (Berechtigung „Text to Speech“ genügt) und hier eintragen.",
      "Die Stimme (Voice-ID) steht im Kanalprofil unter Marken & Content → Video.",
      "Den Preis je 1000 Zeichen deines Tarifs auf der Seite Video unter „Kosten“ eintragen – dann stimmen die Kosten je Video.",
    ],
  },
  {
    provider: "openai",
    name: "OpenAI (Bilder für Videos)",
    purpose: "Symbolbilder je Szene für die Video-Pipeline (Standard GPT Image 2.5 Flare, 1536×1024, Qualität „medium“; Modell wählbar auf der Seite Video). Getrennt vom ChatGPT-Abo: API-Konto mit Guthaben nötig.",
    fields: [{ key: "apiKey", label: "API-Key", secret: true, placeholder: "sk-…", help: "Nur den Schlüssel selbst einfügen (beginnt mit „sk-“) – keinen Pfad, Befehl oder Text drumherum." }],
    setup: [
      "platform.openai.com → Billing: Guthaben aufladen (getrennt vom ChatGPT-Abo) → API keys → neuen Schlüssel anlegen und hier eintragen.",
      "Danach „Verbindung testen“: zeigt, ob der Schlüssel gilt und welches Bildmodell benutzt wird.",
      "Unter Settings → Limits ein Monatslimit setzen. Den Preis je Bild auf der Seite Video unter „Kosten“ eintragen.",
      "Bildmodell: Seite Video → Modell und Ablage. Fehlt es im Konto (z. B. abgeschaltet), nimmt das System automatisch das nächste.",
      "Lehnt OpenAI ein Bild ab, nimmt der Worker ein ruhiges Ersatzmotiv.",
    ],
  },
  {
    provider: "pixabay",
    name: "Pixabay (Videoclips für Videos) – optional",
    purpose: "Echte, kostenlose Stock-Videoclips zwischen den Bildern für Kanäle im Stil „Vollbild“ (Kanalprofil → „Echte Videoclips“). Erste Clip-Quelle; ist zusätzlich Pexels verbunden, sucht der Worker dort weiter. Der Worker sucht über das Seller-System – der Schlüssel bleibt hier.",
    fields: [{ key: "apiKey", label: "API-Key", secret: true, placeholder: "Schlüssel von pixabay.com/api/docs", help: "Nur den Schlüssel einfügen – nie im Chat." }],
    setup: [
      "pixabay.com → kostenlos registrieren und anmelden → pixabay.com/api/docs/ öffnen → unter „Parameters“ steht bei „key“ dein Schlüssel (grün hinterlegt). Kopieren und hier eintragen.",
      "„Verbindung testen“ macht eine Probesuche.",
      "Grenze: 100 Anfragen pro Minute – je Video werden etwa 20–40 Suchen gebraucht, Suchen werden im Projekt gemerkt.",
      "Die Clips sind frei nutzbar (Pixabay-Inhaltslizenz, keine Namensnennung nötig). Die Filmer werden trotzdem in der YouTube-Beschreibung genannt.",
    ],
  },
  {
    provider: "pexels",
    name: "Pexels (Videoclips für Videos) – optional",
    purpose: "Zweite Quelle für echte, kostenlose Stock-Videoclips (Kanalprofil → „Echte Videoclips“), falls Pixabay nichts Passendes hat. Der Worker sucht über das Seller-System – der Schlüssel bleibt hier.",
    fields: [{ key: "apiKey", label: "API-Key", secret: true, placeholder: "Schlüssel von pexels.com/api", help: "Nur den Schlüssel einfügen – nie im Chat." }],
    setup: [
      "pexels.com → kostenloses Konto anlegen → pexels.com/api → „Your API Key“ anfordern und hier eintragen. Hinweis: Pexels vergibt zeitweise keine neuen Schlüssel – dann reicht Pixabay.",
      "„Verbindung testen“ macht eine Probesuche.",
      "Grenzen: 200 Anfragen pro Stunde, 20.000 pro Monat – je Video werden etwa 20–40 Suchen gebraucht.",
      "Die Clips sind frei nutzbar (Pexels-Lizenz). Die Filmer werden automatisch in der YouTube-Beschreibung genannt.",
    ],
  },
  {
    provider: "instagram",
    name: "Instagram (Stories für Kanäle)",
    purpose: "Automatisches Posten freigegebener Stories (Marken & Content → Video, Instagram-Kanal) über die Instagram-API mit Instagram-Login. Ohne Anbindung entstehen die Stories trotzdem – du postest sie dann von Hand.",
    fields: [
      { key: "appId", label: "Meta-App-ID", placeholder: "Zahl aus developers.facebook.com" },
      { key: "appSecret", label: "App-Secret (Instagram)", secret: true, help: "Nur den Schlüssel einfügen – nie im Chat." },
    ],
    setup: [
      "Voraussetzung: Instagram-Konto als Business-Konto (Profi-Konto). Eine Facebook-Seite ist beim Instagram-Login nicht nötig.",
      "developers.facebook.com → Meine Apps → App erstellen (Business) → Produkt „Instagram“ → „API-Einrichtung mit Instagram-Login“.",
      "Dort „Instagram-App-ID“ und „Instagram-App-Secret“ kopieren und hier eintragen; als Weiterleitungs-URI https://<deine Adresse>/api/oauth/instagram/callback eintragen.",
      "Berechtigungen instagram_business_basic und instagram_business_content_publish – für fremde Konten ist eine App-Prüfung durch Meta nötig (Dauer: Tage bis Wochen). Bis dahin: Stories erzeugen, freigeben, von Hand posten.",
      "Danach im Kanalprofil des Instagram-Kanals „Mit Instagram verbinden“. Der Zugang hält ~60 Tage und wird automatisch verlängert (Warnung 7 Tage vorher).",
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
