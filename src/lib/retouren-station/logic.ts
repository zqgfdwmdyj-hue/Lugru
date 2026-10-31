// Retouren-Station – reine Logik ohne Datenbank und ohne Browser, damit testbar:
// Codes (LPN/FNSKU/EAN), Sprachbefehle, Entscheidung „Fall ja/nein“, Verbleib, RET-SKU, Lieferschein-Abgleich,
// Ansagen und Dateinamen fürs Fall-Paket.

import type { RetourenBefund, RetourenEntscheidung, RetourenMedienArt, RetourenVerbleib, RetourenZeile } from "@/db/tables/retouren-station";

// ---- Codes -----------------------------------------------------------------------------------------

/** LPN laut eigenen Daten: „LPN“ + 2 Buchstaben + 9 Ziffern, Groß-/Kleinschreibung gemischt (LPNHe052177380). */
export const LPN_RE = /^LPN[A-Za-z]{2}\d{9}$/;
const LPN_IN_TEXT = /LPN[A-Za-z]{2}\d{9}/;
const FNSKU_RE = /^X00[A-Z0-9]{7}$/;
const ASIN_RE = /^B0[A-Z0-9]{8}$/;

export type CodeArt = "lpn" | "fnsku" | "asin" | "ean";
export type Code = { art: CodeArt; wert: string };

/** Prüfziffer von EAN-8/UPC-A/EAN-13/GTIN-14. */
export function eanGueltig(s: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(s)) return false;
  const d = s.split("").map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((n, x, i) => n + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Was wurde gescannt? Kamera, Handscanner (Tastatur-Eingabe) oder KI liefern eine Zeichenkette; die LPN darf
 * auch mitten im Text stehen (z. B. „]C1LPNHK535208835“ mit Scanner-Präfix).
 */
export function erkenneCode(roh: string | null | undefined): Code | null {
  const s = (roh ?? "").replace(/[\s\u0000-\u001f]/g, "");
  if (!s) return null;
  const lpn = LPN_IN_TEXT.exec(s)?.[0] ?? (/^lpn[a-z]{2}\d{9}$/i.test(s) ? `LPN${s.slice(3)}` : null);
  if (lpn) return { art: "lpn", wert: lpn };
  const up = s.toUpperCase();
  if (FNSKU_RE.test(up)) return { art: "fnsku", wert: up };
  if (ASIN_RE.test(up)) return { art: "asin", wert: up };
  if (eanGueltig(s)) return { art: "ean", wert: s.length === 12 ? `0${s}` : s };
  return null;
}

// ---- Sprachbefehle ---------------------------------------------------------------------------------

export type Befehl =
  | { befehl: "neues_paket" }
  | { befehl: "etikett" }
  | { befehl: "lieferschein" }
  | { befehl: "produkt" }
  | { befehl: "foto" }
  | { befehl: "zustand"; befund: RetourenBefund }
  | { befehl: "notiz"; text: string }
  | { befehl: "naechstes" }
  | { befehl: "fertig" }
  | { befehl: "nochmal" }
  | { befehl: "loeschen" }
  | { befehl: "abbrechen" }
  | { befehl: "wiederholen" }
  | { befehl: "hilfe" }
  | { befehl: "code"; wert: string }
  | { befehl: "remission"; wert: string | null }
  | { befehl: "verbleib"; verbleib: RetourenVerbleib };

