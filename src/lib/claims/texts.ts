import type { ClaimType } from "@/db/schema";

type ClaimLike = {
  type: ClaimType;
  sku: string | null;
  fnsku: string | null;
  asin: string | null;
  quantity: number;
  unitCost: number | null;
  reference: string | null;
  eventDate: string | null;
  evidence: { label: string; value: string }[];
};

const eur = (n: number | null) => (n === null ? "[EK]" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));

/** Vorschlag für den Text, mit dem der Fall bei Amazon eingereicht wird. */
export function claimCaseText(c: ClaimLike): string {
  const item = `SKU ${c.sku ?? "–"}${c.fnsku ? `, FNSKU ${c.fnsku}` : ""}${c.asin ? `, ASIN ${c.asin}` : ""}`;
  const proof = c.evidence.map((e) => `- ${e.label}: ${e.value}`).join("\n");
  const intro = "Guten Tag,\n\n";
  const outro = `\n\nNachweise:\n${proof}\n\nBitte prüfen Sie den Vorgang und erstatten Sie die betroffenen Einheiten.${c.unitCost === null ? "" : ` Eine Rechnung über den Einkaufspreis (${eur(c.unitCost)} netto je Einheit) liegt vor und kann nachgereicht werden.`}\n\nVielen Dank und freundliche Grüße`;
  const date = c.eventDate ? c.eventDate.slice(0, 10).split("-").reverse().join(".") : null;
  const ev = (label: string) => c.evidence.find((e) => e.label === label)?.value ?? "–";
  switch (c.type) {
    case "inbound_shortage":
      return `${intro}in der Sendung ${c.reference ?? "[Sendungs-ID]"} wurden laut unserem Scan-Protokoll mehr Einheiten von ${item} verschickt als eingebucht. Es fehlen ${c.quantity} Einheiten.${outro}`;
    case "lost_warehouse":
      return `${intro}laut Bestandsprotokoll sind ${c.quantity} Einheiten von ${item} seit ${date ?? "[Datum]"} im Versandzentrum als verloren gebucht und bisher weder wiedergefunden noch erstattet worden.${outro}`;
    case "damaged_warehouse":
      return `${intro}laut Bestandsprotokoll wurden ${c.quantity} Einheiten von ${item} im Versandzentrum beschädigt (seit ${date ?? "[Datum]"}). Eine Erstattung ist bisher nicht erfolgt.${outro}`;
    case "reimbursed_below_cost":
      return `${intro}für die Erstattung ${c.reference ?? "[Erstattungs-ID]"} (${item}) wurde ein Betrag unter unserem Einkaufspreis erstattet. Wir bitten um Prüfung und Nachzahlung der Differenz auf Basis des nachweisbaren Einkaufspreises.${outro}`;
    case "return_not_received":
      return `${intro}für die Bestellung ${c.reference ?? "[Bestellnummer]"} (${item}) wurde der Kunde am ${date ?? "[Datum]"} erstattet. Die Rücksendung ist bis heute nicht im Versandzentrum eingegangen.${outro}`;
    case "return_damaged":
      return `Betreff: Retoure bei Amazon beschädigt, Bestellung ${c.reference ?? "[Bestellnummer]"}\n\n${intro}die Kundenretoure zur Bestellung ${c.reference ?? "[Bestellnummer]"} (${item}) wurde im Logistikzentrum als beschädigt erfasst (Eingang: ${ev("Rücksendung eingegangen")}). Die Beschädigung ist demnach beim Transport oder im Logistikzentrum entstanden, nicht beim Kunden. Eine Entschädigung finden wir im Erstattungsbericht nicht.${outro}`;
    case "return_wrong_item":
      return `Betreff: Falscher Artikel zurückgesendet, Bestellung ${c.reference ?? "[Bestellnummer]"}\n\n${intro}zur Bestellung ${c.reference ?? "[Bestellnummer]"} (${item}) hat der Kunde laut Retourenbericht einen anderen Artikel zurückgeschickt (Grund: ${ev("Rücksendegrund")}). Der Kunde wurde trotzdem erstattet (${ev("Kunde erstattet am")}).${outro}`;
    case "refund_too_high":
      return `Betreff: Zu hohe Erstattung, Bestellung ${c.reference ?? "[Bestellnummer]"}\n\n${intro}für die Bestellung ${c.reference ?? "[Bestellnummer]"} (${item}) wurde dem Kunden mehr erstattet, als er bezahlt hat. Der Mehrbetrag liegt bei ${ev("Mehr erstattet als bezahlt")}.\n\nBitte prüfen Sie die Erstattung und schreiben Sie uns den zu viel erstatteten Betrag gut.\n\nVielen Dank und freundliche Grüße`;
    case "fbm_safet":
      return `SAFE-T-Antrag, Bestellung ${c.reference ?? "[Bestellnummer]"}\n\nFür die Bestellung ${c.reference ?? "[Bestellnummer]"} (${item}) wurde dem Kunden ein Betrag erstattet (Rücksendung angefragt am ${ev("Rücksendung angefragt am")}), bevor die Ware bei mir eingegangen ist. ${ev("Sendungsnummer") === "keine" ? "Für die Rücksendung liegt keine Sendungsnummer vor." : `Die Sendungsnummer ${ev("Sendungsnummer")} zeigt keine Zustellung an mich.`} Bis heute habe ich den Artikel nicht zurückerhalten.\n\nIch bitte um Erstattung des Betrags über SAFE-T.`;
    case "disposed_without_order":
      return `${intro}laut Bestandsprotokoll wurden am ${date ?? "[Datum]"} ${c.quantity} Einheiten von ${item} entsorgt. Einen Entsorgungsauftrag haben wir dafür nicht erteilt.${outro}`;
    case "removal_incomplete":
      return `${intro}beim Remissionsauftrag ${c.reference ?? "[Auftragsnummer]"} (${item}) fehlen ${c.quantity} Einheiten: Sie sind weder bei uns angekommen noch als storniert oder entsorgt ausgewiesen.${outro}`;
    case "removal_shipment_stuck":
      return `Betreff: Remissionsauftrag ${c.reference ?? "[Auftragsnummer]"} – Sendung nie angekommen\n\n${intro}unser Remissionsauftrag ${c.reference ?? "[Auftragsnummer]"} wurde laut Bericht „Remissionssendungen“ am ${ev("Versandt am")} mit ${ev("Versanddienst")} unter der Sendungsnummer ${ev("Sendungsnummer")} versandt. Die Sendung ist bis heute nicht bei uns angekommen, die Sendungsverfolgung zeigt keine Zustellung. Der Auftrag ist bei Ihnen trotzdem als abgeschlossen ausgewiesen.\n\nBetroffene Artikel (FNSKU × Anzahl): ${ev("Artikel (FNSKU × Anzahl)")} – insgesamt ${c.quantity} Einheiten.\n\nDa der Versand durch einen von Amazon beauftragten Dienstleister erfolgte, bitten wir um Nachforschung beim Versanddienst und um Erstattung der nicht zugestellten Einheiten.${outro.replace(/Bitte prüfen Sie den Vorgang und erstatten Sie die betroffenen Einheiten\. ?/, "").replace(/\n{3,}/g, "\n\n")}`;
    default:
      return `${intro}wir bitten um Prüfung des folgenden Vorgangs zu ${item}.${outro}`;
  }
}

