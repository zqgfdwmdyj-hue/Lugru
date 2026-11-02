import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AnleitungFelder } from "@/db/tables/core";

// Anleitungen für Ludwig (B13) im Wissen, Kategorie „Anleitung“ – einmal anlegen, danach nicht überschreiben.

const ANL: { titel: string; a: AnleitungFelder; tags?: string[] }[] = [
  {
    titel: "Kurzbefehl „Tesla verbunden“ (Hotspot, Briefing, Anrufe)",
    a: {
      zweck: "Beim Einsteigen automatisch Hotspot an und das passende Briefing samt Anrufen vorlesen lassen.",
      wann: "Einmal einrichten; läuft dann bei jeder Fahrt.",
      wer: "Ludwig",
      schritte: [
        "Seller-System → Heute → Schnellerfassung (Sprache) → Handy-Schlüssel erzeugen und kopieren.",
        "Kurzbefehle → Automation → „Bluetooth“ → Gerät „Tesla“ → „Bei Verbindung“, „Sofort ausführen“.",
        "Aktion „Persönlicher Hotspot“ → Ein.",
        "Aktion „Inhalte von URL abrufen“: https://<deine Adresse>/api/mobil/fahrt, Header Authorization = Bearer <Schlüssel>.",
        "Optional zuerst „Aus Menü auswählen“: „Briefing?“ Ja/Nein.",
        "Aktion „Wörterbuchwert abrufen“ → Schlüssel „vorlesen“ → Aktion „Text sprechen“.",
        "Anruf erledigt: zweiter Kurzbefehl „Anruf erledigt“ → Diktieren → POST /api/mobil/anruf-erledigt mit JSON {\"text\": Diktat}.",
      ],
      zugaenge: ["Handy-Schlüssel (je Gerät, widerrufbar unter Schnellerfassung)"],
      fehler: ["401: Schlüssel falsch oder widerrufen – neu erzeugen.", "Nichts vorgelesen: im Ergebnis das Feld „vorlesen“ wählen, nicht den ganzen Text."],
      aufgabenTypen: [],
    },
  },
  {
    titel: "Kurzbefehl „Scan“ (Barcode mit Ampel)",
    a: {
      zweck: "Im Laden oder beim Großhändler EAN scannen, Preis sagen, Ampel vorgelesen bekommen.",
      wann: "Beim Einkauf vor Ort.",
      wer: "Ludwig",
      schritte: [
        "Kurzbefehle → „+“ → Aktion „Barcode scannen“.",
        "Aktion „Nach Zahl fragen“ (Preis brutto in €).",
        "Aktion „Inhalte von URL abrufen“: POST https://<deine Adresse>/api/mobil/scan, Header Authorization = Bearer <Schlüssel>, JSON {\"ean\": Barcode, \"preis\": Zahl}.",
        "Aktion „Wörterbuchwert abrufen“ → „vorlesen“ → „Text sprechen“.",
        "Alternativ im Browser: Seller-System → /scan (Kamera, mehrere EANs nacheinander, ohne Netz wird gemerkt).",
      ],
      zugaenge: ["Handy-Schlüssel"],
      fehler: ["Für EANs braucht die Ampel Keepa – sonst ASIN eingeben.", "Gebühren je Land kommen aus der Amazon-Anbindung, sonst Pauschale (Hinweis im Ergebnis)."],
      aufgabenTypen: [],
    },
  },
  {
    titel: "Kurzbefehl „Deal prüfen“ (WhatsApp → Ampel)",
    a: {
      zweck: "Deal aus WhatsApp, Mail oder Browser teilen und nach höchstens einer Minute die Ampel als Mitteilung bekommen – der Deal landet im Deal-Eingang.",
      wann: "Einmal je iPhone einrichten; danach bei jedem Deal über „Teilen“.",
      wer: "Ludwig",
      schritte: [
        "Seller-System → Deal-Eingang → „iPhone-Kurzbefehl & Teilen“ (/deal-eingang/kurzbefehl) → Schlüssel für dieses iPhone erzeugen und kopieren (beginnt mit dk_).",
        "Ist dort ein iCloud-Link hinterlegt: Kurzbefehl laden, Schlüssel eintragen, fertig.",
        "Sonst: Kurzbefehle → „+“ → Name „Deal prüfen“ → Details: „Im Share-Sheet anzeigen“ an, Typen Text, Bilder, PDF, Dateien.",
        "Aktion „Inhalte von URL abrufen“: POST https://<deine Adresse>/api/deal-eingang, Header Authorization = Bearer dk_…, Haupttext Formular, Feld text = Kurzbefehleingabe (bei Bildern/PDF Feld datei).",
        "Aktion „Mitteilung anzeigen“ mit dem Wörterbuchwert „text“ aus der Antwort.",
        "Testen: in WhatsApp Nachricht lange drücken → Teilen → „Deal prüfen“.",
        "Android: Seller-System in Chrome „Zum Startbildschirm hinzufügen“, dann in WhatsApp Teilen → „Seller“.",
      ],
      zugaenge: ["Deal-Eingang-Schlüssel (dk_…, je Gerät, widerrufbar unter Deal-Eingang → iPhone-Kurzbefehl)"],
      fehler: ["401: Schlüssel falsch oder widerrufen – neu erzeugen.", "Mehr als 20 Eingänge in 10 Minuten je Schlüssel werden abgelehnt.", "Keine Mitteilung: im Kurzbefehl den Wert „text“ der Antwort wählen, nicht die ganze Antwort.", "Es wird nie automatisch gekauft – die Ampel ist nur eine Einschätzung."],
      aufgabenTypen: [],
    },
  },
  {
    titel: "Sperrbildschirm-Widget einrichten",
    a: {
      zweck: "Umsatz, Gewinn gestern, FBM mit Frist heute, wichtige ToDos, nächster Termin und grüne Deals auf einen Blick.",
      wann: "Einmal einrichten; aktualisiert sich alle 15–30 Minuten.",
      wer: "Ludwig",
      schritte: [
        "App „Scriptable“ installieren und ein neues Skript anlegen.",
        "Im Skript: Request an https://<deine Adresse>/api/mobil/kurz mit Header Authorization = Bearer <Schlüssel>, JSON laden, Werte in ein ListWidget schreiben (umsatz_heute, nettogewinn_gestern, fbm_frist_heute, wichtige_todos, naechster_termin).",
        "Widget auf dem Sperrbildschirm hinzufügen → Scriptable → Skript wählen.",
      ],
      zugaenge: ["Handy-Schlüssel"],
      fehler: ["401: Schlüssel falsch oder widerrufen.", "Private Termine erscheinen bewusst nur als „Termin außer Haus“."],
      aufgabenTypen: [],
    },
  },
  {
    titel: "SMS-Antwort-Codes (VA / SPÄTER / OK / KAUFEN n)",
    a: {
      zweck: "Wichtige Meldungen kommen als SMS, der Tesla liest sie vor; Antwort per Sprache.",
      wann: "Unterwegs, wenn eine SMS vom Seller-System kommt.",
      wer: "Ludwig",
      schritte: [
        "„VA“ – geht als Aufgabe an die VA (englisch, Discord).",
        "„SPÄTER“ – Aufgabe auf morgen.",
        "„OK“ – gelesen.",
        "„KAUFEN 20“ – legt nur einen Einkaufsentwurf an, bestellt nie.",
        "Alles andere – Aufgabe an dich mit dem Originaltext.",
        "Der Kurz-Code am Ende ([F12]) ordnet die Antwort der Meldung zu.",
      ],
      zugaenge: ["SMS-Anbindung (Twilio) + Nummer unter Einstellungen → Handy & Tesla"],
      fehler: ["Keine SMS in Ruhe- oder Familienzeit – außer rote Konto-Themen.", "Tageslimit erreicht: weitere Meldungen nur im System."],
      aufgabenTypen: [],
    },
  },
  {
    titel: "Kurzbefehl „Kaufen 17“ (Watch/Siri → Warenkorb)",
    tags: ["handy", "watch", "kurzbefehl", "einkauf"],
    a: {
      zweck: "Jeder Kauf-Push trägt eine Deal-Nummer (24 Std. gültig). „Kaufen 17“ an Watch oder iPhone öffnet auf dem iPhone denselben Warenkorb-Link (bzw. die Produktseite) wie der Knopf im Push. Gekauft wird erst, wenn du in der Amazon-App „Jetzt kaufen“ tippst.",
      wann: "Einmal einrichten; danach bei jedem Deal-Push mit Nummer.",
      wer: "Ludwig",
      schritte: [
        "Seller-System → Heute → Schnellerfassung (Sprache) → Handy-Schlüssel erzeugen und kopieren (oder den vorhandenen nehmen).",
        "Kurzbefehle → neuer Kurzbefehl „Kaufen“ → Aktion „Nach Eingabe fragen“ (Zahl, „Welche Deal-Nummer?“).",
        "Aktion „Inhalte von URL abrufen“: https://<deine Adresse>/api/mobil/kaufen, Methode POST, Header Authorization = Bearer <Schlüssel>, JSON {\"nr\": Eingabe}.",
        "Aktion „Wörterbuchwert abrufen“ → Schlüssel „url“ → Aktion „URLs öffnen“ (öffnet die Amazon-App mit dem Warenkorb).",
        "Optional: „Wörterbuchwert abrufen“ → „antwort“ → „Text sprechen“ (z. B. „Deal 17: Warenkorb mit 4 Stück“).",
        "Watch: Kurzbefehl in den Details „Auf Apple Watch anzeigen“ – „Hey Siri, Kaufen“ fragt nach der Nummer und öffnet den Link per Handoff auf dem iPhone.",
        "Ohne Nummer ({}) öffnet der Kurzbefehl den neuesten offenen Deal der letzten 24 Std.",
      ],
      zugaenge: ["Handy-Schlüssel (je Gerät, widerrufbar unter Schnellerfassung)", "Konto mit Freigabe „Deal-Eingang“"],
      fehler: ["„Nummer abgelaufen“: Nummern gelten 24 Std. – Deal im Deal-Eingang öffnen.", "Warenkorb leer: Amazon hat die Adresse geändert – Feld „fallback“ öffnen (Produktseite, Menge selbst wählen) und unter Einstellungen → Shop-Profile Amazon auf „Produktseite“ stellen."],
      aufgabenTypen: [],
    },
  },
  {
    titel: "Handy & Tesla → Apple Watch: Kurzbefehle (Wie läuft's, Was ist dringend, Erledigt …)",
    tags: ["handy", "tesla", "watch", "apple-watch", "kurzbefehl"],
    a: {
      zweck: "Kurzantworten an der Apple Watch per Siri – ohne eigene Watch-App. Jede Antwort hat höchstens 3 Zeilen und 160 Zeichen, „zeige“ fürs Display und „sprich“ zum Vorlesen. Nur „Erledigt“, „Notiz“ und „Bestand“ ändern etwas, alles andere liest nur. In „Wie läuft's“ und „Was ist dringend“ steht nie Privates (private Termine nur als „Termin außer Haus“). Sind die Daten älter als 30 Minuten, steht vorne „Stand 15:12“.",
      wann: "Einmal je iPhone einrichten (die Watch übernimmt die Kurzbefehle).",
      wer: "Ludwig",
      schritte: [
        "Seller-System → Heute → Schnellerfassung (Sprache) → Handy-Schlüssel erzeugen und kopieren (oder den vorhandenen nehmen).",
        "Am einfachsten: EIN Kurzbefehl „Seller“ für alles (Einstellungen → Apple Watch): „Text diktieren“ → „Inhalte von URL abrufen“ https://<deine Adresse>/api/mobil/watch/frage, POST, Header Authorization = Bearer <Schlüssel>, JSON {\"text\": Diktierter Text} → „zeige“ anzeigen, „sprich“ vorlesen. Dann „Hey Siri, Seller“ und frei sprechen („Wie läuft's?“, „Erledigt“, „Bestand Tefal 12 Stück“ …). Auf der Seite „Apple Watch“ lässt sich jede Antwort vorher ausprobieren.",
        "Alternativ je Befehl ein eigener Kurzbefehl, Name = Sprachbefehl: „Wie läuft's“ → /api/mobil/watch/stand · „Was ist dringend“ → /api/mobil/watch/dringend · „Erledigt“ → /api/mobil/watch/erledigt · „Notiz“ → /api/mobil/watch/notiz · „Deal prüfen“ → /api/mobil/watch/deal · „Bestand“ → /api/mobil/watch/bestand · „Auto“ → /api/mobil/watch/tesla.",
        "In jedem Kurzbefehl: Aktion „Inhalte von URL abrufen“: https://<deine Adresse>/api/mobil/watch/<befehl>, Methode POST, Header Authorization = Bearer <Schlüssel>.",
        "Bei „Erledigt“, „Notiz“, „Deal prüfen“ und „Bestand“ davor „Text diktieren“ und im Abruf JSON {\"text\": Diktierter Text} mitschicken (z. B. „VA bitte Rechnung Tefal prüfen“, „B0… für 19,99“, „Tefal 12 Stück“).",
        "Danach „Wörterbuchwert abrufen“ → „zeige“ → „Ergebnis anzeigen“ und „Wörterbuchwert abrufen“ → „sprich“ → „Text vorlesen“.",
        "In den Details jedes Kurzbefehls „Auf Apple Watch anzeigen“ einschalten.",
        "Komplikation: Zifferblatt bearbeiten → Komplikation „Kurzbefehle“ → „Was ist dringend“ (Standard).",
        "Rückfragen: Bei mehreren Treffern nennt die Watch „1 … 2 … 3 …“ – dann „Erledigt“ bzw. „Bestand“ erneut und „Nummer 2“ diktieren (10 Minuten gültig).",
        "„Notiz VA …“ geht als Nachricht an die VA (Englisch). Im Modus „Vorschlag“ wartet sie unter Delegation → VA auf deine Freigabe; „Notiz privat …“ nur auf deinem eigenen Gerät.",
        "Kaufen: Grüne Deal-Pushs tragen „Deal 17“ – „Hey Siri, Kaufen 17“ über den Kurzbefehl „Kaufen“ (eigene Anleitung).",
      ],
      zugaenge: ["Handy-Schlüssel (je Gerät, widerrufbar unter Schnellerfassung)", "Tesla nur, wenn unter Anbindungen verbunden"],
      fehler: [
        "„Keine offene Aufgabe aus den Pushs der letzten 24 Stunden“: „Erledigt“ schließt nur, was per Push gemeldet wurde – sonst im Seller-System abhaken.",
        "Nichts vorgelesen: im Ergebnis das Feld „sprich“ wählen, nicht den ganzen Text.",
        "401: Schlüssel falsch oder widerrufen – neu erzeugen.",
        "Bildschirmfotos der Kurzbefehle-App: nicht automatisch erstellt (kein iPhone im System) – bei Bedarf selbst ergänzen.",
      ],
      aufgabenTypen: [],
    },
  },
  {
    titel: "Payback bei Amazon.de (Stand November 2026)",
    tags: ["einkauf", "payback", "amazon"],
    a: {
      zweck: "Geprüft am 01.11.2026: Eine feste Payback-Verknüpfung im Amazon-Konto gibt es nicht (mehr). Punkte gibt es nur, wenn der Einkauf in der PAYBACK-App bzw. auf payback.de startet und von dort zu Amazon weiterleitet. Laut Payback-Bedingungen sind u. a. Gewerbe- und Großmengenkäufe, Geschenkgutscheine, Bücher/preisgebundene Artikel, Vorbestellungen und Amazon-Mitgliedschaften ausgenommen – für Wiederverkaufs-Einkäufe gibt es daher oft keine Punkte. Bedingungen vor größeren Käufen unter payback.de/shop/amazon prüfen.",
      wann: "Vor privaten bzw. berechtigten Amazon.de-Einkäufen.",
      wer: "Ludwig",
      schritte: [
        "Warenkorb bei Amazon leeren (Artikel, die länger als 24 Std. im Warenkorb liegen, bringen keine Punkte).",
        "PAYBACK-App öffnen → Partner „Amazon“ → „Jetzt einkaufen“ (ggf. Coupons vorher aktivieren).",
        "Im so geöffneten Fenster einkaufen; Cookies auf der Amazon-Seite zulassen, sonst reißt die Zuordnung ab.",
        "Der Warenkorb-Link aus dem Seller-System-Push startet NICHT über Payback – wer Punkte will, startet zuerst die App und sucht den Artikel dann dort.",
        "Gutschrift: etwa zwei Wochen nach Versand, frei verfügbar erst nach Ablauf der Rückgabefrist.",
        "Im Seller-System: Einstellungen → Shop-Profile → „Payback eingerichtet ✅“ setzen, dann entfällt der Hinweis im Push. Die Payback-Nummer wird nirgends gespeichert.",
      ],
      zugaenge: ["PAYBACK-App mit eigenem Konto (nicht im Seller-System)"],
      fehler: ["Keine Punkte: Einkauf nicht über die App gestartet, Warenkorb war nicht leer, oder der Artikel ist ausgenommen.", "Bildschirmfotos: nicht automatisch erstellt (kein Login in fremde Konten) – bei Bedarf selbst ergänzen."],
      aufgabenTypen: [],
    },
  },
];

export async function mobilAnleitungen(tenantId: string): Promise<number> {
  const K = schema.knowledgeEntries;
  let n = 0;
  for (const x of ANL) {
    const [da] = await db.select({ id: K.id }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.title, x.titel)));
    if (da) continue;
    await db.insert(K).values({ tenantId, kind: "anleitung", category: "Anleitung", title: x.titel, body: [x.a.zweck, "", ...x.a.schritte.map((s, i) => `${i + 1}. ${s}`)].join("\n"), tags: x.tags ?? ["handy", "tesla", "kurzbefehl"], origin: "anleitung", anleitung: x.a });
    n++;
  }
  return n;
}