/** Kleinbuchstaben, Umlaute ausgeschrieben, ohne Satzzeichen – so vergleicht die Erkennung. */
export function normalisiere(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function abstand(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Ein Wort passt, wenn es gleich ist oder (ab 5 Buchstaben) um einen Buchstaben abweicht – „Etiket“, „Lieferschain“. */
function wortPasst(gehoert: string, soll: string): boolean {
  if (gehoert === soll) return true;
  if (soll.length < 5) return false;
  return abstand(gehoert, soll) <= (soll.length >= 9 ? 2 : 1);
}

/** Wie viele Wörter am Anfang von `w` die Phrase belegt (0 = passt nicht). Zusammengeschrieben zählt auch. */
function phraseAmAnfang(w: string[], phrase: string): number {
  const p = phrase.split(" ");
  if (w.length >= p.length && p.every((x, i) => wortPasst(w[i], x))) return p.length;
  if (p.length > 1 && w.length >= 1 && wortPasst(w[0], p.join(""))) return 1;
  return 0;
}

const FUELLWOERTER = new Set(["aeh", "aehm", "hm", "aehh", "also", "so", "jetzt", "dann", "bitte", "ok", "okay", "und"]);

type Regel = { phrasen: string[]; machen: (rest: string[], roh: string) => Befehl | null };

const BEFUND_PHRASEN: [RetourenBefund, string[]][] = [
  ["falsches_produkt", ["falsches produkt", "falscher artikel", "anderes produkt", "anderer artikel", "falsche ware", "falsches teil"]],
  ["unvollstaendig", ["unvollstaendig", "nicht vollstaendig", "teile fehlen", "zubehoer fehlt", "es fehlt was"]],
  ["beschaedigt", ["beschaedigt", "kaputt", "defekt", "zerbrochen", "gebrochen"]],
  ["benutzt", ["benutzt", "gebraucht", "getragen", "verschmutzt", "dreckig"]],
  ["leer", ["leer", "karton leer", "packung leer", "verpackung leer", "nichts drin"]],
  ["ok", ["ok", "okay", "o k", "gut", "in ordnung", "einwandfrei", "neu", "neuwertig", "verkaeuflich"]],
];

const VERBLEIB_PHRASEN: [RetourenVerbleib, string[]][] = [
  ["fba", ["fba", "einlagern", "wieder einlagern", "amazon", "zurueck zu amazon"]],
  ["b_ware", ["b ware", "bware", "b-ware", "zweite wahl"]],
  ["ebay", ["ebay", "e bay"]],
  ["entsorgen", ["entsorgen", "muell", "wegwerfen", "entsorgung"]],
  ["hersteller", ["hersteller", "garantie", "reklamation", "zurueck an hersteller"]],
];

const ZAHLWORT: Record<string, string> = { null: "0", eins: "1", ein: "1", zwei: "2", zwo: "2", drei: "3", vier: "4", fuenf: "5", sechs: "6", sieben: "7", acht: "8", neun: "9" };

/** „x null null a b c eins zwei …“ → „X00ABC12…“ (buchstabierte SKU/FNSKU per Sprache). */
export function buchstabiert(woerter: string[]): string {
  return woerter.map((w) => ZAHLWORT[w] ?? w).join("").toUpperCase();
}

function befundAus(rest: string[]): RetourenBefund | null {
  for (const [b, ps] of BEFUND_PHRASEN) for (const p of ps) if (phraseAmAnfang(rest, p)) return b;
  return null;
}

const REGELN: Regel[] = [
  { phrasen: ["neues paket", "neuer karton", "naechstes paket", "neue remission", "neues packet"], machen: () => ({ befehl: "neues_paket" }) },
  { phrasen: ["etikett", "label", "aufkleber", "versandetikett", "adressaufkleber", "versandlabel"], machen: () => ({ befehl: "etikett" }) },
  { phrasen: ["lieferschein", "packzettel", "packliste", "packing slip", "beipackzettel"], machen: () => ({ befehl: "lieferschein" }) },
  { phrasen: ["naechstes produkt", "naechster artikel", "naechstes", "weiter"], machen: () => ({ befehl: "naechstes" }) },
  { phrasen: ["produkt", "artikel", "lpn", "scannen", "scan"], machen: () => ({ befehl: "produkt" }) },
  { phrasen: ["inhalt", "foto", "bild", "noch ein foto", "aufnahme", "noch ein bild"], machen: () => ({ befehl: "foto" }) },
  {
    phrasen: ["zustand", "befund"],
    machen: (rest) => {
      const b = befundAus(rest);
      return b ? { befehl: "zustand", befund: b } : null;
    },
  },
  {
    phrasen: ["notiz", "anmerkung", "kommentar", "bemerkung"],
    machen: (_rest, roh) => {
      // Freitext: alles nach dem Schlüsselwort, so wie gesprochen (Groß-/Kleinschreibung bleibt).
      const m = /(notiz|anmerkung|kommentar|bemerkung)[\s,:.-]*(.*)$/i.exec(roh);
      const text = (m?.[2] ?? "").trim();
      return text ? { befehl: "notiz", text } : null;
    },
  },
  { phrasen: ["paket fertig", "fertig", "abschliessen", "erledigt", "fertig mit dem paket"], machen: () => ({ befehl: "fertig" }) },
  { phrasen: ["nochmal", "noch mal", "neu aufnehmen", "noch einmal"], machen: () => ({ befehl: "nochmal" }) },
  { phrasen: ["loeschen", "foto loeschen", "weg damit"], machen: () => ({ befehl: "loeschen" }) },
  { phrasen: ["abbrechen", "zurueck", "stopp", "stop"], machen: () => ({ befehl: "abbrechen" }) },
  { phrasen: ["wiederholen", "was hast du gesagt", "wie bitte", "nochmal sagen"], machen: () => ({ befehl: "wiederholen" }) },
  { phrasen: ["hilfe", "befehle", "was kann ich sagen"], machen: () => ({ befehl: "hilfe" }) },
  {
    phrasen: ["sku", "fnsku", "f n s k u", "s k u", "ean", "code"],
    machen: (rest) => {
      const wert = buchstabiert(rest);
      return wert.length >= 4 ? { befehl: "code", wert } : null;
    },
  },
  {
    phrasen: ["remission", "remissionsauftrag", "auftrag"],
    machen: (rest) => {
      const r = rest.filter((w) => w !== "manuell" && w !== "nummer" && w !== "nr");
      return { befehl: "remission", wert: r.length ? buchstabiert(r) : null };
    },
  },
  {
    phrasen: ["verbleib", "ziel", "geht an", "kommt zu"],
    machen: (rest) => {
      for (const [v, ps] of VERBLEIB_PHRASEN) for (const p of ps) if (phraseAmAnfang(rest, p)) return { befehl: "verbleib", verbleib: v };
      return null;
    },
  },
];

/**
 * Gesprochenen Satz in einen Befehl übersetzen. Mit Aktivierungswort zählt nur, was danach kommt („Station
 * Etikett“). Befunde gehen auch ohne „Zustand“ („leer“, „benutzt“) – nur „OK“ braucht „Zustand OK“ bzw.
 * „in Ordnung“, weil „okay“ im Gespräch ständig fällt. Nichts erkannt → null.
 */
export function erkenneBefehl(gesprochen: string, opts: { aktivierungswort?: string | null } = {}): Befehl | null {
  let woerter = normalisiere(gesprochen).split(" ").filter(Boolean);
  let roh = gesprochen;
  const aw = opts.aktivierungswort ? normalisiere(opts.aktivierungswort) : "";
  if (aw) {
    const i = woerter.findIndex((w) => wortPasst(w, aw));
    if (i < 0) return null;
    woerter = woerter.slice(i + 1);
    const at = roh.toLowerCase().indexOf(opts.aktivierungswort!.toLowerCase());
    roh = at >= 0 ? roh.slice(at + opts.aktivierungswort!.length) : roh;
  }
  while (woerter.length && FUELLWOERTER.has(woerter[0]) && woerter.length > 1) woerter.shift();
  if (!woerter.length) return null;
  for (const r of REGELN) {
    for (const p of r.phrasen) {
      const n = phraseAmAnfang(woerter, p);
      if (n) {
        const b = r.machen(woerter.slice(n), roh);
        if (b) return b;
      }
    }
  }
  // Befund ohne „Zustand“ – außer „ok/gut/neu“ (zu allgemein).
  const b = befundAus(woerter);
  if (b && b !== "ok") return { befehl: "zustand", befund: b };
  if (phraseAmAnfang(woerter, "in ordnung") || phraseAmAnfang(woerter, "einwandfrei")) return { befehl: "zustand", befund: "ok" };
  // Gescannt statt gesprochen? (LPN, FNSKU, EAN als Wort)
  const code = erkenneCode(gesprochen.replace(/\s+/g, "")) ?? erkenneCode(woerter.join(""));
  if (code) return { befehl: "code", wert: code.wert };
  return null;
}

export const HILFE_TEXT =
  "Befehle: Neues Paket, Etikett, Lieferschein, Produkt, Foto, Zustand OK, leer, falsches Produkt, benutzt, beschädigt, unvollständig, Notiz und Text, Nächstes Produkt, Fertig. Außerdem: Nochmal, Löschen, Abbrechen, Wiederholen, Remission manuell, SKU und Code, Verbleib.";

// ---- Entscheidung ----------------------------------------------------------------------------------

export const BEFUND_TEXT: Record<RetourenBefund, string> = {
  ok: "einwandfrei",
  leer: "leer (kein Artikel in der Verpackung)",
  falsches_produkt: "falsches Produkt zurückgeschickt",
  benutzt: "benutzt / mit Gebrauchsspuren",
  beschaedigt: "beschädigt",
  unvollstaendig: "unvollständig (Teile/Zubehör fehlen)",
};
export const BEFUND_KURZ: Record<RetourenBefund, string> = { ok: "OK", leer: "leer", falsches_produkt: "falsches Produkt", benutzt: "benutzt", beschaedigt: "beschädigt", unvollstaendig: "unvollständig" };

export const ENTSCHEIDUNG_TEXT: Record<RetourenEntscheidung, string> = {
  fall: "Fall bei Amazon",
  kein_fall: "kein Fall (einwandfrei)",
  zu_klein: "unter der Schwelle – nur dokumentiert",
  schon_erstattet: "Amazon hat schon erstattet",
  laeuft_schon: "Fall läuft schon",
  ohne_retoure: "keine Kundenretoure zugeordnet",
  warten: "Erstattung an den Kunden noch nicht in den Daten",
};

export type EntscheidungEingabe = {
  befund: RetourenBefund | null;
  /** Kundenretoure (Bestellung) bekannt? Ohne Bestellnummer gibt es keinen Fall. */
  bestellnummer: string | null;
  /** An den Kunden erstattet; null = (noch) unbekannt. */
  erstattet: number | null;
  /** Von Amazon für diese Bestellung schon gezahlt (Erstattungsbericht). */
  amazonGezahlt: number | null;
  /** Ein eingereichter/abgeschlossener Anspruch zu dieser Bestellung existiert schon. */
  laufenderFall: boolean;
  schwelle: number;
};

/**
 * Fall ja/nein. Ein Fall nur, wenn Befund ≠ OK, eine Kundenretoure zugeordnet ist, der Kunde mindestens die
 * Schwelle erstattet bekam und Amazon noch nichts gezahlt hat. Der Befund des Menschen zählt – nie die KI.
 */
export function entscheide(e: EntscheidungEingabe): RetourenEntscheidung | null {
  if (!e.befund) return null;
  if (e.befund === "ok") return "kein_fall";
  if (!e.bestellnummer) return "ohne_retoure";
  if ((e.amazonGezahlt ?? 0) > 0) return "schon_erstattet";
  if (e.laufenderFall) return "laeuft_schon";
  if (e.erstattet === null) return "warten";
  if (e.erstattet < e.schwelle) return "zu_klein";
  return "fall";
}

/** Anspruchsart: falsches Produkt wie im Retouren-Abgleich, alles andere „Retoure leer/benutzt/beschädigt“. */
export const anspruchsArt = (b: RetourenBefund) => (b === "falsches_produkt" ? ("return_wrong_item" as const) : ("return_condition" as const));

// ---- Verbleib --------------------------------------------------------------------------------------

export const VERBLEIB_TEXT: Record<RetourenVerbleib, string> = { fba: "wieder bei Amazon einlagern", b_ware: "B-Ware", ebay: "über eBay verkaufen", entsorgen: "entsorgen", hersteller: "an den Hersteller" };

/** Vorschlag, wohin der Artikel geht. KI-Gebrauchsspuren nur als Hinweis (der Mensch bestätigt per „Verbleib …“). */
export function verbleibVorschlag(befund: RetourenBefund | null, opts: { gebrauchsspuren?: string | null; grund?: string | null } = {}): RetourenVerbleib | null {
  if (!befund || befund === "leer" || befund === "falsches_produkt") return null;
  if (befund === "ok") return opts.gebrauchsspuren === "leicht" || opts.gebrauchsspuren === "deutlich" ? "b_ware" : "fba";
  if (befund === "beschaedigt") return /defect|defekt|not_working|quality/i.test(opts.grund ?? "") ? "hersteller" : "entsorgen";
  if (befund === "benutzt") return opts.gebrauchsspuren === "deutlich" ? "b_ware" : "ebay";
  return "ebay"; // unvollständig
}

// ---- RET-SKU ---------------------------------------------------------------------------------------

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** „RET_3_LPNHK535208835_14APR26_FBA“ – Zähler, LPN (sonst FNSKU), Datum TTMONJJ, Kanal. */
export function retSku(o: { zaehler: number; lpn: string | null; fnsku?: string | null; datum: string; kanal: "FBA" | "FBM" }): string {
  const [y, m, d] = o.datum.slice(0, 10).split("-").map(Number);
  const tag = `${String(d).padStart(2, "0")}${MON[m - 1]}${String(y % 100).padStart(2, "0")}`;
  const kennung = (o.lpn || o.fnsku || "OHNE").replace(/[^A-Za-z0-9]/g, "");
  return `RET_${Math.max(1, Math.round(o.zaehler))}_${kennung}_${tag}_${o.kanal}`;
}

/** Nächster Zähler: höchster bisheriger RET-Zähler derselben ASIN + 1 (aus vorhandenen SKUs). */
export function naechsterZaehler(vorhandene: string[]): number {
  const n = vorhandene.map((s) => /^RET_(\d+)_/i.exec(s.trim())?.[1]).filter(Boolean).map(Number);
  return (n.length ? Math.max(...n) : 0) + 1;
}

// ---- Lieferschein-Abgleich -------------------------------------------------------------------------

const k = (z: RetourenZeile) => (z.fnsku || z.sku || z.titel || "").toUpperCase().trim();

/** Erwartete Positionen (Remissionsauftrag) gegen gelesene (Lieferschein) – Ansage-taugliche Abweichungen. */
export function vergleicheLieferschein(erwartet: RetourenZeile[], gelesen: RetourenZeile[]): string[] {
  const out: string[] = [];
  const passt = (e: RetourenZeile, g: RetourenZeile) =>
    Boolean((e.fnsku && g.fnsku && e.fnsku.toUpperCase() === g.fnsku.toUpperCase()) || (e.sku && g.sku && e.sku.toUpperCase() === g.sku.toUpperCase()) || (e.titel && g.titel && normalisiere(g.titel).includes(normalisiere(e.titel).split(" ").slice(0, 2).join(" "))));
  const genutzt = new Set<number>();
  for (const e of erwartet) {
    const i = gelesen.findIndex((g, j) => !genutzt.has(j) && passt(e, g));
    const name = e.titel ? e.titel.split(" ").slice(0, 3).join(" ") : k(e);
    if (i < 0) {
      out.push(`Position ${name} fehlt auf dem Lieferschein`);
      continue;
    }
    genutzt.add(i);
    if (gelesen[i].menge !== e.menge) out.push(`Position ${name}: Lieferschein ${gelesen[i].menge}, erwartet ${e.menge}`);
  }
  gelesen.forEach((g, j) => {
    if (!genutzt.has(j)) out.push(`Unerwartete Position ${g.titel ? g.titel.split(" ").slice(0, 3).join(" ") : k(g)} auf dem Lieferschein`);
  });
  return out;
}

// ---- Ansagen ---------------------------------------------------------------------------------------

// Normales Leerzeichen vor „€“ (Ansage und Anzeige gleich).
const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }).replace(/\u00a0/g, " ");
const kurz = (t: string | null | undefined, w = 3) => (t ?? "").split(/\s+/).slice(0, w).join(" ");

