import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";

// Kurze Verfahrensdokumentation (GoBD) – wie Belege ins System kommen, geprüft, zugeordnet, gebucht und archiviert werden.
export default async function VerfahrenPage() {
  const session = await requireArea("geld");
  const s = (await getSettings(session.tenantId)).buchhaltung;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/buchhaltung">Buchhaltung</Link></div>
          <h1>Verfahrensdokumentation</h1>
          <div className="small muted">Kurzfassung für Steuerberater und Betriebsprüfung. Stand: aktuelle Version des Seller-Systems.</div>
        </div>
      </div>
      <article className="card card-pad article-body" style={{ whiteSpace: "normal" }}>
        <h3>1. Geltungsbereich</h3>
        <p>Buchhaltung der Firmen {s.firmen.join(" und ")} (je Firma getrennt, Feld „Firma“). Nicht enthalten: AdelPrep / Wittmann &amp; Grunert GmbH (eigene Buchhaltung in Lexoffice). Kontenrahmen {s.kontenrahmen}.</p>
        <h3>2. Belegeingang</h3>
        <p>Belege kommen aus Google Drive, den verbundenen Postfächern, per Upload oder Handy-Scan. Jede Datei wird unverändert und verschlüsselt gespeichert (mit Prüfsumme SHA-256). Die KI liest Lieferant, Rechnungsnummer, Datum, Beträge und Belegart aus; unsichere Werte und mögliche Doppelte (gleiche Nummer + Lieferant + Betrag oder gleiche Datei) werden zur Prüfung markiert, nichts wird automatisch gelöscht.</p>
        <h3>3. Kontoauszüge</h3>
        <p>Sparkasse (CSV-CAMT) und American Express (CSV) werden hochgeladen. Jeder Umsatz erhält einen eindeutigen Schlüssel aus Datum, Betrag, Text und Referenz – ein erneuter Upload erzeugt keine Doppelten. Je Upload werden Zeitraum, Summe sowie Anfangs- und Endsaldo festgehalten (Saldo-Kontrolle).</p>
        <h3>4. Abgleich Zahlung ↔ Beleg</h3>
        <p>Regeln in fester Reihenfolge: Rechnungsnummer im Verwendungszweck → Betrag + Lieferant/IBAN (±3 Tage, Teilzahlungen) → Betrag + Datum ±5 Tage. Sonderfälle: Amex-Sammelabbuchung (= Summe der Kartenumsätze des Zeitraums), Amazon-/eBay-Auszahlungen (mit Abrechnungsbericht), Bankentgelte. Sichere Zuordnungen werden automatisch übernommen, alle anderen von einer Person bestätigt oder abgelehnt.</p>
        <h3>5. Vorkontierung und Festschreibung</h3>
        <p>Das System schlägt Konto, Steuerschlüssel und Gegenkonto vor (Regeln je Lieferant, aus Bestätigungen gelernt). Nach Bestätigung wird der Monat festgeschrieben: festgeschriebene Buchungen sind in der Datenbank gegen Ändern und Löschen gesperrt; Korrekturen nur durch Storno-Buchung.</p>
        <h3>6. Protokoll</h3>
        <p>Jede Änderung (Upload, Zuordnung, Buchung, Festschreibung, Export, gelernte Regel) wird mit Person und Zeit protokolliert. Das Protokoll kann nicht geändert oder gelöscht werden (Datenbank-Sperre).</p>
        <h3>7. Export und Aufbewahrung</h3>
        <p>Export je Monat als DATEV-Buchungsstapel bzw. CSV + ZIP der Belege. Belege und Buchungen werden 10 Jahre aufbewahrt; Löschen erst nach Ablauf der Fristen.</p>
        <h3>8. Zuständigkeiten</h3>
        <p>Bestätigen, Festschreiben und Export: Inhaber bzw. Personen mit Bereich „Geld“. Belege anfordern: Assistenz über Aufgaben (ohne Kontozugang). Steuerliche Bewertung: Steuerberater – das System gibt nur Vorschläge.</p>
      </article>
    </>
  );
}
