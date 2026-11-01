// Kleinanzeigen-Entwurf aus einem eBay-Angebot (Vorschlag vom 01.11.): Titel, Text, Preis, Kategorie-Vorschlag und
// Bilder zum Kopieren – eingestellt wird von Hand in der Kleinanzeigen-App. Keine Schnittstelle, kein Bot, kein Login.
// Reine Logik (getestet in tests/kleinanzeigen.test.ts).

/** Kleinanzeigen erlaubt 65 Zeichen im Titel und 4.000 in der Beschreibung, bis zu 20 Bilder, Preis in ganzen Euro. */
export const KA_TITEL_MAX = 65;
export const KA_TEXT_MAX = 4000;
export const KA_BILDER_MAX = 20;
export const KA_EINSTELLEN_URL = "https://www.kleinanzeigen.de/p-anzeige-aufgeben.html";

export type KaQuelle = {
  title: string;
  price: number;
  categoryName: string | null;
  conditionName: string | null;
  conditionId: string | null;
  images: string[];
  descriptionText: string;
  aspects: Record<string, string[]>;
  brand: string | null;
  ean: string | null;
};

export type KaEntwurf = {
  titel: string;
  text: string;
  preis: number;
  preisText: string;
  preisArt: "Festpreis" | "VB";
  kategorie: string | null;
  zustand: string;
  bilder: string[];
  hinweise: string[];
};

/** Kategorie-Vorschlag aus der eBay-Kategorie bzw. dem Titel (Kleinanzeigen-Hauptkategorie > Unterkategorie). */
const KATEGORIEN: [RegExp, string][] = [
  [/kopfhörer|headphone|earbud|lautsprecher|speaker|hifi|hi-fi|audio|soundbar|verstärker/i, "Elektronik > Audio & Hifi"],
  [/smartphone|handy|mobiltelefon|iphone|telefon/i, "Elektronik > Handy & Telefon"],
  [/notebook|laptop|macbook/i, "Elektronik > Notebooks"],
  [/tablet|ipad|e-?reader|kindle/i, "Elektronik > Tablets & Reader"],
  [/\bpc\b|computer|monitor|tastatur|maus\b|drucker|festplatte|ssd|usb|router|netzwerk/i, "Elektronik > PC-Zubehör & Software"],
  [/konsole|playstation|xbox|nintendo|videospiel|gaming/i, "Elektronik > Konsolen"],
  [/kamera|objektiv|foto|camcorder|drohne/i, "Elektronik > Foto"],
  [/fernseher|\btv\b|beamer|projektor|receiver/i, "Elektronik > TV & Video"],
  [/staubsauger|kaffee|espresso|wasserkocher|toaster|mixer|küchenmaschine|haushaltsgerät|bügeleisen|föhn|haartrockner|heißluftfritteuse|airfryer/i, "Elektronik > Haushaltsgeräte"],
  [/pfanne|topf|messer|geschirr|besteck|backform|küche|kochen|gläser|tasse/i, "Haus & Garten > Küche & Esszimmer"],
  [/werkzeug|bohr|akkuschrauber|säge|schleif|zange|schrauben/i, "Haus & Garten > Werkzeug"],
  [/garten|rasen|pflanze|grill|bewässerung/i, "Haus & Garten > Gartenzubehör & Pflanzen"],
  [/lampe|leuchte|deko|kerze|bilderrahmen|teppich|vorhang/i, "Haus & Garten > Dekoration"],
  [/bad|dusche|handtuch|wc\b/i, "Haus & Garten > Badezimmer"],
  [/uhr|armbanduhr|schmuck|kette|ring\b|ohrring/i, "Mode & Beauty > Schmuck & Accessoires"],
  [/kosmetik|parfum|pflege|rasierer|zahnbürste|epilierer|beauty|haarschneide/i, "Mode & Beauty > Beauty & Gesundheit"],
  [/schuh|sneaker|stiefel/i, "Mode & Beauty > Schuhe"],
  [/jacke|hose|shirt|pullover|kleid|socken|mantel|bekleidung/i, "Mode & Beauty > Bekleidung"],
  [/tasche|rucksack|koffer|geldbörse/i, "Mode & Beauty > Taschen & Accessoires"],
  [/spielzeug|lego|puppe|puzzle|brettspiel|playmobil|kinder/i, "Familie, Kind & Baby > Spielzeug"],
  [/baby|kinderwagen|schnuller|windel/i, "Familie, Kind & Baby > Baby-Ausstattung"],
  [/fahrrad|e-bike|fahrradzubehör/i, "Auto, Rad & Boot > Fahrräder & Zubehör"],
  [/auto|kfz|reifen|felge|motorrad/i, "Auto, Rad & Boot > Autoteile & Reifen"],
  [/sport|fitness|hantel|yoga|camping|zelt|angel/i, "Freizeit, Hobby & Nachbarschaft > Sport & Camping"],
  [/hund|katze|tier|aquarium|vogel/i, "Haustiere > Haustierbedarf"],
  [/buch|bücher|roman|film|dvd|blu-?ray|musik|cd\b|vinyl/i, "Musik, Filme & Bücher"],
];

export function kategorieVorschlag(categoryName: string | null, titel: string): string | null {
  for (const quelle of [categoryName ?? "", titel]) {
    for (const [re, kat] of KATEGORIEN) if (re.test(quelle)) return kat;
  }
  return null;
}