export const GRUND_TEXT: Record<string, string> = {
  DEFECTIVE: "defekt",
  QUALITY_UNACCEPTABLE: "Qualität",
  NOT_AS_DESCRIBED: "nicht wie beschrieben",
  DAMAGED_BY_CARRIER: "beim Versand beschädigt",
  DAMAGED_BY_FC: "im Lager beschädigt",
  UNWANTED_ITEM: "nicht mehr gewollt",
  NO_REASON_GIVEN: "ohne Grund",
  ORDERED_WRONG_ITEM: "falsch bestellt",
  SWITCHEROO: "anderer Artikel",
  MISSING_PARTS: "Teile fehlen",
  APPAREL_TOO_SMALL: "zu klein",
  APPAREL_TOO_LARGE: "zu groß",
  FOUND_BETTER_PRICE: "woanders günstiger",
  EXTRA_ITEM: "Artikel übrig",
  UNDELIVERABLE_UNKNOWN: "unzustellbar",
};
export const grundText = (g: string | null | undefined) => (g ? (GRUND_TEXT[g.toUpperCase()] ?? g.toLowerCase().replace(/_/g, " ")) : null);

export function ansageEtikett(remission: string | null, erwartet: number | null): string {
  if (!remission) return "Etikett gelesen, keine Remission gefunden. Sage Remission manuell.";
  return `Remission ${remission}${erwartet ? `, ${erwartet} Position${erwartet === 1 ? "" : "en"} erwartet` : ""}.`;
}

