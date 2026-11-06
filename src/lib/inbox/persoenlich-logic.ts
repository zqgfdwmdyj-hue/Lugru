// Persönliche Mails (Bauauftrag 06.11.): Erkennung „persönlich“ / „persönlich?“, Massen- und Systemmails, Anrede
// (Sie/Du), Termin-Bezug (Absage, Verschiebung, Vorschlag, Bestätigung – auch „morgen“, „Montag“), Antwortentwurf als
// Vorlage und Thread-Zuordnung. Reine Logik ohne Datenbank, damit mit Beispielmails testbar.

import { datumsangaben, uhrzeitNach } from "@/lib/private/termin-mail";

// --- Massen-, System- und Rollen-Adressen --------------------------------------------------------------------------

/** Kopfzeilen, die Massen-/Systemmails kennzeichnen. */
export type MassenKopf = { listUnsubscribe?: string | null; listId?: string | null; precedence?: string | null; autoSubmitted?: string | null };

const NOREPLY = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|postmaster|bounce[s]?|notifications?|notify|newsletter|news|mailing|marketing|alerts?)([._+-]|@)/i;

/** „noreply@…“, „newsletter@…“, „mailer-daemon@…“ u. ä. */
export const istNoReply = (adresse: string) => NOREPLY.test(adresse.toLowerCase().replace(/^.*?</, "").replace(/>.*$/, ""));

/** Newsletter, Werbung, Systemmails: Listen-/Bulk-Kopf, Auto-Submitted, noreply-Absender, Abmelde-Link im Text. */
export function istMassenmail(k: MassenKopf, absender: string, text = ""): boolean {
  if (k.listUnsubscribe?.trim() || k.listId?.trim()) return true;
  if (/^(bulk|list|junk)$/i.test(k.precedence?.trim() ?? "")) return true;
  if (k.autoSubmitted && !/^no$/i.test(k.autoSubmitted.trim())) return true;
  if (istNoReply(absender)) return true;
  return /\b(abmelden|abbestellen|newsletter abbestellen|unsubscribe|vom newsletter abmelden|e-mail-einstellungen ändern|manage (your )?preferences)\b/i.test(text.slice(-1500));
}

// --- Persönlich oder geschäftlich? ---------------------------------------------------------------------------------

/** Ganze Wörter (auch mit Umlauten – \\b kennt nur ASCII). */
const W = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, "iu");

/** Private Mail-Anbieter (Absender mit solcher Adresse ist meist eine Person). */
const FREEMAIL = /@(gmail\.com|googlemail\.com|web\.de|gmx\.(de|net|at|ch)|t-online\.de|icloud\.com|me\.com|mac\.com|outlook\.(de|com)|hotmail\.(de|com)|live\.(de|com)|yahoo\.(de|com)|freenet\.de|posteo\.(de|net)|mailbox\.org|aol\.(de|com)|arcor\.de|online\.de|mail\.de|vodafone\.de|email\.de|kabelmail\.de|protonmail\.(com|ch)|proton\.me)$/i;
/** Funktionsadressen (info@, rechnung@ …) – eher Firma als Person. */
const ROLLE = /^(info|kontakt|contact|office|mail|service|support|hello|hallo|team|sales|vertrieb|verkauf|einkauf|buchhaltung|rechnung(en)?|billing|invoice|order(s)?|bestellung(en)?|shop|admin|webmaster|presse|jobs|karriere|hr)@/i;
const FIRMA = W("gmbh|ag|ug|kg|ohg|gbr|e\\.\\s?k\\.?|ltd\\.?|inc\\.?|llc|shop|store|team|support|kundenservice|kundendienst|service-?center|vertrieb|großhandel|wholesale|handel|verlag|bank|versicherung\\p{L}*|kanzlei|steuerberat\\p{L}*|rechtsanw\\p{L}*|sparkasse|stadtwerke");
const PRAXIS = W("praxis|zahnarzt|arzt|ärztin|tierarzt|physio\\p{L}*|therap\\p{L}*|heilpraktik\\p{L}*|osteopath\\p{L}*|logopäd\\p{L}*|ergotherap\\p{L}*|friseur\\p{L}*|kosmetik\\p{L}*|massage\\p{L}*|fußpflege|podolog\\p{L}*|coach\\p{L}*|hebamme|kita|kindergarten|schule|nachhilfe|musikschule|trainer(?:in)?|dr\\.");
const PRIVAT_INHALT = W("termin\\p{L}*|absage|absagen|abgesagt|verschieben|verlegen|krank|erkältet|gute besserung|geburtstag|treffen|vorbeikommen|familie|kinder|wochenende|urlaub|privat|rezept|befund|behandlung|sitzung");
const GESCHAEFT_INHALT = W("asin|amazon|ebay|temu|bestellnummer|order(?:-?nummer)?|auftragsnummer|rechnungsnummer|lieferschein|angebot|preisliste|großhandel|wholesale|b2b|palette[n]?|sendungsnummer|tracking|seller|marktplatz|händler|wareneingang|einkaufspreis|mindestmenge|moq|ust-?id|invoice|purchase order");

