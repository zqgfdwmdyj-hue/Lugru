// VA-Automatik (B18) – reine Logik: Kategorie je Fall bzw. Anspruch, Regel (an die VA / erst Ludwig / nie),
// Erinnerungen vor der Frist (Standard 7/3/1 Tage um 09:00 VA-Zeit), Arbeitstage, Fallnummer in Antworten der VA,
// Sammel-Thread-Zuordnung und die englischen Texte (Anspruch, Erinnerung, Sammel-Thread, „Daily overview“).
// Ohne Datenbank – getestet in tests/va-automatik.test.ts.

import { lokal, type AnleitungKurz } from "./logic";
import { datum } from "./sprache";

export const VA_KATEGORIEN = [
  "anspruch",
  "fall_antwort",
  "freischaltung_abgelehnt",
  "dokument_erneut",
  "angebot_deaktiviert",
  "fba_fehlmenge",
  "marke",
  "freischaltung_entzogen",
  "kontozustand",
  "a_bis_z",
  "info",
  "sonstiges",
] as const;
export type VaKategorie = (typeof VA_KATEGORIEN)[number];
export type VaZiel = "va" | "ludwig" | "nie";

export const VA_KATEGORIE_LABEL: Record<VaKategorie, string> = {
  anspruch: "Erstattungsanspruch",
  fall_antwort: "Fall „Antwort nötig“",
  freischaltung_abgelehnt: "Freischaltung abgelehnt / Unterlagen nachreichen",
  dokument_erneut: "Dokument erneut einreichen",
  angebot_deaktiviert: "Angebot deaktiviert (Preisfehler, fehlende Angaben, GPSR/EPR)",
  fba_fehlmenge: "FBA-Fehlmenge",
  marke: "Markenbeschwerde / Echtheit",
  freischaltung_entzogen: "Freischaltung entzogen",
  kontozustand: "Kontozustand / Sperrung",
  a_bis_z: "A-bis-z / Rückbuchung",
  info: "Info-Mails (Versand, Bestellung, Zahlung, Gebühren-News)",
  sonstiges: "Sonstiges",
};

/** Standard laut Auftrag: Routinefälle an die VA, Heikles erst an Ludwig, Info nie. */
export const VA_REGEL_STANDARD: Record<VaKategorie, VaZiel> = {
  anspruch: "va",
  fall_antwort: "va",
  freischaltung_abgelehnt: "va",
  dokument_erneut: "va",
  angebot_deaktiviert: "va",
  fba_fehlmenge: "va",
  marke: "ludwig",
  freischaltung_entzogen: "ludwig",
  kontozustand: "ludwig",
  a_bis_z: "ludwig",
  info: "nie",
  sonstiges: "ludwig",
};

export const VA_ZIEL_LABEL: Record<VaZiel, string> = { va: "automatisch an die VA", ludwig: "erst an Ludwig", nie: "nie an die VA" };

// „Dokument erneut einreichen“ in allen EU-Sprachen (Betreff/Titel des Vorgangs).
const ERNEUT =
  /erneut (?:einreichen|hochladen|übermitteln)|neu einreichen|re-?submit|upload (?:a )?(?:new|valid|updated) document|submit (?:a |the )?(?:new|valid|updated) document|document(?:s)? (?:was |were )?(?:rejected|expired)|dokument(?:e)? (?:abgelehnt|abgelaufen)|soumettre (?:à nouveau|de nouveau)|nouveau document|ripresentare|caricare di nuovo|volver a (?:enviar|presentar)|opnieuw (?:indienen|uploaden)|ponownie (?:przesłać|złożyć)|skicka in (?:igen|på nytt)/i;