export function ansageProdukt(p: { titel: string | null; grund: string | null; erstattet: number | null; zuordnung: string; amazonGezahlt?: number | null }): string {
  if (p.zuordnung === "unbekannt") return "Kein Code erkannt. Code zeigen oder SKU sagen.";
  const teile = [kurz(p.titel) || "Artikel"];
  if (p.zuordnung === "lpn") {
    teile.push(p.grund ? `Grund: ${grundText(p.grund)}` : "kein Grund");
    teile.push(p.erstattet !== null ? `erstattet ${eur(p.erstattet)}` : "Erstattung unbekannt");
    if ((p.amazonGezahlt ?? 0) > 0) teile.push("Amazon hat schon gezahlt");
  } else teile.push("ohne Kundenretoure");
  return `${teile.join(", ")}.`;
}

export function ansageBefund(befund: RetourenBefund, entscheidung: RetourenEntscheidung | null, betrag: number | null, kiWarnung: string | null): string {
  const t = `${BEFUND_KURZ[befund]} gespeichert.`;
  const e = entscheidung === "fall" && betrag !== null ? ` Fall über ${eur(betrag)}.` : entscheidung && entscheidung !== "kein_fall" ? ` ${ENTSCHEIDUNG_TEXT[entscheidung]}.` : "";
  return `${t}${e}${kiWarnung ? ` Achtung: ${kiWarnung}` : ""}`;
}