export type Inhaber = { vorname: string; nachname: string } | null;

/** Name aus „Vorname Nachname“ (für Anrede-Erkennung und Unterschrift). */
export function nameTeile(name: string | null | undefined): Inhaber {
  const t = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!t.length) return null;
  return { vorname: t[0], nachname: t.length > 1 ? t[t.length - 1] : "" };
}

/** Sieht der Anzeigename nach einer Person aus („Petra Probe“, nicht „Shop Team“ oder „info“)? */
export function siehtNachPersonAus(name: string | null | undefined): boolean {
  const n = (name ?? "").replace(/["']/g, "").trim();
  if (!n || FIRMA.test(n) || /\d|@/.test(n)) return false;
  const teile = n.split(/[\s,]+/).filter(Boolean);
  return teile.length >= 2 && teile.length <= 4 && teile.every((t) => /^[A-ZÄÖÜ][a-zäöüß'-]+\.?$|^(von|van|de|der|zu|dr\.?)$/i.test(t));
}

export type Einstufung = { stufe: "persoenlich" | "unsicher" | "nein"; punkte: number; gruende: string[] };

/**
 * Persönlich (Person, Praxis, Dienstleister, Familie) oder geschäftlich? Punkte: private Adresse, Personen-Name,
 * Praxis/Dienstleister, persönliche Anrede an den Inhaber, privater Inhalt (+); Firma, Funktionsadresse, geschäftlicher
 * Inhalt (−). Ab 3 Punkten persönlich, 1–2 „persönlich?“ (zur Bestätigung), sonst nicht.
 */
export function persoenlichEinstufen(m: { adresse: string; name: string | null; betreff: string; text: string; inhaber: Inhaber }): Einstufung {
  const adresse = m.adresse.trim().toLowerCase();
  const text = `${m.betreff}\n${m.text}`.slice(0, 5000);
  const kopfText = text.slice(0, 600);
  let p = 0;
  const g: string[] = [];
  const plus = (n: number, grund: string) => {
    p += n;
    g.push(`${n > 0 ? "+" : ""}${n} ${grund}`);
  };
  if (FREEMAIL.test(adresse)) plus(2, "private Mail-Adresse");
  if (siehtNachPersonAus(m.name)) plus(1, "Absender ist eine Person");
  if (PRAXIS.test(`${m.name ?? ""} ${adresse} ${text.slice(-800)}`)) plus(2, "Praxis/Dienstleister");
  const inh = m.inhaber;
  if (inh?.vorname && new RegExp(`\\b(hallo|hi|hey|liebe[rs]?|guten (morgen|tag|abend)|moin|servus)\\s+${escape(inh.vorname)}\\b`, "i").test(kopfText)) plus(2, "persönliche Anrede");
  else if (inh?.nachname && new RegExp(`\\b(herr|frau)\\s+${escape(inh.nachname)}\\b`, "i").test(kopfText)) plus(1, "Anrede mit Namen");
  if (PRIVAT_INHALT.test(text)) plus(2, "privater Inhalt (Termin, Absage …)");
  if (ROLLE.test(adresse)) plus(-2, "Funktionsadresse");
  if (FIRMA.test(m.name ?? "")) plus(-2, "Firmenname");
  if (GESCHAEFT_INHALT.test(text)) plus(-3, "geschäftlicher Inhalt");
  return { stufe: p >= 3 ? "persoenlich" : p >= 1 ? "unsicher" : "nein", punkte: p, gruende: g };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- Anrede ------------------------------------------------------------------------------------------------------

/** Sie oder Du – aus der Mail selbst und früherem Schriftverkehr (eigene Antworten zuerst). Sonst „Sie“. */
export function anredeAus(o: { eingang: string; frueher?: string[]; gemerkt?: "du" | "sie" | null }): "du" | "sie" {
  if (o.gemerkt === "du" || o.gemerkt === "sie") return o.gemerkt;
  for (const t of o.frueher ?? []) {
    const k = t.slice(0, 400);
    if (/^\s*(hallo|hi|hey|liebe[rs]?|moin|servus)\s+[A-ZÄÖÜ][a-zäöüß]+\s*[,!]/im.test(k)) return "du";
    if (/^\s*(sehr geehrte[rs]?|guten tag)\b/im.test(k)) return "sie";
  }
  const e = o.eingang.slice(0, 2000);
  const du = (e.match(/\b(du|dich|dir|dein(e[mnrs]?)?|euch|eure?)\b/g) ?? []).length;
  const sie = (e.match(/\b(Sie|Ihnen|Ihr(e[mnrs]?)?)\b/g) ?? []).length;
  if (du > sie && du >= 1) return "du";
  return "sie";
}

// --- Termin-Bezug -------------------------------------------------------------------------------------------------

export type TerminArtPersoenlich = "absage" | "verschiebung" | "vorschlag" | "bestaetigung";
export type TerminBezug = { art: TerminArtPersoenlich; tag: string | null; uhrzeit: string | null; neuerTag: string | null; neueUhrzeit: string | null };

const WOCHENTAGE = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Tag-Angaben mit Position: genaue Daten und „heute“, „morgen“, „übermorgen“, „(am) Montag“, „nächsten Dienstag“. */
export function tageImText(text: string, heute: string): { iso: string; pos: number }[] {
  const out = [...datumsangaben(text, heute)];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])(heute|morgen|übermorgen|uebermorgen)(?![\p{L}\p{N}])/giu)) {
    const w = m[1].toLowerCase();
    // „morgen früh“ bleibt morgen; „heute morgen“ ist heute.
    if (w === "morgen" && /heute\s+$/i.test(text.slice(Math.max(0, (m.index ?? 0) - 7), m.index ?? 0))) continue;
    out.push({ iso: plusTage(heute, w === "heute" ? 0 : w === "morgen" ? 1 : 2), pos: m.index ?? 0 });
  }
  const wt = new Date(Date.parse(`${heute}T12:00:00Z`)).getUTCDay();
  for (const m of text.matchAll(/\b(?:am\s+|nächsten\s+|kommenden\s+|diesen\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/gi)) {
    const ziel = WOCHENTAGE.indexOf(m[1].toLowerCase());
    let diff = (ziel - wt + 7) % 7;
    if (diff === 0 || /nächsten|kommenden/i.test(m[0])) diff = diff === 0 ? 7 : diff;
    out.push({ iso: plusTage(heute, diff), pos: m.index ?? 0 });
  }
  return out.sort((a, b) => a.pos - b.pos).filter((x, i, a) => a.findIndex((y) => y.iso === x.iso && Math.abs(y.pos - x.pos) < 4) === i);
}

/**
 * Termin-Bezug einer persönlichen Mail: Absage („muss den Termin morgen leider absagen, bin krank“), Verschiebung,
 * neuer Vorschlag („Hätten Sie Dienstag um 10 Uhr Zeit?“) oder Bestätigung. null = kein Termin-Bezug.
 */
export function terminBezug(text: string, heute: string): TerminBezug | null {
  const t = text.slice(0, 4000);
  if (!/\btermin|absag|absage|absagen|verschieb|verleg|treffen|vorbeikommen|zeit hätten|zeit haben|passt (es )?ihnen|passt (es )?dir|sitzung|stunde|behandlung|uhr\b/i.test(t)) return null;
  const tage = tageImText(t, heute);
  const zeit = (pos: number) => uhrzeitNach(t, pos);
  const absage = /(absag|absagen|abgesagt|muss .{0,40}ausfallen|fällt .{0,20}aus|kann .{0,40}nicht (kommen|wahrnehmen|stattfinden)|leider nicht kommen|bin krank|krank geworden|erkrankt)/i.test(t);
  const verschiebung = /(verschieb|verleg|stattdessen|anderen termin|neuen termin|später kommen|früher kommen|umbuchen)/i.test(t);
  const vorschlag = /(hätten sie .{0,40}zeit|hättest du .{0,40}zeit|passt (es )?(ihnen|dir)|wie wäre es|ginge (es )?(bei ihnen|bei dir)?|könnten wir uns|wollen wir uns|vorschlag|treffen wir uns)/i.test(t);
  const bestaetigung = /(bestätig|freue mich auf|bis (morgen|dann|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)|ist notiert|ist eingetragen|geht klar|passt mir)/i.test(t);
  const erster = tage[0] ?? null;
  const letzter = tage[tage.length - 1] ?? null;
  if (absage && !(verschiebung && tage.length > 1)) {
    return { art: "absage", tag: erster?.iso ?? null, uhrzeit: erster ? zeit(erster.pos) : null, neuerTag: null, neueUhrzeit: null };
  }
  if (verschiebung) {
    const alt = tage.length > 1 ? tage[0] : null;
    const neu = tage.length > 1 ? letzter : vorschlag ? letzter : null;
    return { art: "verschiebung", tag: alt?.iso ?? (neu ? null : erster?.iso ?? null), uhrzeit: alt ? zeit(alt.pos) : null, neuerTag: neu?.iso ?? null, neueUhrzeit: neu ? zeit(neu.pos) : null };
  }
  if (vorschlag && letzter) return { art: "vorschlag", tag: null, uhrzeit: null, neuerTag: letzter.iso, neueUhrzeit: zeit(letzter.pos) };
  if (bestaetigung && erster) return { art: "bestaetigung", tag: erster.iso, uhrzeit: zeit(erster.pos), neuerTag: null, neueUhrzeit: null };
  return null;
}

/**
 * Welcher Termin im Privatkalender ist gemeint? Gleicher Tag und Name (Nachname/Vorname/Adresse des Absenders im Titel,
 * bei „mit“ oder in den Notizen). Ohne Tag: der nächste geplante Termin dieser Person in 14 Tagen. Nur eindeutig.
 */
export function terminFinden<T extends { id: string; data: { day: string; time?: string; title?: string; notes?: string; with?: string; status?: string } }>(
  termine: T[],
  o: { tag: string | null; name: string | null; adresse: string; heute: string },
): T | null {
  const woerter = [...new Set([...(o.name ?? "").split(/[\s,]+/), o.adresse.split("@")[0].replace(/[._-]+/g, " ")].flatMap((x) => x.split(/\s+/)).map((x) => x.toLowerCase()).filter((x) => x.length >= 3 && !/^(frau|herr|dr|praxis|team)$/.test(x)))];
  const passt = (e: T) => {
    const hay = `${e.data.title ?? ""} ${e.data.notes ?? ""} ${e.data.with ?? ""}`.toLowerCase();
    return woerter.some((w) => hay.includes(w));
  };
  const aktiv = termine.filter((e) => e.data.status !== "ausgefallen");
  if (o.tag) {
    const amTag = aktiv.filter((e) => e.data.day === o.tag);
    const mitName = amTag.filter(passt);
    if (mitName.length === 1) return mitName[0];
    return null;
  }
  const bis = plusTage(o.heute, 14);
  const kommend = aktiv.filter((e) => e.data.day >= o.heute && e.data.day <= bis && passt(e)).sort((a, b) => a.data.day.localeCompare(b.data.day) || (a.data.time ?? "").localeCompare(b.data.time ?? ""));
  return kommend[0] ?? null;
}

// --- Freie Termine für den Entwurf -------------------------------------------------------------------------------

/** Zwei (n) freie Stunden-Slots an den nächsten Werktagen 09–17 Uhr, die keinen Privat-Termin überschneiden. */
export function freieSlots(belegt: { day: string; time?: string; to?: string }[], heute: string, n = 2): { tag: string; uhrzeit: string }[] {
  const out: { tag: string; uhrzeit: string }[] = [];
  const min = (u: string) => Number(u.slice(0, 2)) * 60 + Number(u.slice(3, 5));
  for (let d = 1; d <= 14 && out.length < n; d++) {
    const tag = plusTage(heute, d);
    const wt = new Date(Date.parse(`${tag}T12:00:00Z`)).getUTCDay();
    if (wt === 0 || wt === 6) continue;
    const amTag = belegt.filter((b) => b.day === tag && b.time);
    for (const h of [10, 14]) {
      const start = h * 60;
      const frei = amTag.every((b) => {
        const s = min(b.time!);
        const e = b.to ? min(b.to) : s + 60;
        return e <= start || s >= start + 60;
      });
      if (frei) {
        out.push({ tag, uhrzeit: `${String(h).padStart(2, "0")}:00` });
        break;
      }
    }
  }
  return out;
}

// --- Entwurf -----------------------------------------------------------------------------------------------------

const WT_LANG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export const tagText = (iso: string) => `${WT_LANG[new Date(Date.parse(`${iso}T12:00:00Z`)).getUTCDay()]}, ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Grußzeile: „Guten Tag Petra Probe,“ (Sie, ohne bekanntes Geschlecht) bzw. „Hallo Petra,“ (Du). */
export function begruessung(anrede: "du" | "sie", name: string | null, adresse: string): string {
  const n = (name ?? "").replace(/["']/g, "").trim();
  const teile = n.split(/\s+/).filter(Boolean);
  if (anrede === "du") return `Hallo ${teile[0] ?? adresse.split("@")[0]},`;
  const herrFrau = /^(frau|herr)\s+/i.exec(n);
  if (herrFrau) return `${herrFrau[1].toLowerCase() === "frau" ? "Sehr geehrte" : "Sehr geehrter"} ${n},`;
  return teile.length ? `Guten Tag ${n},` : "Guten Tag,";
}

/**
 * Entwurf ohne KI (Ersatz, wenn keine KI eingerichtet ist oder sie nicht antwortet): kurz, freundlich, mit
 * Unterschrift. Offene Punkte in eckigen Klammern.
 */
export function entwurfVorlage(o: { anrede: "du" | "sie"; name: string | null; adresse: string; termin: TerminBezug | null; slots: { tag: string; uhrzeit: string }[]; unterschrift: string; frage?: boolean }): string {
  const du = o.anrede === "du";
  const zeilen = [begruessung(o.anrede, o.name, o.adresse), ""];
  const t = o.termin;
  const slotText = o.slots.length ? (du ? ` Wie wäre es mit ${o.slots.map((s) => `${tagText(s.tag)} um ${s.uhrzeit} Uhr`).join(" oder ")}?` : ` Mir würde ${o.slots.map((s) => `${tagText(s.tag)} um ${s.uhrzeit} Uhr`).join(" oder ")} passen.`) : "";
  if (t?.art === "absage") {
    zeilen.push(du ? "danke dir für die Nachricht – gute Besserung!" : "vielen Dank für Ihre Nachricht – gute Besserung!");
    zeilen.push(du ? `Lass uns gern einen neuen Termin ausmachen.${slotText}` : `Gern vereinbaren wir einen neuen Termin.${slotText}`);
  } else if (t?.art === "verschiebung" || t?.art === "vorschlag") {
    const neu = t.neuerTag ? `${tagText(t.neuerTag)}${t.neueUhrzeit ? ` um ${t.neueUhrzeit} Uhr` : ""}` : "[Termin]";
    zeilen.push(du ? `danke dir! ${neu} passt mir [bitte prüfen].` : `vielen Dank für Ihre Nachricht. ${neu} passt mir [bitte prüfen].`);
  } else if (t?.art === "bestaetigung") {
    const wann = t.tag ? `${tagText(t.tag)}${t.uhrzeit ? ` um ${t.uhrzeit} Uhr` : ""}` : "[Termin]";
    zeilen.push(du ? `danke, ${wann} ist notiert – bis dann!` : `vielen Dank, ${wann} ist notiert. Ich freue mich auf den Termin.`);
  } else {
    zeilen.push(du ? "danke dir für deine Nachricht." : "vielen Dank für Ihre Nachricht.");
    zeilen.push("[Antwort ergänzen]");
  }
  zeilen.push("", du ? "Viele Grüße" : "Freundliche Grüße", o.unterschrift);
  return zeilen.join("\n");
}

/** Ein Satz Zusammenfassung ohne KI: erster Satz mit Inhalt (ohne Anrede). */
export function zusammenfassungVorlage(text: string): string {
  const ohneAnrede = text.replace(/^\s*(hallo|hi|hey|liebe[rs]?|sehr geehrte[rs]?|guten (morgen|tag|abend)|moin|servus)[^\n,]*,?\s*/i, "");
  const satz = /[^.!?\n]{8,}[.!?]/.exec(ohneAnrede)?.[0] ?? ohneAnrede.slice(0, 140);
  return satz.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Auftrag an die KI: Zusammenfassung + Antwortentwurf als JSON. Persönliche Inhalte gehen nur an die KI, nie in Kanäle. */
export function entwurfPrompt(o: { art: "persoenlich" | "geschaeftlich"; von: string; name: string | null; betreff: string; text: string; anrede: "du" | "sie"; termin: TerminBezug | null; slots: { tag: string; uhrzeit: string }[]; unterschrift: string; kontext?: string }): string {
  return [
    `Schreibe einen Antwortentwurf für eine ${o.art === "persoenlich" ? "persönliche" : "geschäftliche"} Mail.`,
    "Antworte nur mit JSON: {\"zusammenfassung\": \"ein Satz, worum es geht\", \"entwurf\": \"fertiger Antworttext\"}.",
    `Regeln: Deutsch, kurz und freundlich. Anrede: ${o.anrede === "du" ? "Du" : "Sie"} (Grußzeile passend, bei Sie mit Vor- und Nachname, wenn das Geschlecht unklar ist). Unterschrift: ${o.unterschrift}.`,
    "Bei Absage wegen Krankheit: Dank, gute Besserung, Angebot für einen neuen Termin. Bei Terminbestätigung: kurz mit Datum/Uhrzeit bestätigen. Bei Rückfragen: beantworten, soweit die Angaben reichen – sonst Platzhalter in eckigen Klammern, z. B. [Uhrzeit]. Nichts erfinden.",
    o.termin ? `Erkannter Termin-Bezug: ${o.termin.art}${o.termin.tag ? `, Termin ${o.termin.tag}${o.termin.uhrzeit ? ` ${o.termin.uhrzeit}` : ""}` : ""}${o.termin.neuerTag ? `, neuer Termin ${o.termin.neuerTag}${o.termin.neueUhrzeit ? ` ${o.termin.neueUhrzeit}` : ""}` : ""}.` : "Kein Termin-Bezug erkannt.",
    o.slots.length ? `Freie Termine zum Vorschlagen: ${o.slots.map((s) => `${tagText(s.tag)} ${s.uhrzeit} Uhr`).join(" oder ")}.` : "Keine freien Termine vorschlagen.",
    o.kontext ? `Kontext: ${o.kontext}` : "",
    `Absender: ${o.name ? `${o.name} ` : ""}<${o.von}>`,
    `Betreff: ${o.betreff}`,
    "Mail:",
    o.text.slice(0, 6000),
  ]
    .filter(Boolean)
    .join("\n");
}

/** KI-Antwort lesen (JSON, auch in ```-Blöcken). Ungültig → null. */
export function entwurfLesen(roh: string): { zusammenfassung: string; entwurf: string } | null {
  const json = /\{[\s\S]*\}/.exec(roh.replace(/```(json)?/g, ""))?.[0];
  if (!json) return null;
  try {
    const j = JSON.parse(json) as { zusammenfassung?: unknown; entwurf?: unknown };
    const entwurf = typeof j.entwurf === "string" ? j.entwurf.trim() : "";
    if (!entwurf) return null;
    return { zusammenfassung: typeof j.zusammenfassung === "string" ? j.zusammenfassung.trim().slice(0, 200) : "", entwurf: entwurf.slice(0, 8000) };
  } catch {
    return null;
  }
}

// --- Thread ------------------------------------------------------------------------------------------------------

/** Betreff ohne „Re:“, „AW:“, „WG:“, „Fwd:“ – für die Zuordnung, wenn In-Reply-To fehlt. */
export const betreffKern = (s: string) => s.replace(/^\s*((re|aw|wg|fw|fwd|antw)\s*(\[\d+\])?\s*:\s*)+/gi, "").replace(/\s+/g, " ").trim().toLowerCase();

/** „Re: …“ für die Antwort (nicht doppelt). */
export const antwortBetreff = (s: string) => (/^\s*(re|aw)\s*:/i.test(s) ? s.trim() : `Re: ${s.trim()}`).slice(0, 300);

/** Adresse aus „Name <a@b>“ bzw. „a@b“ (klein). */
export const adresseAus = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase();
