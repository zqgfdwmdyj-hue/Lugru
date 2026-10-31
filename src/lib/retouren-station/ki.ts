// KI-Aufträge der Retouren-Station (Claude mit Bildern) und das strenge Lesen der Antworten. Reine Logik.
// Jede Antwort ist JSON nach Schema; bei unsicherer Erkennung „unsicher: true“ statt raten. Die KI entscheidet nie –
// der gesprochene Befund zählt, die KI-Einschätzung ist Hinweis und Warnung bei Abweichung.

import { z } from "zod";

const nullStr = z.string().trim().max(200).nullable().catch(null);
const unsicher = z.boolean().catch(true);

export const EtikettSchema = z.object({
  sendungsnummer: nullStr,
  versender: nullStr,
  remissions_id: nullStr,
  /** Nur der Absender-Firmenname (Amazon-Lager), nie Empfänger-Name oder -Adresse. */
  absender: nullStr,
  unsicher,
});
export type EtikettKi = z.infer<typeof EtikettSchema>;

export const LieferscheinSchema = z.object({
  remissions_id: nullStr,
  positionen: z
    .array(
      z.object({
        sku: nullStr.optional(),
        fnsku: nullStr.optional(),
        titel: nullStr.optional(),
        menge: z.coerce.number().int().min(0).max(9999).catch(1),
      }),
    )
    .max(200)
    .catch([]),
  unsicher,
});
export type LieferscheinKi = z.infer<typeof LieferscheinSchema>;

const dreiwertig = z.enum(["ja", "nein", "unklar"]).catch("unklar");
export const ProduktSchema = z.object({
  passt: dreiwertig,
  begruendung: z.string().max(600).catch(""),
  sichtbare_maengel: z.array(z.string().max(200)).max(20).catch([]),
  vollstaendig: dreiwertig,
  gebrauchsspuren: z.enum(["keine", "leicht", "deutlich", "unklar"]).catch("unklar"),
  vorschlag_befund: z.enum(["ok", "leer", "falsches_produkt", "benutzt", "beschaedigt", "unvollstaendig", "unklar"]).catch("unklar"),
  /** Auf dem Foto lesbare LPN/FNSKU (Klartext unter dem Barcode), falls die Kamera den Barcode nicht lesen konnte. */
  code_text: nullStr.optional(),
});
export type ProduktKi = z.infer<typeof ProduktSchema>;

export const FalltextSchema = z.object({ betreff: z.string().trim().min(3).max(200), text_de: z.string().trim().min(20).max(6000), text_en: z.string().trim().min(20).max(6000) });
export type FalltextKi = z.infer<typeof FalltextSchema>;