export function zusammenfassung(positionen: { befund: RetourenBefund | null; entscheidung: RetourenEntscheidung | null; erstattet: number | null }[]): string {
  if (!positionen.length) return "Paket ohne Artikel abgeschlossen.";
  const ok = positionen.filter((p) => p.befund === "ok").length;
  const faelle = positionen.filter((p) => p.entscheidung === "fall");
  const summe = faelle.reduce((n, p) => n + (p.erstattet ?? 0), 0);
  const ohne = positionen.filter((p) => !p.befund).length;
  const teile = [`${ok} OK`];
  if (faelle.length) teile.push(`${faelle.length} Fall${faelle.length === 1 ? "" : "e"} über ${eur(summe)}`);
  const sonst = positionen.length - ok - faelle.length - ohne;
  if (sonst > 0) teile.push(`${sonst} ohne Fall`);
  if (ohne) teile.push(`${ohne} ohne Befund`);
  return `${teile.join(", ")}.`;
}

// ---- KI-Abweichung ---------------------------------------------------------------------------------

/** Warnung, wenn die KI-Einschätzung dem gesprochenen Befund widerspricht (z. B. „Bild zeigt anderes Produkt“). */
export function kiWarnung(befund: RetourenBefund, ki: { passt?: string; vorschlag_befund?: string; gebrauchsspuren?: string; vollstaendig?: string } | null | undefined): string | null {
  if (!ki) return null;
  if (befund !== "falsches_produkt" && ki.passt === "nein") return "Bild zeigt anderes Produkt – bitte bestätigen.";
  if (befund === "falsches_produkt" && ki.passt === "ja") return "Bild passt zum Produkt – bitte bestätigen.";
  if (befund === "ok" && ki.gebrauchsspuren === "deutlich") return "Bild zeigt deutliche Gebrauchsspuren – bitte bestätigen.";
  if (befund === "ok" && ki.vollstaendig === "nein") return "Bild wirkt unvollständig – bitte bestätigen.";
  if (befund === "leer" && ki.vorschlag_befund && ki.vorschlag_befund !== "leer" && ki.passt === "ja") return "Bild zeigt einen Artikel – bitte bestätigen.";
  return null;
}