/** Kategorie eines Vorgangs der Fall-Zentrale (Bereich + Phase + Titel). */
export function fallKategorie(v: { bereich: string; phase: string; titel?: string | null }): VaKategorie {
  const { bereich, phase } = v;
  if (bereich === "info" || phase === "info") return "info";
  if (bereich === "marke") return "marke";
  if (bereich === "kontozustand") return "kontozustand";
  if (bereich === "a_bis_z") return "a_bis_z";
  if (bereich === "freischaltung") {
    if (phase === "entzogen") return "freischaltung_entzogen";
    if (phase === "abgelehnt" || phase === "nachreichen") return "freischaltung_abgelehnt";
    // beantragt/genehmigt: bei Amazon, nichts zu tun.
    return "info";
  }
  if (ERNEUT.test(v.titel ?? "")) return "dokument_erneut";
  if (bereich === "angebot") return "angebot_deaktiviert";
  if (bereich === "fba_sendung") return "fba_fehlmenge";
  // Amazon will eine Antwort (auch zu Erstattungen): Fall „Antwort nötig“; reine Erstattungs-Mitteilungen sind Info.
  if (phase === "antwort_noetig") return "fall_antwort";
  if (phase === "nachreichen") return "dokument_erneut";
  if (bereich === "entschaedigung" || bereich === "erstattung_kunde") return "info";
  return "sonstiges";
}

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** Regel anwenden: Kategorie-Einstellung, Betrag über der Schwelle (Standard 500 €) geht erst an Ludwig. */
export function vaEntscheidung(o: { kategorie: VaKategorie; betrag: number | null; regeln?: Partial<Record<string, VaZiel>>; schwelle: number }): { ziel: VaZiel; grund: string } {
  const label = VA_KATEGORIE_LABEL[o.kategorie];
  const regel = o.regeln?.[o.kategorie] ?? VA_REGEL_STANDARD[o.kategorie];
  if (regel === "nie") return { ziel: "nie", grund: `${label}: nie an die VA` };
  if (regel === "va" && o.betrag !== null && o.schwelle > 0 && o.betrag > o.schwelle) return { ziel: "ludwig", grund: `Betrag ${eur(o.betrag)} über ${eur(o.schwelle)} – erst Ludwig` };
  return { ziel: regel, grund: `${label}: ${VA_ZIEL_LABEL[regel]}` };
}

// ---- Tage, Uhrzeiten, Arbeitstage ---------------------------------------------------------------------------

const tag = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
export const tageBis = (heute: string, frist: string) => Math.round((tag(frist) - tag(heute)) / 86_400_000);
export const plusTage = (iso: string, n: number) => new Date(tag(iso) + n * 86_400_000).toISOString().slice(0, 10);
/** ISO-Wochentag 1 = Montag … 7 = Sonntag. */
export const wochentag = (iso: string) => new Date(tag(iso)).getUTCDay() || 7;

/** Beginn des heutigen Tages in der Zeitzone der VA (für „höchstens N neue Threads am Tag“). */
export function tagesbeginn(jetzt: Date, zeitzone: string): Date {
  const minute = Math.floor(jetzt.getTime() / 60_000) * 60_000;
  const lok = lokal(new Date(minute), zeitzone);
  const versatz = Date.parse(`${lok.datum}T${lok.zeit}:00Z`) - minute;
  return new Date(Date.parse(`${lok.datum}T00:00:00Z`) - versatz);
}

export function istArbeitstag(datumIso: string, arbeitstage: number[], feiertage: string[]): boolean {
  return arbeitstage.includes(wochentag(datumIso)) && !feiertage.includes(datumIso);
}

/** Erinnerung vor der Frist fällig? Liefert die Resttage (z. B. 7, 3, 1) – einmal am Tag ab der Uhrzeit (VA-Zeit). */
export function fristErinnerung(o: { frist: string | null; heute: string; zeit: string; uhrzeit: string; letzte: string | null; tage: number[] }): number | null {
  if (!o.frist || o.letzte === o.heute || o.zeit < o.uhrzeit) return null;
  const rest = tageBis(o.heute, o.frist);
  return rest > 0 && o.tage.includes(rest) ? rest : null;
}

/** Tägliche Übersicht fällig: Arbeitstag der VA, ab der Uhrzeit, einmal am Tag, nicht in der Ruhezeit. */
export function uebersichtFaellig(o: { heute: string; zeit: string; uhrzeit: string; letzte: string | null; arbeitstage: number[]; feiertage: string[]; ruhe: boolean }): boolean {
  return !o.ruhe && o.letzte !== o.heute && o.zeit >= o.uhrzeit && istArbeitstag(o.heute, o.arbeitstage, o.feiertage);
}