/** Zustand in Kleinanzeigen-Worten (Neu, Sehr gut, Gut, In Ordnung, Defekt). */
export function zustandText(name: string | null, id: string | null): string {
  const n = (name ?? "").toLowerCase();
  // „Neu: Sonstige“ (1500) und „Neu mit Fehlern“ (1750) zuerst – sonst greift das „Neu“-Muster.
  if (id === "1500" || id === "1750" || /neu: sonstige|neu mit fehlern|neuwertig|open box|new other/.test(n)) return "Sehr gut";
  if (id === "1000" || /^neu|^new|brand new|originalverpackt/.test(n)) return "Neu";
  if (id === "7000" || /defekt|for parts|ersatzteil/.test(n)) return "Defekt";
  if (/sehr gut|very good|like new|wie neu/.test(n)) return "Sehr gut";
  if (/gut|good|gebraucht|used/.test(n)) return "Gut";
  return "Gut";
}

/** Titel auf 65 Zeichen: an einer Wortgrenze kürzen, eBay-Füllwörter („NEU“, „OVP“, „Blitzversand“) weg. */
export function kaTitel(titel: string): string {
  const t = titel
    .replace(/\b(blitzversand|top[\s-]angebot|sale|händler|rechnung mit mwst\.?|versand kostenlos|kostenloser versand|gratis versand)\b/gi, " ")
    .replace(/[|*#★✓✔]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= KA_TITEL_MAX) return t;
  const schnitt = t.slice(0, KA_TITEL_MAX + 1);
  const wort = schnitt.lastIndexOf(" ");
  return (wort > KA_TITEL_MAX * 0.6 ? schnitt.slice(0, wort) : t.slice(0, KA_TITEL_MAX)).replace(/[\s,;:–-]+$/, "");
}

/** eBay-spezifische Sätze entfernen (Kaufabwicklung, Bewertungen, „bei eBay“). */
function ohneEbay(text: string): string {
  return text
    .split(/\n+/)
    .map((z) => z.trim())
    .filter((z) => z && !/\bebay\b|kaufabwicklung|bewertung|sofort[\s-]?kaufen|zahlung per|paypal|artikelstandort|versandkosten|lieferzeit|widerruf|agb|impressum|rücknahme/i.test(z))
    .join("\n");
}

/** Preis in ganzen Euro (Kleinanzeigen kennt keine Cent): kaufmännisch gerundet. */
export const kaPreis = (eur: number) => Math.max(1, Math.round(eur));

/** Entwurf für Kleinanzeigen aus den Daten des eBay-Angebots. */
export function kleinanzeigenEntwurf(q: KaQuelle, o: { preisArt?: "Festpreis" | "VB"; versand?: boolean; abholungOrt?: string | null; gewerblich?: boolean } = {}): KaEntwurf {
  const titel = kaTitel(q.title);
  const zustand = zustandText(q.conditionName, q.conditionId);
  const merkmale = Object.entries(q.aspects)
    .filter(([k, v]) => v.length && !/^(ean|gtin|upc|isbn|mpn|herstellernummer|produktart|nicht zutreffend)$/i.test(k) && !v.every((x) => /nicht zutreffend|does not apply|n\/a/i.test(x)))
    .slice(0, 12)
    .map(([k, v]) => `• ${k}: ${v.slice(0, 3).join(", ")}`);
  const beschreibung = ohneEbay(q.descriptionText).slice(0, 2500);
  const teile = [
    titel !== q.title.trim() ? q.title.trim() : null,
    `Zustand: ${zustand}${zustand === "Neu" ? " und originalverpackt" : ""}.`,
    beschreibung || null,
    merkmale.length ? `Eigenschaften:\n${merkmale.join("\n")}` : null,
    [o.versand !== false ? "Versand möglich." : null, o.abholungOrt ? `Abholung in ${o.abholungOrt} möglich.` : null].filter(Boolean).join(" ") || null,
    o.gewerblich !== false ? "Gewerblicher Verkauf – Rechnung mit ausgewiesener MwSt." : null,
  ].filter((x): x is string => Boolean(x));
  let text = teile.join("\n\n");
  if (text.length > KA_TEXT_MAX) text = `${text.slice(0, KA_TEXT_MAX - 1).replace(/\s+\S*$/, "")}…`;
  const preis = kaPreis(q.price);
  const preisArt = o.preisArt ?? "Festpreis";
  const hinweise: string[] = [];
  if (q.title.trim().length > KA_TITEL_MAX) hinweise.push(`Titel auf ${KA_TITEL_MAX} Zeichen gekürzt.`);
  if (q.images.length > KA_BILDER_MAX) hinweise.push(`Nur die ersten ${KA_BILDER_MAX} von ${q.images.length} Bildern.`);
  if (!q.images.length) hinweise.push("Keine Bilder im eBay-Angebot – Fotos selbst aufnehmen.");
  if (Math.abs(preis - q.price) >= 0.01) hinweise.push(`Preis auf ganze Euro gerundet (eBay ${q.price.toFixed(2).replace(".", ",")} €).`);
  if (o.gewerblich !== false) hinweise.push("Im Kleinanzeigen-Konto als gewerblicher Anbieter einstellen (Pflicht für Händler laut Kleinanzeigen).");
  const kategorie = kategorieVorschlag(q.categoryName, q.title);
  if (!kategorie) hinweise.push("Kategorie bitte in der App wählen – kein sicherer Vorschlag.");
  return { titel, text, preis, preisText: `${preis} €${preisArt === "VB" ? " VB" : ""}`, preisArt, kategorie, zustand, bilder: q.images.slice(0, KA_BILDER_MAX), hinweise };
}
