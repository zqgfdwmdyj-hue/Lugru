// Bauauftrag Abholung DHL/UPS – reine Logik ohne Datenbank: Datum und Zeitfenster aus Sprache/Text lesen,
// Eingaben prüfen (Regeln von DHL Parcel DE Pickup v1 und UPS Pickup v2409), Anfragen bauen, Antworten lesen,
// Zusammenfassung für die Rückfrage und die Regel für den Abhol-Vorschlag.

import type { AbholOrt } from "@/db/tables/core";

export type AbholDienst = "dhl" | "ups";
export const DIENST_NAME: Record<AbholDienst, string> = { dhl: "DHL", ups: "UPS" };

export type AbholEingabe = {
  dienst: AbholDienst;
  datum: string;
  von?: string | null;
  bis?: string | null;
  pakete: number;
  paletten?: number;
  gewichtKg?: number | null;
  hinweis?: string | null;
  ort: AbholOrt;
};

// ── Datum und Uhrzeit (Europe/Berlin) ────────────────────────────────────────

export const berlinHeute = (jetzt = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(jetzt);
export const berlinUhrzeit = (jetzt = new Date()) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(jetzt);

export function tagPlus(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sonntag … 6 = Samstag. */
export const wochentag = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const TAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const TAGE_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const datumText = (iso: string) => `${TAGE_KURZ[wochentag(iso)]}, ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

function ostersonntag(jahr: number): string {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31), tag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
}

/** Gesetzliche Feiertage bundesweit und in Bayern (Abholorte in München) – an diesen Tagen holt niemand ab. */
export function feiertage(jahr: number): string[] {
  const o = ostersonntag(jahr);
  const fest = ["01-01", "01-06", "05-01", "08-15", "10-03", "11-01", "12-25", "12-26"].map((t) => `${jahr}-${t}`);
  return [...fest, tagPlus(o, -2), tagPlus(o, 1), tagPlus(o, 39), tagPlus(o, 50), tagPlus(o, 60)].sort();
}
export const istFeiertag = (iso: string) => feiertage(Number(iso.slice(0, 4))).includes(iso);

/** Werktag für die Abholung: DHL Mo–Sa, UPS Mo–Fr, nie an Feiertagen. */
export const istAbholtag = (dienst: AbholDienst, iso: string) => {
  const w = wochentag(iso);
  return w !== 0 && !(dienst === "ups" && w === 6) && !istFeiertag(iso);
};

/** Nächster buchbarer Abholtag (DHL: Auftrag bis 22 Uhr für den nächsten Werktag; UPS: frühestens morgen). */
export function naechsterAbholtag(dienst: AbholDienst, jetzt = new Date()): string {
  let t = tagPlus(berlinHeute(jetzt), dienst === "dhl" && berlinUhrzeit(jetzt) >= "22:00" ? 2 : 1);
  while (!istAbholtag(dienst, t)) t = tagPlus(t, 1);
  return t;
}

const WOCHENTAG_WORT: Record<string, number> = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6 };

/**
 * Datum aus Sprache/Text: „heute“, „morgen“, „übermorgen“, Wochentag („Montag“ = der nächste), JJJJ-MM-TT,
 * TT.MM., TT.MM.JJ(JJ). TT.MM. ohne Jahr: liegt der Tag schon zurück, ist das nächste Jahr gemeint.
 */
export function datumLesen(text: string | null | undefined, jetzt = new Date()): string | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  const heute = berlinHeute(jetzt);
  if (/^heute\b/.test(t)) return heute;
  if (/^(über|ueber)morgen\b/.test(t)) return tagPlus(heute, 2);
  if (/^morgen\b/.test(t)) return tagPlus(heute, 1);
  const wt = /^(?:am |nächsten |naechsten |kommenden )?(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend)\b/.exec(t);
  if (wt) {
    const ziel = WOCHENTAG_WORT[wt[1]];
    let n = (ziel - wochentag(heute) + 7) % 7;
    if (n === 0) n = 7;
    return tagPlus(heute, n);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return gueltig(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(t);
  if (de) {
    const jahrText = de[3];
    const jahr = jahrText ? (jahrText.length === 2 ? 2000 + Number(jahrText) : Number(jahrText)) : Number(heute.slice(0, 4));
    let d = gueltig(jahr, Number(de[2]), Number(de[1]));
    if (d && !jahrText && d < heute) d = gueltig(jahr + 1, Number(de[2]), Number(de[1]));
    return d;
  }
  return null;
}

function gueltig(j: number, m: number, d: number): string | null {
  const iso = `${j}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const x = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Uhrzeit vereinheitlichen: „10“ → 10:00, „9.30“ → 09:30, „1030“ → 10:30; ungültig → null. */
export function zeitNorm(t: string | null | undefined): string | null {
  const s = (t ?? "").trim().toLowerCase().replace(/\s*uhr$/, "");
  if (!s) return null;
  let m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(s);
  if (!m) m = /^(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}

/** Zeitfenster: „10-12“, „10 bis 12 Uhr“, „10:00–12:30“, „von 9 bis 11.30“. */
export function fensterLesen(text: string | null | undefined): { von: string; bis: string } | null {
  const s = (text ?? "").trim().toLowerCase().replace(/^von\s+/, "").replace(/\s*uhr\b/g, "");
  const m = /^(\d{1,2}(?:[:.]\d{2})?)\s*(?:-|–|—|bis)\s*(\d{1,2}(?:[:.]\d{2})?)$/.exec(s);
  if (!m) return null;
  const von = zeitNorm(m[1]), bis = zeitNorm(m[2]);
  return von && bis ? { von, bis } : null;
}

const minuten = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// ── Abholort ────────────────────────────────────────────────────────────────

/** Abholort aus Text: Schlüssel oder Teil des Namens („LuGru“), ohne Angabe der Standardort bzw. der einzige. */
export function ortFinden(orte: AbholOrt[], text?: string | null): AbholOrt | null {
  const q = (text ?? "").trim().toLowerCase();
  if (!q) return orte.find((o) => o.standard) ?? (orte.length === 1 ? orte[0] : null);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");
  return orte.find((o) => o.key.toLowerCase() === q) ?? orte.find((o) => norm(o.name).includes(norm(q)) || norm(q).includes(norm(o.key))) ?? null;
}

export const ortAdresse = (o: AbholOrt) => `${o.name}${o.name2 ? `, ${o.name2}` : ""}, ${o.strasse} ${o.hausnr}, ${o.plz} ${o.ort}`;

/** Schlüssel aus dem Namen (für neue Orte): klein, ohne Sonderzeichen. */
export const ortSchluessel = (name: string) => name.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "ort";

/** Pflichtangaben eines Abholorts (DHL und UPS brauchen Adresse, Ansprechpartner und Telefon). */
export function ortFehlt(o: AbholOrt): string[] {
  const f: string[] = [];
  if (!o.name?.trim()) f.push("Name");
  if (!o.strasse?.trim()) f.push("Straße");
  if (!o.hausnr?.trim()) f.push("Hausnummer");
  if (!/^\d{5}$/.test(o.plz ?? "")) f.push("PLZ (5 Ziffern)");
  if (!o.ort?.trim()) f.push("Ort");
  if (!o.kontakt?.trim()) f.push("Ansprechpartner");
  if (!o.telefon?.trim()) f.push("Telefon");
  return f;
}

// ── Prüfen ─────────────────────────────────────────────────────────────────

/** Geschätztes Gewicht, wenn keins angegeben ist (UPS verlangt ein Gesamtgewicht). */
export const GEWICHT_JE_PAKET_KG = 5;
export const HINWEIS_MAX = 100;

export function abholungPruefen(e: AbholEingabe, jetzt = new Date(), o: { upsKonto?: string | null } = {}): { fehler: string[]; hinweise: string[] } {
  const fehler: string[] = [];
  const hinweise: string[] = [];
  const heute = berlinHeute(jetzt);
  const dienst = DIENST_NAME[e.dienst];
  const ortLuecken = ortFehlt(e.ort);
  if (ortLuecken.length) fehler.push(`Abholort „${e.ort.name || e.ort.key}“ unvollständig: ${ortLuecken.join(", ")} (Einstellungen → Abholung).`);
  const pal = e.paletten ?? 0;
  if (!Number.isInteger(e.pakete) || e.pakete < 0 || e.pakete > 999) fehler.push("Anzahl Pakete: 0 bis 999.");
  if (!Number.isInteger(pal) || pal < 0 || pal > 99) fehler.push("Anzahl Paletten: 0 bis 99.");
  if (e.pakete + pal < 1) fehler.push("Mindestens ein Paket oder eine Palette.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.datum)) fehler.push("Datum fehlt oder ist ungültig.");
  else if (e.datum < heute) fehler.push(`Das Datum ${datumText(e.datum)} liegt in der Vergangenheit.`);
  else {
    if (e.datum > tagPlus(heute, 30)) fehler.push(`${dienst} nimmt Abholungen höchstens 30 Tage im Voraus an.`);
    if (wochentag(e.datum) === 0) fehler.push(`Sonntag holt ${dienst} nicht ab – nächster Abholtag: ${datumText(naechsterAbholtag(e.dienst, jetzt))}.`);
    else if (e.dienst === "ups" && wochentag(e.datum) === 6) fehler.push(`Samstag holt UPS nur gegen Aufpreis ab – bitte einen Werktag Mo–Fr wählen (nächster: ${datumText(naechsterAbholtag("ups", jetzt))}).`);
    else if (istFeiertag(e.datum)) fehler.push(`${datumText(e.datum)} ist ein Feiertag – nächster Abholtag: ${datumText(naechsterAbholtag(e.dienst, jetzt))}.`);
    if (e.dienst === "dhl") {
      if (e.datum === heute) fehler.push(`DHL holt nicht am selben Tag ab – frühestens ${datumText(naechsterAbholtag("dhl", jetzt))} (Auftrag bis 22 Uhr für den nächsten Werktag).`);
      else if (e.datum === tagPlus(heute, 1) && berlinUhrzeit(jetzt) >= "22:00") fehler.push(`Nach 22 Uhr nimmt DHL keine Abholung für morgen mehr an – frühestens ${datumText(naechsterAbholtag("dhl", jetzt))}.`);
    }
  }
  const von = e.von ? zeitNorm(e.von) : null;
  const bis = e.bis ? zeitNorm(e.bis) : null;
  if ((e.von && !von) || (e.bis && !bis)) fehler.push("Zeitfenster bitte als HH:MM (z. B. 10:00–12:00).");
  else if (von && bis && minuten(bis) <= minuten(von)) fehler.push("Zeitfenster: „bis“ muss nach „von“ liegen.");
  if (e.dienst === "dhl") {
    if (von && bis) hinweise.push("DHL bucht keine feste Uhrzeit: Das Fenster geht als Öffnungszeit mit, die genaue Abholzeit nennt DHL am Abholtag.");
    if (e.pakete > 10) hinweise.push("Mehr als 10 Pakete: DHL behandelt das als einmalige Abholung – die Buchung ist eine Anfrage, die Bestätigung kommt per Mail.");
    if (!e.ort.dhlKundennummer && !e.ort.dhlAbrechnungsnummer) hinweise.push("Am Abholort ist keine DHL-Kundennummer hinterlegt – die Abholung läuft ohne Kundenzuordnung.");
    if (e.ort.dhlAbrechnungsnummer && !/^\d{12}\w{2}$/.test(e.ort.dhlAbrechnungsnummer)) fehler.push("DHL-Abrechnungsnummer am Abholort: 14 Zeichen (EKP + Verfahren + Teilnahme).");
    if (e.ort.dhlKundennummer && !/^\d{10}$/.test(e.ort.dhlKundennummer)) fehler.push("DHL-Kundennummer (EKP) am Abholort: 10 Ziffern.");
  } else {
    if (!von || !bis) fehler.push("UPS braucht ein Zeitfenster (bereit ab / spätestens bis), z. B. 10:00–12:00.");
    else if (minuten(bis) - minuten(von) < 120) hinweise.push("UPS empfiehlt mindestens 2 Stunden zwischen „bereit ab“ und „spätestens bis“.");
    if (!(e.ort.upsKonto || o.upsKonto)) fehler.push("UPS-Kontonummer fehlt (Abholort oder Anbindungen → UPS).");
    if (!e.gewichtKg) hinweise.push(`Kein Gewicht angegeben – UPS bekommt ${GEWICHT_JE_PAKET_KG} kg je Paket geschätzt (${(e.pakete || 1) * GEWICHT_JE_PAKET_KG} kg).`);
    if (pal > 0) hinweise.push("UPS-Abholung bucht Pakete – Paletten (UPS Freight) bitte gesondert anmelden.");
  }
  if (e.gewichtKg != null && (!(e.gewichtKg > 0) || e.gewichtKg > 99999)) fehler.push("Gewicht in kg: größer 0.");
  const hinweis = e.hinweis ?? e.ort.hinweis ?? "";
  if (hinweis.length > HINWEIS_MAX) hinweise.push(`Hinweis für den Fahrer wird auf ${HINWEIS_MAX} Zeichen gekürzt.`);
  return { fehler, hinweise };
}

/** Zeitfenster der Eingabe – sonst das Standardfenster des Abholorts. */
export function fensterVon(e: Pick<AbholEingabe, "von" | "bis" | "ort">): { von: string | null; bis: string | null } {
  return { von: zeitNorm(e.von) ?? zeitNorm(e.ort.von), bis: zeitNorm(e.bis) ?? zeitNorm(e.ort.bis) };
}

/** Zusammenfassung für die Rückfrage („Soll ich buchen?“) und das Protokoll. */
export function abholZusammenfassung(e: AbholEingabe): string {
  const f = fensterVon(e);
  const teile = [`${e.pakete} Paket${e.pakete === 1 ? "" : "e"}`, (e.paletten ?? 0) > 0 ? `${e.paletten} Palette${e.paletten === 1 ? "" : "n"}` : null, e.gewichtKg ? `${String(e.gewichtKg).replace(".", ",")} kg` : null].filter(Boolean);
  return `${DIENST_NAME[e.dienst]}-Abholung am ${datumText(e.datum)}${f.von && f.bis ? `, ${f.von}–${f.bis} Uhr` : ""}, ${teile.join(", ")} – ${ortAdresse(e.ort)}`;
}

// ── DHL Parcel DE Pickup v1 ───────────────────────────────────────────────

const kuerzen = (s: string | null | undefined, n: number) => (s ?? "").trim().slice(0, n);

/** Auftrag für POST /orders: je Paket ein Eintrag (Größe M), je Palette ein Eintrag PALETTEN. */
export function dhlAuftrag(e: AbholEingabe) {
  const f = fensterVon(e);
  const o = e.ort;
  const hinweis = kuerzen(e.hinweis ?? o.hinweis, HINWEIS_MAX);
  const customer = { ...(o.dhlKundennummer ? { accountNumber: o.dhlKundennummer } : {}), ...(o.dhlAbrechnungsnummer ? { billingNumber: o.dhlAbrechnungsnummer } : {}) };
  return {
    ...(Object.keys(customer).length ? { customerDetails: customer } : {}),
    pickupLocation: {
      pickupAddress: { name1: kuerzen(o.name, 50), ...(o.name2 ? { name2: kuerzen(o.name2, 50) } : {}), addressStreet: kuerzen(o.strasse, 50), addressHouse: kuerzen(o.hausnr, 10), postalCode: o.plz, city: kuerzen(o.ort, 40), country: "DE" },
      ...(f.von && f.bis ? { businessHours: [{ timeFrom: f.von, timeUntil: f.bis }] } : {}),
    },
    contactPerson: { name: kuerzen(o.kontakt, 50), phone: kuerzen(o.telefon, 50), ...(o.email ? { email: kuerzen(o.email, 250) } : {}) },
    pickupDetails: {
      pickupDate: { type: "Date", value: e.datum },
      ...(o.email ? { emailNotification: kuerzen(o.email, 250) } : {}),
      ...(e.gewichtKg ? { totalWeight: { uom: "kg", value: Math.round(e.gewichtKg * 10) / 10 } } : {}),
      ...(hinweis ? { comment: hinweis } : {}),
    },
    shipmentDetails: {
      shipments: [
        ...Array.from({ length: e.pakete }, () => ({ transportationType: "PAKET", size: "M" })),
        ...Array.from({ length: e.paletten ?? 0 }, () => ({ transportationType: "PALETTEN" })),
      ],
    },
  };
}

export type AbholErgebnis = { status: "gebucht" | "angefragt"; bestaetigung: string; datum: string | null; abholArt: string | null; kostenpflichtig: boolean | null };

/** Antwort 201: confirmation.value.orderID; EMA = einmalige Abholung → nur angefragt (Bestätigung per Mail). */
export function dhlAntwortLesen(j: unknown): AbholErgebnis | null {
  const v = (j as { confirmation?: { value?: { orderID?: string; pickupDate?: string; freeOfCharge?: boolean; pickupType?: string } } })?.confirmation?.value;
  if (!v?.orderID) return null;
  return { status: v.pickupType === "EMA" ? "angefragt" : "gebucht", bestaetigung: v.orderID, datum: v.pickupDate ?? null, abholArt: v.pickupType ?? null, kostenpflichtig: typeof v.freeOfCharge === "boolean" ? !v.freeOfCharge : null };
}

export const DHL_ART: Record<string, string> = { BDA: "Bedarfsabholung", EZA: "Einzelabholung", EMA: "einmalige Abholung (Anfrage, Bestätigung per Mail)" };

/** Fehlertext aus der DHL-Antwort (422: Liste mit title/detail; sonst detail/title/status). */
export function dhlFehlerText(status: number, j: unknown): string {
  if (status === 401 || status === 403) return "DHL lehnt den Zugang ab – API-Key, Benutzer (mit Abholrecht im Geschäftskundenportal) oder Freischaltung der Pickup-API prüfen.";
  const liste = Array.isArray(j) ? j : Array.isArray((j as { errors?: unknown })?.errors) ? (j as { errors: unknown[] }).errors : [j];
  const texte = liste.map((x) => { const e = x as { title?: string; detail?: string; errorCode?: string }; return [e?.title, e?.detail].filter(Boolean).join(": "); }).filter(Boolean);
  return `DHL: ${texte.length ? texte.join(" · ").slice(0, 400) : `Fehler ${status}`}`;
}

/** Storno-Antwort: confirmedCancellations / failedCancellations. */
export function dhlStornoLesen(j: unknown, orderId: string): { ok: boolean; text: string } {
  const r = j as { confirmedCancellations?: { orderID?: string }[]; failedCancellations?: { orderID?: string; message?: string }[] };
  if (r?.confirmedCancellations?.some((c) => c.orderID === orderId) || (r?.confirmedCancellations?.length && !r.failedCancellations?.length)) return { ok: true, text: "DHL hat die Abholung storniert." };
  const f = r?.failedCancellations?.[0];
  return { ok: false, text: `DHL konnte nicht stornieren${f?.message ? `: ${f.message}` : ""}.` };
}

// ── UPS Pickup v2409 ───────────────────────────────────────────────────────

/** Anfrage für POST /api/pickupcreation/v2409/pickup (UPS Standard, Pakete, keine Preisabfrage). */
export function upsAuftrag(e: AbholEingabe, konto: string) {
  const f = fensterVon(e);
  const o = e.ort;
  const gewicht = e.gewichtKg && e.gewichtKg > 0 ? e.gewichtKg : Math.max(1, e.pakete) * GEWICHT_JE_PAKET_KG;
  const hinweis = kuerzen(e.hinweis ?? o.hinweis, 57);
  return {
    PickupCreationRequest: {
      RatePickupIndicator: "N",
      Shipper: { Account: { AccountNumber: (o.upsKonto || konto).trim().toUpperCase(), AccountCountryCode: "DE" } },
      PickupDateInfo: { ReadyTime: (f.von ?? "09:00").replace(":", ""), CloseTime: (f.bis ?? "17:00").replace(":", ""), PickupDate: e.datum.replace(/-/g, "") },
      PickupAddress: {
        CompanyName: kuerzen(o.name, 27),
        ContactName: kuerzen(o.kontakt, 22),
        AddressLine: [kuerzen(`${o.strasse} ${o.hausnr}`, 35)],
        City: kuerzen(o.ort, 30),
        PostalCode: o.plz,
        CountryCode: "DE",
        ResidentialIndicator: "N",
        Phone: { Number: kuerzen(o.telefon.replace(/[^\d+]/g, ""), 25) },
      },
      AlternateAddressIndicator: "N",
      PickupPiece: [{ ServiceCode: "011", Quantity: String(Math.max(1, e.pakete)), DestinationCountryCode: "DE", ContainerCode: "01" }],
      TotalWeight: { Weight: String(Math.round(gewicht * 10) / 10), UnitOfMeasurement: "KGS" },
      OverweightIndicator: gewicht / Math.max(1, e.pakete) > 32 ? "Y" : "N",
      PaymentMethod: "01",
      ...(hinweis ? { SpecialInstruction: hinweis } : {}),
    },
  };
}

export function upsAntwortLesen(j: unknown): AbholErgebnis | null {
  const prn = (j as { PickupCreationResponse?: { PRN?: string } })?.PickupCreationResponse?.PRN;
  return prn ? { status: "gebucht", bestaetigung: prn, datum: null, abholArt: null, kostenpflichtig: null } : null;
}

export function upsFehlerText(status: number, j: unknown): string {
  if (status === 401 || status === 403) return "UPS lehnt den Zugang ab – Client-ID/Secret und Freischaltung der Pickup-API prüfen (Anbindungen → UPS).";
  const errs = (j as { response?: { errors?: { code?: string; message?: string }[] } })?.response?.errors ?? [];
  return `UPS: ${errs.length ? errs.map((e) => [e.code, e.message].filter(Boolean).join(" ")).join(" · ").slice(0, 400) : `Fehler ${status}`}`;
}

// ── Vorschlag ──────────────────────────────────────────────────────────────

/** Vorschlag „Abholung buchen?“: mehr als n fertige Labels heute und für den nächsten Abholtag noch nichts gebucht. */
export const vorschlagNoetig = (o: { labels: number; schwelle: number; gebucht: boolean }) => o.labels > o.schwelle && !o.gebucht;