// ---- Fall-Paket ------------------------------------------------------------------------------------

const ART_NAME: Record<Exclude<RetourenMedienArt, "video">, [number, string]> = { etikett: [1, "Versandetikett"], lieferschein: [2, "Lieferschein"], produkt_lpn: [3, "Produkt_LPN"], inhalt: [4, "Inhalt"] };

/** Fotos in der von Amazon verlangten Reihenfolge mit festen Namen: 1_Versandetikett.jpg … 4_Inhalt_1.jpg. */
export function fallDateien<T extends { art: RetourenMedienArt; nr: number; aufgenommenAm: Date | string }>(medien: T[]): { name: string; medium: T }[] {
  const fotos = medien.filter((m): m is T & { art: Exclude<RetourenMedienArt, "video"> } => m.art !== "video");
  const sortiert = [...fotos].sort((a, b) => ART_NAME[a.art][0] - ART_NAME[b.art][0] || a.nr - b.nr || String(a.aufgenommenAm).localeCompare(String(b.aufgenommenAm)));
  const anzahl = new Map<string, number>();
  for (const m of sortiert) anzahl.set(m.art, (anzahl.get(m.art) ?? 0) + 1);
  const zaehler = new Map<string, number>();
  return sortiert.map((m) => {
    const [n, name] = ART_NAME[m.art];
    const i = (zaehler.get(m.art) ?? 0) + 1;
    zaehler.set(m.art, i);
    const mehrere = (anzahl.get(m.art) ?? 0) > 1 || m.art === "inhalt";
    return { name: `${n}_${name}${mehrere ? `_${i}` : ""}.jpg`, medium: m };
  });
}

/** Pflicht-Fotoarten für ein Fall-Paket. */
export const PFLICHT_FOTOS: Exclude<RetourenMedienArt, "video">[] = ["etikett", "lieferschein", "produkt_lpn", "inhalt"];
export const fehlendeFotos = (arten: RetourenMedienArt[]) => PFLICHT_FOTOS.filter((a) => !arten.includes(a));
