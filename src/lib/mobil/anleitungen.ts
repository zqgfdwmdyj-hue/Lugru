import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AnleitungFelder } from "@/db/tables/core";

// Anleitungen für Ludwig (B13) im Wissen, Kategorie „Anleitung“ – einmal anlegen, danach nicht überschreiben.

const ANL: { titel: string; a: AnleitungFelder }[] = [
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
];

export async function mobilAnleitungen(tenantId: string): Promise<number> {
  const K = schema.knowledgeEntries;
  let n = 0;
  for (const x of ANL) {
    const [da] = await db.select({ id: K.id }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.title, x.titel)));
    if (da) continue;
    await db.insert(K).values({ tenantId, kind: "anleitung", category: "Anleitung", title: x.titel, body: [x.a.zweck, "", ...x.a.schritte.map((s, i) => `${i + 1}. ${s}`)].join("\n"), tags: ["handy", "tesla", "kurzbefehl"], origin: "anleitung", anleitung: x.a });
    n++;
  }
  return n;
}
