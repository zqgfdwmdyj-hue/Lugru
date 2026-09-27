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
  const outro = `\n\nNachweise:\n${proof}\n\nBitte prüfen Sie den Vorgang und erstatten Sie die betroffenen Einheiten. Eine Rechnung über den Einkaufspreis (${eur(c.unitCost)} netto je Einheit) liegt vor und kann nachgereicht werden.\n\nVielen Dank und freundliche Grüße`;
  switch (c.type) {
    case "inbound_shortage":
      return `${intro}in der Sendung ${c.reference ?? "[Sendungs-ID]"} wurden laut unserem Scan-Protokoll mehr Einheiten von ${item} verschickt als eingebucht. Es fehlen ${c.quantity} Einheiten.${outro}`;
    case "lost_warehouse":
      return `${intro}laut Bestandsprotokoll sind ${c.quantity} Einheiten von ${item} seit ${c.eventDate ?? "[Datum]"} im Versandzentrum als verloren gebucht und bisher weder wiedergefunden noch erstattet worden.${outro}`;
    case "damaged_warehouse":
      return `${intro}laut Bestandsprotokoll wurden ${c.quantity} Einheiten von ${item} im Versandzentrum beschädigt (seit ${c.eventDate ?? "[Datum]"}). Eine Erstattung ist bisher nicht erfolgt.${outro}`;
    case "reimbursed_below_cost":
      return `${intro}für die Erstattung ${c.reference ?? "[Erstattungs-ID]"} (${item}) wurde ein Betrag unter unserem Einkaufspreis erstattet. Wir bitten um Prüfung und Nachzahlung der Differenz auf Basis des nachweisbaren Einkaufspreises.${outro}`;
    case "return_not_received":
      return `${intro}für die Bestellung ${c.reference ?? "[Bestellnummer]"} (${item}) wurde der Kunde am ${c.eventDate ?? "[Datum]"} erstattet. Die Rücksendung ist bis heute nicht im Versandzentrum eingegangen.${outro}`;
    case "disposed_without_order":
      return `${intro}laut Bestandsprotokoll wurden am ${c.eventDate ?? "[Datum]"} ${c.quantity} Einheiten von ${item} entsorgt. Einen Entsorgungsauftrag haben wir dafür nicht erteilt.${outro}`;
    case "removal_incomplete":
      return `${intro}beim Remissionsauftrag ${c.reference ?? "[Auftragsnummer]"} (${item}) fehlen ${c.quantity} Einheiten: Sie sind weder bei uns angekommen noch als storniert oder entsorgt ausgewiesen.${outro}`;
    default:
      return `${intro}wir bitten um Prüfung des folgenden Vorgangs zu ${item}.${outro}`;
  }
}