/** Erstes JSON-Objekt aus einer Antwort lesen (auch wenn die KI Text oder ```json drumherum schreibt). */
export function jsonAus<T>(text: string, schema: z.ZodType<T>): T | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const r = schema.safeParse(JSON.parse(text.slice(s, e + 1)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const NUR_JSON = "Antworte ausschließlich mit einem JSON-Objekt nach dem Schema, ohne weiteren Text.";

export const PROMPT_ETIKETT = [
  "Du liest das Versandetikett eines Pakets, das Amazon aus einem Logistikzentrum an einen Händler zurückschickt (Remission).",
  "Gesucht: Sendungsnummer (Tracking), Versanddienst (z. B. DHL, DPD, UPS, Hermes, GLS, TENDRON), Remissions-/Auftrags-ID falls aufgedruckt, Absender (nur Firmenname/Lager).",
  "Gib KEINE Empfängernamen, Adressen oder Telefonnummern aus.",
  "Wenn du etwas nicht sicher lesen kannst, setze das Feld auf null und „unsicher“ auf true – nicht raten.",
  'Schema: {"sendungsnummer": string|null, "versender": string|null, "remissions_id": string|null, "absender": string|null, "unsicher": boolean}',
  NUR_JSON,
].join("\n");

export const PROMPT_LIEFERSCHEIN = [
  "Du liest den Lieferschein (Packliste) einer Amazon-Remission. Gesucht: Remissions-/Auftrags-ID und alle Positionen mit SKU (Händler-SKU), FNSKU (beginnt meist mit X00), Titel und Menge.",
  "Keine Positionen erfinden. Unleserliches als null; bei Unsicherheit „unsicher“: true.",
  'Schema: {"remissions_id": string|null, "positionen": [{"sku": string|null, "fnsku": string|null, "titel": string|null, "menge": number}], "unsicher": boolean}',
  NUR_JSON,
].join("\n");

export function promptProdukt(p: { titel: string | null; asin: string | null; mitReferenzbild: boolean; amazonGrund?: string | null; kundenkommentar?: string | null }): string {
  return [
    "Du prüfst Amazon-Kundenretouren. Vergleiche die Fotos mit Titel und Referenzbild des Produkts. Antworte nur mit JSON nach Schema. Wenn du dir nicht sicher bist, setze passt: \"unklar\". Bewerte nur, was auf den Fotos sichtbar ist.",
    `Produkt laut Amazon: ${p.titel ?? "unbekannt"}${p.asin ? ` (ASIN ${p.asin})` : ""}.`,
    p.mitReferenzbild ? "Das LETZTE Bild ist das Referenzbild von Amazon, alle anderen sind Fotos der Retoure." : "Kein Referenzbild vorhanden – vergleiche nur mit dem Titel.",
    p.amazonGrund ? `Rücksendegrund des Kunden: ${p.amazonGrund}.` : "",
    p.kundenkommentar ? `Kundenkommentar (nur zur Einordnung, nicht als Beweis): ${p.kundenkommentar.slice(0, 300)}` : "",
    "Lies zusätzlich eine auf dem Etikett aufgedruckte LPN (beginnt mit LPN) oder FNSKU (X00…), falls sichtbar, in „code_text“.",
    'Schema: {"passt": "ja"|"nein"|"unklar", "begruendung": string, "sichtbare_maengel": string[], "vollstaendig": "ja"|"nein"|"unklar", "gebrauchsspuren": "keine"|"leicht"|"deutlich"|"unklar", "vorschlag_befund": "ok"|"leer"|"falsches_produkt"|"benutzt"|"beschaedigt"|"unvollstaendig"|"unklar", "code_text": string|null}',
    NUR_JSON,
  ]
    .filter(Boolean)
    .join("\n");
}

export type FallFakten = {
  lpn: string | null;
  bestellnummer: string;
  asin: string | null;
  sku: string | null;
  titel: string | null;
  rueckgabeDatum: string | null;
  erstattet: number | null;
  rueckgabegrund: string | null;
  befund: string;
  notiz: string | null;
  remissionId: string | null;
  fotos: string[];
};

/** Falltext: sachlich, kurz, nur belegte Fakten, Fotos nummeriert. */
export function promptFalltext(f: FallFakten): string {
  const liste = [
    `LPN: ${f.lpn ?? "–"}`,
    `Bestellnummer: ${f.bestellnummer}`,
    `ASIN: ${f.asin ?? "–"}`,
    `SKU: ${f.sku ?? "–"}`,
    `Artikel: ${f.titel ?? "–"}`,
    `Rückgabedatum: ${f.rueckgabeDatum ?? "–"}`,
    `An den Kunden erstattet: ${f.erstattet === null ? "–" : `${f.erstattet.toFixed(2)} EUR`}`,
    `Rücksendegrund laut Amazon: ${f.rueckgabegrund ?? "–"}`,
    `Remission: ${f.remissionId ?? "–"}`,
    `Befund bei Eingang (eigene Prüfung): ${f.befund}`,
    f.notiz ? `Notiz zum Befund: ${f.notiz}` : "",
    `Fotos (in dieser Reihenfolge angehängt): ${f.fotos.map((n, i) => `${i + 1}. ${n}`).join(", ")}`,
  ].filter(Boolean);
  return [
    "Du schreibst für einen Amazon-Verkäufer einen Fall an den Seller Support: Eine Kundenretoure kam nicht im erstatteten Zustand zurück (siehe Befund). Ziel: Erstattung (FBA-Kundenretoure).",
    "Sachlich, kurz, höflich. Nenne LPN, Bestellnummer, ASIN/SKU, Rückgabedatum, erstatteten Betrag und den Befund und verweise auf die Fotos mit ihren Nummern.",
    "Keine Behauptungen, die nicht durch Befund oder Fotos gedeckt sind. Keine Daten erfinden; was fehlt, weglassen.",
    "Liefere einen Betreff sowie den Text auf Deutsch (text_de) und Englisch (text_en).",
    `\nFakten:\n${liste.join("\n")}`,
    '\nSchema: {"betreff": string, "text_de": string, "text_en": string}',
    NUR_JSON,
  ].join("\n");
}

/** Falltext ohne KI (Vorlage) – falls kein KI-Schlüssel hinterlegt ist oder die KI nicht antwortet. */
export function falltextVorlage(f: FallFakten): FalltextKi {
  const eurDe = f.erstattet === null ? "–" : f.erstattet.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  const eurEn = f.erstattet === null ? "–" : `EUR ${f.erstattet.toFixed(2)}`;
  const datum = f.rueckgabeDatum ? f.rueckgabeDatum.split("-").reverse().join(".") : "–";
  const fotosDe = f.fotos.map((n, i) => `${i + 1}. ${n}`).join("\n");
  const art = `${f.sku ? `SKU ${f.sku}` : ""}${f.asin ? `${f.sku ? ", " : ""}ASIN ${f.asin}` : ""}`;
  return {
    betreff: `Kundenretoure nicht im erstatteten Zustand – Bestellung ${f.bestellnummer}${f.lpn ? `, LPN ${f.lpn}` : ""}`,
    text_de: [
      "Guten Tag,",
      "",
      `die Kundenretoure zur Bestellung ${f.bestellnummer} (${art || "Artikel"}${f.lpn ? `, LPN ${f.lpn}` : ""}) haben wir${f.remissionId ? ` mit der Remission ${f.remissionId}` : ""} erhalten und bei Eingang geprüft.`,
      `Befund: ${f.befund}.${f.notiz ? ` ${f.notiz}` : ""}`,
      `Der Kunde wurde trotzdem erstattet (${eurDe}, Rückgabe am ${datum}).`,
      "",
      `Fotos im Anhang:\n${fotosDe}`,
      "",
      "Bitte prüfen Sie den Vorgang und erstatten Sie uns den Artikel.",
      "",
      "Vielen Dank und freundliche Grüße",
    ].join("\n"),
    text_en: [
      "Hello,",
      "",
      `we received the customer return for order ${f.bestellnummer} (${art || "item"}${f.lpn ? `, LPN ${f.lpn}` : ""})${f.remissionId ? ` with removal order ${f.remissionId}` : ""} and inspected it on arrival.`,
      `Finding: ${f.befund}.${f.notiz ? ` ${f.notiz}` : ""}`,
      `The customer was refunded nevertheless (${eurEn}, returned on ${f.rueckgabeDatum ?? "–"}).`,
      "",
      `Attached photos:\n${f.fotos.map((n, i) => `${i + 1}. ${n}`).join("\n")}`,
      "",
      "Please review this case and reimburse us for the item.",
      "",
      "Thank you and kind regards",
    ].join("\n"),
  };
}

/** Englische Befund-Bezeichnung für den Falltext. */
export const BEFUND_EN: Record<string, string> = {
  ok: "as new",
  leer: "empty package, no item inside",
  falsches_produkt: "a different item was returned",
  benutzt: "used / signs of use",
  beschaedigt: "damaged",
  unvollstaendig: "incomplete (parts/accessories missing)",
};