/** Feiertage aus dem Formular: Datum je Zeile oder durch Komma getrennt (JJJJ-MM-TT oder TT.MM.JJJJ). */
export function feiertageAusText(text: string): string[] {
  const out = new Set<string>();
  for (const roh of text.split(/[\n,;]+/)) {
    const t = roh.trim();
    let iso: string | null = null;
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    const b = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
    if (a) iso = t;
    else if (b) iso = `${b[3]}-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}`;
    if (iso && !Number.isNaN(Date.parse(iso))) out.add(iso);
  }
  return [...out].sort().slice(0, 100);
}

// ---- Antworten der VA ------------------------------------------------------------------------------------------

/**
 * Amazon-Fallnummer in einer Antwort der VA: mit Kennwort („case 12345678901“, „Case ID: …“, „Fall …“, „#…“)
 * 8–12 Ziffern, ohne Kennwort nur 10–12 Ziffern (keine Bestellnummer 123-1234567-1234567, keine Mengen/Beträge).
 */
export function fallnummerInAntwort(text: string): string | null {
  const t = text.replace(/<@!?\d+>|<#\d+>/g, " ");
  const mit = /(?:case|fall|ticket|claim)\s*(?:-?id|no\.?|number|nummer|nr\.?)?\s*[:#-]?\s*(\d{8,12})(?!\d)/i.exec(t) ?? /#\s?(\d{8,12})(?!\d)/.exec(t);
  if (mit) return mit[1];
  const ohne = /(?<![\d.,-])(\d{10,12})(?![\d.,-]?\d)/.exec(t);
  return ohne ? ohne[1] : null;
}

export type SammelEintrag = { nr: number; kennungen: string[]; offen: boolean };

/**
 * Antwort im Sammel-Thread den Einträgen zuordnen: je Zeile „#3 case 12345678901“, „3) done“ oder eine Kennung
 * (SKU, FNSKU, ASIN, Sendung). Ohne Nummer/Kennung gilt eine Fallnummer nur, wenn genau ein Eintrag offen ist.
 */
export function sammelZuordnung(text: string, eintraege: SammelEintrag[]): { nr: number; fallnummer: string | null; erledigt: boolean }[] {
  const out = new Map<number, { nr: number; fallnummer: string | null; erledigt: boolean }>();
  const offen = eintraege.filter((e) => e.offen);
  for (const zeile of text.split(/\n+/).map((z) => z.trim()).filter(Boolean)) {
    const nrM = /(?:^|\s)#\s?(\d{1,3})(?!\d)|^(\d{1,3})\s*[.)]\s|(?:item|no\.?|nr\.?)\s*(\d{1,3})(?!\d)/i.exec(zeile);
    const nr = nrM ? Number(nrM[1] ?? nrM[2] ?? nrM[3]) : null;
    let e = nr !== null ? eintraege.find((x) => x.nr === nr) : undefined;
    if (!e) e = eintraege.find((x) => x.kennungen.some((k) => k.length >= 5 && zeile.toUpperCase().includes(k.toUpperCase())));
    const rest = nrM ? zeile.replace(nrM[0], " ") : zeile;
    const fallnummer = fallnummerInAntwort(rest);
    const erledigt = /✅|☑️|✔️|\b(done|submitted|filed|erledigt|eingereicht)\b/i.test(zeile);
    if (!e && offen.length === 1 && (fallnummer || erledigt)) e = offen[0];
    if (!e || (!fallnummer && !erledigt)) continue;
    const alt = out.get(e.nr);
    out.set(e.nr, { nr: e.nr, fallnummer: fallnummer ?? alt?.fallnummer ?? null, erledigt: erledigt || Boolean(alt?.erledigt) });
  }
  return [...out.values()];
}

// ---- Texte für die VA (Englisch) ---------------------------------------------------------------------------

export const CLAIM_TYPE_EN: Record<string, string> = {
  inbound_shortage: "Inbound shipment shortage",
  lost_warehouse: "Lost in the fulfilment centre",
  damaged_warehouse: "Damaged in the fulfilment centre",
  reimbursed_below_cost: "Reimbursed below cost",
  return_not_received: "Customer refunded, return never arrived",
  disposed_without_order: "Disposed without a removal order",
  removal_incomplete: "Removal order incomplete",
  removal_shipment_stuck: "Removal shipment stuck",
  return_damaged: "Return damaged at Amazon",
  return_wrong_item: "Wrong item returned",
  return_condition: "Return empty/used/damaged (checked)",
  refund_too_high: "Customer refunded too much",
  fbm_safet: "SAFE-T claim (merchant fulfilled)",
  other: "Other",
};

/** Standard-Anleitung, solange im Wissen keine „File reimbursement claim“ steht. */
export const ANLEITUNG_ANSPRUCH_STANDARD: AnleitungKurz = {
  titel: "File reimbursement claim",
  zweck: "Get money back from Amazon for lost, damaged or missing units before the deadline.",
  schritte: [
    "Check that Amazon has not reimbursed it already (Seller Central → Reports → Fulfillment → Reimbursements).",
    "Open Seller Central → Help → Get support and choose the FBA topic that matches the type above (lost/damaged inventory, inbound shipment, customer return).",
    "Enter the identifiers from this message: SKU/FNSKU/ASIN, shipment or order ID, quantity.",
    "Attach the documents from this thread (invoice, shipment data) and paste the case text below.",
    "Submit before the deadline and reply here with the case ID (e.g. “Case 12345678901”).",
  ],
};

export type AnspruchFuerVa = {
  titel: string;
  typ: string;
  sku: string | null;
  asin: string | null;
  fnsku: string | null;
  sendung: string | null;
  bestellung: string | null;
  referenz: string | null;
  menge: number;
  betrag: number | null;
  frist: string | null;
  heute: string;
  belege: string[];
  anhaenge: string[];
  falltext: string | null;
  anleitung: (AnleitungKurz & { autoUebersetzt?: boolean }) | null;
  vaId: string | null;
};

const euroEn = (n: number) => `€${n.toFixed(2)}`;

/** Bezug des Anspruchs: FBA-Sendung, Bestellnummer oder sonstige Referenz (Erstattungs-ID, Remission). */
export function bezugAus(referenz: string | null): { sendung: string | null; bestellung: string | null; referenz: string | null } {
  const r = referenz?.trim() || null;
  if (!r) return { sendung: null, bestellung: null, referenz: null };
  if (/^FBA[0-9A-Z]{6,12}$/i.test(r)) return { sendung: r.toUpperCase(), bestellung: null, referenz: null };
  if (/^\d{3}-\d{7}-\d{7}$/.test(r)) return { sendung: null, bestellung: r, referenz: null };
  return { sendung: null, bestellung: null, referenz: r };
}

export function anspruchText(a: AnspruchFuerVa): string {
  const rest = a.frist ? tageBis(a.heute, a.frist) : null;
  const z = [
    `${a.vaId ? `<@${a.vaId}> ` : ""}💶 **New reimbursement claim: ${a.titel}**`,
    `Type: ${CLAIM_TYPE_EN[a.typ] ?? a.typ}`,
    [a.sku ? `SKU: ${a.sku}` : null, a.asin ? `ASIN: ${a.asin}` : null, a.fnsku ? `FNSKU: ${a.fnsku}` : null].filter(Boolean).join(" · ") || "SKU: –",
  ];
  const bezug = [a.sendung ? `Shipment: ${a.sendung}` : null, a.bestellung ? `Order: ${a.bestellung}` : null, a.referenz ? `Reference: ${a.referenz}` : null].filter(Boolean);
  if (bezug.length) z.push(bezug.join(" · "));
  z.push(`Quantity: ${a.menge}${a.betrag !== null ? ` · Expected amount: ${euroEn(a.betrag)}` : ""}`);
  z.push(a.frist ? `**Deadline: ${datum(a.frist, "en")}**${rest !== null ? ` (${rest === 0 ? "today" : rest === 1 ? "1 day left" : `${rest} days left`})` : ""}` : "Deadline: none known – please file this week");
  if (a.belege.length) z.push("", "🧾 Evidence:", ...a.belege.slice(0, 12).map((b) => `• ${b}`));
  if (a.anhaenge.length) z.push(`📎 Attachments: ${a.anhaenge.join(", ")}`);
  if (a.falltext?.trim()) z.push("", "✍️ Case text (copy into the case):", a.falltext.trim().slice(0, 1200));
  if (a.anleitung) {
    z.push("", `📖 **Instructions: ${a.anleitung.titel}**${a.anleitung.autoUebersetzt ? " (auto-translated)" : ""}`);
    if (a.anleitung.zweck) z.push(a.anleitung.zweck);
    a.anleitung.schritte.forEach((s, i) => z.push(`${i + 1}. ${s}`));
  }
  z.push("", "When submitted: reply here with the Amazon case ID. Question? Just ask here.");
  return z.join("\n");
}

export function fristErinnerungText(rest: number, titel: string, frist: string, vaId: string | null): string {
  return `${vaId ? `<@${vaId}> ` : ""}⏰ Reminder: claim deadline in ${rest} ${rest === 1 ? "day" : "days"} (${datum(frist, "en")}): **${titel}** – please file it and reply here with the case ID.`;
}

export const TEXT_EN = {
  eingereicht: (fall: string) => `✅ Thanks! Claim marked as submitted (case ${fall}).`,
  fallnummerFehlt: "👍 Thanks! Please reply with the Amazon case ID so the claim can be marked as submitted.",
  verpasst: (frist: string) => `⌛ The deadline (${datum(frist, "en")}) has passed without a case ID – no further action needed here, Ludwig takes over.`,
  imSystem: "✅ This claim is already marked as submitted or closed in the system – nothing to do. Thanks!",
  nichtMehrNoetig: "ℹ️ This claim is no longer open (reimbursed or found) – nothing to do. Thanks!",
  sammelEingereicht: (nr: number, fall: string) => `✅ #${nr}: marked as submitted (case ${fall}).`,
  sammelErledigt: (nr: number) => `✅ #${nr}: marked as done.`,
};

export function sammelKopf(datumIso: string, max: number): string {
  return `📦 **More tasks for ${datum(datumIso, "en")}** (over the daily limit of ${max} new threads)\nReply with “#<no.> case <ID>” when submitted or “#<no.> done”. Questions: just ask here.`;
}

export function sammelEintragText(nr: number, e: { art: "anspruch" | "fall"; titel: string; frist: string | null; zeilen: string[] }): string {
  return [`**#${nr} ${e.art === "anspruch" ? "Reimbursement claim" : "Amazon case"}: ${e.titel}**${e.frist ? ` – due ${datum(e.frist, "en")}` : ""}`, ...e.zeilen.slice(0, 15)].join("\n");
}

// ---- Daily overview ---------------------------------------------------------------------------------------

export type UebersichtPunkt = { titel: string; threadId: string | null; frist?: string | null };
export type Uebersicht = {
  datum: string;
  neu: UebersichtPunkt[];
  heute: UebersichtPunkt[];
  morgen: UebersichtPunkt[];
  ueberfaellig: UebersichtPunkt[];
  wartetAufLudwig: UebersichtPunkt[];
  beantwortet: UebersichtPunkt[];
  vaId: string | null;
};

const link = (p: UebersichtPunkt) => `• ${p.titel}${p.threadId ? ` → <#${p.threadId}>` : ""}`;

/** „Daily overview“ für die VA (Englisch), je Punkt mit Link zum Thread. */
export function uebersichtText(u: Uebersicht): string {
  const z = [`${u.vaId ? `<@${u.vaId}> ` : ""}🗓️ **Daily overview – ${datum(u.datum, "en")}**`];
  const block = (kopf: string, liste: UebersichtPunkt[], max = 15) => {
    if (!liste.length) return;
    z.push("", `**${kopf} (${liste.length})**`, ...liste.slice(0, max).map(link));
    if (liste.length > max) z.push(`… and ${liste.length - max} more`);
  };
  block("New since yesterday", u.neu);
  block("Due today", u.heute);
  block("Due tomorrow", u.morgen);
  block("Overdue", u.ueberfaellig.map((p) => ({ ...p, titel: p.frist ? `${p.titel} (since ${datum(p.frist, "en")})` : p.titel })));
  block("Answered by Ludwig – please continue", u.beantwortet);
  block("Your questions waiting for Ludwig", u.wartetAufLudwig);
  if (z.length === 1) z.push("", "Nothing new and nothing due – thank you!");
  return z.join("\n");
}