/** Auftrag an die KI: den Vorlagen-Text für Seller Support überzeugend formulieren – ohne neue Fakten. */
export function aiCaseTextPrompt(c: ClaimLike & { title?: string }, lang: "de" | "en"): string {
  const facts = c.evidence.map((e) => `- ${e.label}: ${e.value}`).join("\n");
  return [
    `Du schreibst für einen Amazon-Verkäufer einen Fall (Case) an den Amazon Seller Support, ${lang === "en" ? "auf Englisch" : "auf Deutsch"}.`,
    "Ziel: Erstattung der betroffenen Einheiten. Sachlich, höflich, knapp, mit allen Nummern so, dass der Support den Vorgang ohne Rückfrage prüfen kann.",
    "Regeln: Nutze ausschließlich die Fakten unten – erfinde keine Daten, Nummern, Beträge oder Zusagen. Fehlt etwas, lass es weg.",
    "Struktur: Betreffzeile, kurze Darstellung, Auflistung der Nummern (Auftrag, Sendungsnummer, FNSKU × Anzahl), konkrete Bitte. Keine Einleitung wie „Hier ist der Text“ – nur den fertigen Text ausgeben.",
    c.title ? `\nVorgang: ${c.title}` : "",
    `\nFakten:\n${facts}`,
    `\nMenge gesamt: ${c.quantity}`,
    c.unitCost !== null ? `Einkaufspreis netto je Einheit: ${eur(c.unitCost)} (Rechnung kann nachgereicht werden)` : "",
    `\nVorlage (als Ausgangspunkt):\n${claimCaseText(c)}`,
  ].filter(Boolean).join("\n");
}
