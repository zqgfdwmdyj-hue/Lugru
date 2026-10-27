import type { PriceBox } from "@/db/schema";
import { hasSeveralPrices, plausibleBox, printedAmounts, type PrintedInfo } from "@/lib/printed-price";

// Eine gemeinsame Preislogik für Produktliste, Prüfen, Collage, Aushang, Messenger und Social Media.
// Grundsatz: Ausgegeben wird immer die gespeicherte Spendenempfehlung. Ein im Foto erkannter Preis oder ein
// KI-Vorschlag überstimmt sie nie still – Abweichungen erscheinen unter „Prüfen“, bis jemand entscheidet.
// Ohne Server- und Datenbankabhängigkeiten, damit es im Browser läuft und testbar ist.

/** Neutrale Kategorie für frisch hochgeladene Fotos – die KI darf sie ersetzen, bestätigte Kategorien nicht. */
export const UNSORTED_CATEGORY = "Noch zuordnen";

// ---------- Abgabeeinheit ----------

export const UNITS = {
  stueck: { label: "Einzelstück", hint: "z. B. ein Riegel, eine Dose" },
  packung: { label: "Mehrfachpackung", hint: "z. B. 6er-Pack" },
  karton: { label: "Karton", hint: "ganzer Karton / ganze Kiste" },
} as const;
export type Unit = keyof typeof UNITS;
export const isUnit = (v: unknown): v is Unit => typeof v === "string" && v in UNITS;

export type UnitInfo = { unit: string | null; unitCount: number | null; priceNote?: string | null };

/** „Einzelstück“, „6er-Pack“, „Karton (24 Stück)“ – leer, wenn keine Einheit festgelegt ist. */
export function unitLabel(unit: string | null | undefined, count: number | null | undefined): string {
  const n = count && count > 1 ? count : null;
  if (unit === "stueck") return "Einzelstück";
  if (unit === "packung") return n ? `${n}er-Pack` : "Packung";
  if (unit === "karton") return n ? `Karton (${n} Stück)` : "Karton";
  return "";
}

/**
 * Was vor dem Preis steht: der freie Zusatz („je 6er Pack“), sonst aus der Abgabeeinheit („je“, „6er-Pack“,
 * „Karton (24 St.)“). So steht es gleich in Collage, Aushang, Messenger und Social Media.
 */
export function pricePrefix(i: UnitInfo): string {
  const note = i.priceNote?.trim();
  if (note) return note;
  const n = i.unitCount && i.unitCount > 1 ? i.unitCount : null;
  if (i.unit === "stueck") return "je";
  if (i.unit === "packung") return n ? `${n}er-Pack` : "Packung";
  if (i.unit === "karton") return n ? `Karton (${n} St.)` : "Karton";
  return "";
}

/**
 * Abgabeeinheit aus bisherigem Zusatz oder Variante raten – nur als Vorschlag, wird nie still gespeichert.
 * Nur eindeutige Angaben zählen: „6er-Pack“, „6 x 125 g“, „10 Stück“, „Karton mit 24 Dosen“. Maße („68 x 64 cm“),
 * Gewichte („240 g“), Altersangaben („3–6 Jahre“, „ab 6 Monaten“) und Modellnummern ergeben nie eine Stückzahl.
 */
export function guessUnit(priceNote: string | null | undefined, variant: string | null | undefined): { unit: Unit; count: number | null; sure: boolean } | null {
  let t = ` ${priceNote ?? ""} ${variant ?? ""} `.toLowerCase().replace(/,/g, ".");
  if (!t.trim()) return null;
  // Erst alles entfernen, was nach Zahl aussieht, aber keine Stückzahl ist.
  t = t
    .replace(/\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?(?:\s*[x×*]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|m)\b/g, " ") // Maße 68 x 64 cm
    .replace(/\d+(?:\.\d+)?\s*(?:mm|cm|m|zoll|")(?![a-zäöü])/g, " ")
    .replace(/(?:ab\s*)?\d+\s*(?:[-–]|bis)\s*\d+\s*(?:jahre?n?|j\.|monate?n?|m\.|mon\.)/g, " ") // Altersbereiche
    .replace(/ab\s*\d+\s*(?:jahre?n?|j\.|monate?n?|m\.|mon\.)/g, " ")
    .replace(/\b(?:art(?:ikel)?|modell|model|nr|typ|ref|ean|gr(?:öße)?)\.?\s*[-:#]?\s*[a-z]*\d[\w-]*/g, " ") // Modell-/Artikelnummern, Größen
    .replace(/\b[a-z]+\d+[\w-]*|\b\d+[a-z]{2,}\d[\w-]*/g, " "); // z. B. „A123“, „12ab34“
  const multi = /(\d{1,3})\s*[x×]\s*\d+(?:\.\d+)?\s*(?:kg|g|gr|ml|cl|l|stück|stk)(?![a-zäöü])/.exec(t);
  const pack = /(\d{1,3})\s*er[\s-]*(?:pack|packung|pck|set|tray|beutel|karton|kiste)?(?![a-zäöü0-9])/.exec(t) ?? /(\d{1,3})[\s-]*(?:pack|packung)(?![a-zäöü])/.exec(t) ?? /(?:pack|packung|set|karton|kiste)\s*(?:mit|à|a)\s*(\d{1,3})/.exec(t);
  const pieces = /(\d{1,3})\s*(?:stück|stk\.?|st\.|kapseln|beutel|riegel|dosen|flaschen|rollen|tüten|gläser|päckchen)(?![a-zäöü])/.exec(t);
  const count = [multi, pack, pieces].map((m) => (m ? Number(m[1]) : 0)).find((n) => n > 1 && n <= 500) ?? null;
  // „sure“: eindeutige Stückzahl. Einzelstück- und Karton-ohne-Anzahl-Vorschläge bleiben unsicher.
  if (/karton|kiste|\btray\b|palette/.test(t)) return { unit: "karton", count, sure: !!count };
  if (count) return { unit: "packung", count, sure: true };
  if (/einzel|\bje\b|\b1\s*(?:stück|stk|st\.)|\bstück\b/.test(t)) return { unit: "stueck", count: null, sure: false };
  return null;
}

// ---------- Packungsgrößen vergleichen ----------

/** Gesamtmenge aus „240 g“, „1,5 l“, „6 x 125 g“, „5×23g“ – in g bzw. ml. */
export function parseSize(text: string | null | undefined): { total: number; base: "g" | "ml" } | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, ".");
  const unit = (u: string) => (u === "kg" ? [1000, "g"] : u === "g" || u === "gr" ? [1, "g"] : u === "l" ? [1000, "ml"] : u === "cl" ? [10, "ml"] : [1, "ml"]) as [number, "g" | "ml"];
  const multi = /(\d{1,3})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|gr|g|ml|cl|l)(?![a-zäöü])/.exec(t);
  if (multi) {
    const [f, base] = unit(multi[3]);
    return { total: Number(multi[1]) * Number(multi[2]) * f, base };
  }
  const single = /(\d+(?:\.\d+)?)\s*(kg|gr|g|ml|cl|l)(?![a-zäöü])/.exec(t);
  if (!single) return null;
  const [f, base] = unit(single[2]);
  const total = Number(single[1]) * f;
  return total > 0 ? { total, base } : null;
}

const fmtSize = (s: { total: number; base: string }) => (s.total >= 1000 ? `${String(+(s.total / 1000).toFixed(2)).replace(".", ",")} ${s.base === "g" ? "kg" : "l"}` : `${Math.round(s.total)} ${s.base}`);

/** Hinweise der KI, dass das Ergebnis nicht genau passt. */
const UNSURE = /unbekannt|unsicher|alternativ|ähnlich|nicht (?:exakt|genau|eindeutig)|vermutlich|nächst|nicht gefunden|keine genaue|möglicherweise|evtl\.|eventuell|ungefähr|nicht sicher|andere (?:größe|packung)/i;

export type Comparability = { level: "passt" | "abweichend" | "unklar"; reason: string };

/**
 * Passt der Handelspreis bzw. KI-Vorschlag zur eigenen Packung? Nur „passt“ gilt als vergleichbar.
 * Beispiel: eigenes Produkt 240 g, Angebot 77 g → „abweichend“.
 */
export function comparability(ownVariant: string | null | undefined, check: { recognizedVariant?: string | null; summary?: string | null; offers?: { title: string; shop?: string }[] | null }, packCount?: number | null): Comparability {
  // Abgabe als Packung (z. B. 5er-Pack à 23 g): verglichen wird die ganze Packung.
  const single = parseSize(ownVariant);
  const own = single && packCount && packCount > 1 && !/\d\s*[x×]\s*\d/.test(ownVariant ?? "") ? { ...single, total: single.total * packCount } : single;
  const offers = check.offers ?? [];
  const fresh = offers.filter((o) => !isSecondHand(o.title, o.shop));
  // Nur B-Ware/Gebrauchtes gefunden – kein fairer Vergleich mit Neuware.
  if (offers.length && !fresh.length) return { level: "abweichend", reason: "nur B-Ware/gebraucht im Handel gefunden – nicht vergleichbar" };
  const offerTitle = fresh[0]?.title ?? "";
  const other = parseSize(offerTitle) ?? parseSize(check.recognizedVariant);
  const summary = cleanAiText(check.summary);
  const unsure = summary ? UNSURE.exec(summary) : null;
  if (own && other && own.base === other.base) {
    const ratio = other.total / own.total;
    if (ratio < 0.9 || ratio > 1.1) return { level: "abweichend", reason: `Handel ${fmtSize(other)}, eigenes Produkt ${fmtSize(own)}` };
    if (unsure) return { level: "unklar", reason: `KI-Hinweis: „${sentenceAround(summary, unsure.index)}“` };
    return { level: "passt", reason: `gleiche Größe (${fmtSize(own)})` };
  }
  if (unsure) return { level: "unklar", reason: `KI-Hinweis: „${sentenceAround(summary, unsure.index)}“` };
  if (!own && !other) return { level: "unklar", reason: "Packungsgröße unbekannt" };
  if (!own) return { level: "unklar", reason: `Eigene Packungsgröße fehlt (Handel: ${fmtSize(other!)})` };
  return { level: "unklar", reason: `Größe im Handel unbekannt (eigenes Produkt: ${fmtSize(own)})` };
}

function sentenceAround(text: string, at: number): string {
  const start = Math.max(text.lastIndexOf(".", at - 1) + 1, 0);
  const endDot = text.indexOf(".", at);
  const s = text.slice(start, endDot < 0 ? text.length : endDot + 1).trim();
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

// ---------- Produktart: Lebensmittel oder nicht? ----------

/** Wörter mit „^“ nur am Wortanfang („^knete“ trifft nicht „Getrocknete“), sonst auch in Zusammensetzungen. */
const has = (t: string, words: string[]) =>
  words.find((w) => (w.startsWith("^") ? new RegExp(`(?:^|[^a-zäöüß])${w.slice(1)}`).test(t) : t.includes(w)))?.replace(/^\^/, "") ?? null;
/** Eindeutig keine Lebensmittel – egal, in welcher Kategorie sie (vielleicht falsch) stehen. */
const TOY = ["spielzeug", "plüsch", "puzzle", "malbuch", "spielkarten", "steckspiel", "seifenblasen", "kuscheltier", "bauklötze", "ball ", "puppe", "lego", "schwimmflügel", "schwimmsitz", "schwimmring", "schwimmreifen", "wasserspielzeug", "sandspielzeug", "badespielzeug", "wasserfarben", "farbkasten", "spardose", "^knete", "stifte", "furby", "sammelkarten", "figur", "bitzee", "baby einstein", "piano", "klavier", "rassel", "spieluhr", "tamagotchi", "kreisel", "roboter", "dinosaurier", "bilderbuch", "kinderbuch"];
const BABY_GEAR = ["babyflasche", "glasflasche", "trinkflasche", "milchflasche", "trinklernbecher", "sauger", "schnuller", "beißring", "windel", "feuchttücher", "lätzchen", "babybody", "strampler", "wärmflasche", "fieberthermometer", "nasensauger", "schwimm", "nuk ", "mam ", "avent", "bema "];
const SKIN = ["parfum", "parfüm", "eau de", "bodyspray", "körperspray", "duschschaum", "handseife", "hautcreme", "handcreme", "gesichtscreme", "sonnencreme", "wundschutzcreme", "babycreme", "bodylotion", "lotion", "gesichtsmaske", "tuchmaske", "sheet mask", "peeling", "serum", "lippenpflege", "lippenbalsam", "körperöl", "babyöl", "duschgel", "duschcreme", "seife", "badesalz", "badezusatz", "make-up", "makeup", "nagellack", "hautpflege", "yeauty"];
// „Hair“, „Styling“, „Gel“: Produkttyp schlägt Duft-/Sortenangaben wie „Bambus & Orange“.
const HAIR = ["haar", "hair", "styling", "^gel ", "festiger", "pomade", "haarwachs", "haarlack", "glanzspray", "lockenspray", "shampoo", "spülung", "haarkur", "haarspray", "haargel", "haarfarbe", "conditioner", "haaröl", "haarpflege", "haarmaske", "trockenshampoo"];
const DRUGSTORE = ["zahnpasta", "zahncreme", "zahnbürste", "zahnseide", "mundspülung", "^deo", "rasier", "pflaster", "tampons", "binden", "slipeinlagen", "wattepads", "wattestäbchen", "kondome", "desinfektion"];
const HOUSEHOLD = ["schwamm", "tuchschwämme", "spültuch", "spülmittel", "waschmittel", "weichspüler", "reiniger", "müllbeutel", "küchenrolle", "toilettenpapier", "taschentücher", "batterie", "kerze", "kugelschreiber", "teelicht", "brotdose", "frischhaltedose", "vorratsdose", "alufolie", "frischhaltefolie", "backpapier", "spülmaschinentabs", "geschirrtabs"];
/** Nahrungsergänzung und Tee (oft aus der Drogerie, aber mit MHD). */
const TEA_SUPPLEMENT = ["^tee ", "kräutertee", "früchtetee", "kamillentee", "pfefferminztee", "grüntee", "schwarztee", "teebeutel", "nahrungsergänzung", "vitamin", "magnesium", "zink", "brausetabletten", "omega-3", "eisen + ", "multivitamin", "probiotik"];
const SWEETS = ["schokolade", "gummibärchen", "fruchtgummi", "bonbon", "kaugummi", "lakritz", "chips", "flips", "jumpys", "salzstangen", "popcorn", "praline", "keks", "kekse", "waffel", "marshmallow", "lolli", "karamell", "knabber", "cracker", "erdnüsse", "studentenfutter", "müsliriegel", "schokoriegel", "fondant", "süßigkeit", "halley", "kinder riegel", "snack"];
const DRINKS = ["powerade", "gatorade", "red bull", "monster energy", "fanta", "sprite", "capri-sun", "capri sun", "sportgetränk", "isotonisch", "eistee", "mineralwasser", "wasser", "saft", "limonade", "^cola", "cola zero", "energy", "drink", "schorle", "sprudel", "smoothie", "^bier", "radler", "getränk", "nektar", "sirup", "eiskaffee"];
/**
 * Geschmack/Sorte („Mango“, „Apfel“, „Paprika“): sagt nur „essbar“, nie welche Lebensmittel-Kategorie – sonst würde
 * „Powerade Golden Mango“ zu Lebensmittel oder „Trinkschokoladenpulver“ zu Süßem.
 */
const FLAVOR = ["apfel", "birne", "banane", "pfirsich", "mango", "beere", "erdbeer", "himbeer", "kirsch", "zitrone", "orange", "vanille", "karamell", "frucht", "obst", "gemüse", "karotte", "möhre", "pastinake", "kürbis", "kartoffel", "paprika", "chili", "kräuter", "kokos", "nuss"];
/** Produkttypen und Marken für Lebensmittel (ohne Geschmacksangaben). */
const FOOD = ["trinkschokolade", "kakaopulver", "kakao", "pulver", "instant", "backmischung", "gewürz", "bbq", "barbecue", "pfeffer", "curry", "salz", "zimt", "oregano", "gyros", "grillgewürz", "sauce", "soße", "dressing", "brühe", "nudeln", "^reis", "mehl", "zucker", "öl", "essig", "senf", "ketchup", "honig", "marmelade", "riegel", "müsli", "haferflocken", "brei", "gläschen", "püree", "quetschie", "joghurt", "milch", "tee", "kaffee", "kapseln", "espresso", "zwieback", "brot", "dose", "konserve", "suppe", "linsen", "bohnen", "kichererbsen", "mais", "thunfisch", "pesto", "gnocchi", "tortellini", "wraps", "fruchtpüree", "babymilch", "anfangsmilch", "folgemilch", "hipp", "alete", "bebivita", "milupa", "aptamil", "humana", "holle", "freche freunde", "wiberg", "ostmann", "fuchs gewürze", "knorr", "maggi", "dessert", "pudding", "grieß", "pasta", "menü", "mahlzeit", "abendbrei", "milchbrei", "getreide", "dinkel", "hirse", "puffs", "sticks", "bällchen", "teekeks", "trinkmahlzeit", "babynahrung", "kindernahrung", "säuglingsnahrung"];

export type ProductKindName = "lebensmittel" | "suesses" | "getraenk" | "tee" | "babyzubehoer" | "hautpflege" | "haarpflege" | "drogerie" | "haushalt" | "spielzeug";
export type ProductKind = { kind: ProductKindName; word: string; flavorOnly?: boolean };
/** Lebensmittel im weiteren Sinn – brauchen ein MHD. */
const FOOD_KINDS = new Set<ProductKindName>(["lebensmittel", "suesses", "getraenk", "tee"]);
/** Passende Kategorie je Produktart (siehe DONATION_CATEGORIES). */
export const KIND_CATEGORY: Record<ProductKindName, string> = {
  lebensmittel: "Lebensmittel",
  suesses: "Süßes & Snacks",
  getraenk: "Getränke inkl. Pfand",
  tee: "Tee & Nahrungsergänzung",
  babyzubehoer: "Babyprodukte",
  // Haut- und Haarpflege gehören zur Drogerie (keine eigenen Kategorien).
  hautpflege: "Drogerie",
  haarpflege: "Drogerie",
  drogerie: "Drogerie",
  haushalt: "Haushalt",
  spielzeug: "Spielzeug",
};

/** Was für ein Produkt ist das – nach Name und Variante. null = nicht eindeutig. Nichtlebensmittel haben Vorrang. */
export function productKind(name: string | null | undefined, variant?: string | null): ProductKind | null {
  const t = ` ${name ?? ""} ${variant ?? ""} `.toLocaleLowerCase("de-DE");
  // Nichtlebensmittel zuerst: ein „Schoko-Duschgel“ ist Pflege, kein Süßes.
  const nonFood: [ProductKindName, string[]][] = [
    ["spielzeug", TOY],
    ["babyzubehoer", BABY_GEAR],
    ["hautpflege", SKIN],
    ["haarpflege", HAIR],
    ["drogerie", DRUGSTORE],
    ["haushalt", HOUSEHOLD],
  ];
  for (const [kind, words] of nonFood) {
    const w = has(t, words);
    if (w) return { kind, word: w.trim() };
  }
  // Lebensmittel: der längste Produkttyp gewinnt („trinkschokolade“ vor „schokolade“, „powerade“ statt „mango“).
  const food: [ProductKindName, string[]][] = [
    ["getraenk", DRINKS],
    ["tee", TEA_SUPPLEMENT],
    ["suesses", SWEETS],
    ["lebensmittel", FOOD],
  ];
  let best: ProductKind | null = null;
  for (const [kind, words] of food) {
    for (const w of words) {
      const hit = has(t, [w]);
      if (hit && (!best || hit.trim().length > best.word.length)) best = { kind, word: hit.trim() };
    }
  }
  if (best) return best;
  // Nur ein Geschmack erkannt: essbar, aber keine bestimmte Lebensmittel-Kategorie.
  const flavor = has(t, FLAVOR);
  return flavor ? { kind: "lebensmittel", word: flavor.trim(), flavorOnly: true } : null;
}

/** Getränk? (für Kasten/Flaschen-Angaben und Preisvorschlag) */
export function isDrink(p: { category: string; name?: string | null; variant?: string | null }): boolean {
  return p.category === "Getränke inkl. Pfand" || productKind(p.name, p.variant)?.kind === "getraenk";
}

// ---------- MHD ----------

const FOOD_CATEGORIES = new Set(["Lebensmittel", "Getränke inkl. Pfand", "Süßes & Snacks", "Tee & Nahrungsergänzung"]);

/**
 * Braucht das Produkt ein MHD? Festgelegt pro Produkt („ja“/„nein“), sonst nach Produktart und Kategorie:
 * Spielzeug, Babyzubehör (Flaschen, Schwimmhilfen …), Pflege, Drogerie und Haushaltswaren nie – auch wenn sie falsch
 * unter „Lebensmittel“ stehen. Babyprodukte nur, wenn sie nach Nahrung klingen (Brei, Gläschen, Snack, HiPP …).
 */
export type MhdDecision = { relevant: boolean; reason: string; unsure: boolean };

export function mhdAuto(p: { category: string; mhdMode?: string | null; name?: string | null; variant?: string | null }): MhdDecision {
  if (p.mhdMode === "ja") return { relevant: true, reason: "festgelegt", unsure: false };
  if (p.mhdMode === "nein") return { relevant: false, reason: "festgelegt", unsure: false };
  const kind = productKind(p.name, p.variant);
  if (kind && !FOOD_KINDS.has(kind.kind)) return { relevant: false, reason: kind.kind === "babyzubehoer" ? `Babyzubehör („${kind.word}“)` : `kein Lebensmittel („${kind.word}“)`, unsure: false };
  if (FOOD_CATEGORIES.has(p.category)) return { relevant: true, reason: p.category, unsure: false };
  if (p.category === "Babyprodukte") {
    // Babynahrung ausdrücklich erkannt → MHD; nicht erkannt → lieber prüfen als stillschweigend auslassen.
    return kind ? { relevant: true, reason: `Babynahrung („${kind.word}“)`, unsure: false } : { relevant: true, reason: "Babyprodukt – Nahrung oder Zubehör? bitte festlegen", unsure: true };
  }
  // Klingt eindeutig nach Lebensmittel (auch wenn die Kategorie nicht passt – das meldet „Kategorie prüfen“).
  // Nur Geschmack/Duft („Orange“, „Mango“) reicht nicht: Ein „Styling Gel Bambus & Orange“ unter Drogerie hat kein MHD.
  if (kind && !kind.flavorOnly) return { relevant: true, reason: `klingt nach Lebensmittel („${kind.word}“)`, unsure: false };
  if (p.category === UNSORTED_CATEGORY) return { relevant: true, reason: "Kategorie noch offen – bitte festlegen", unsure: true };
  return { relevant: false, reason: p.category, unsure: false };
}

export function mhdRelevant(p: { category: string; mhdMode?: string | null; name?: string | null; variant?: string | null }): boolean {
  return mhdAuto(p).relevant;
}

// ---------- Kategorie-Auffälligkeiten ----------

/**
 * Passt die Kategorie zum Produkt? Nach Produktart (z. B. Gewürze unter „Drogerie“, Schwimmsitz unter
 * „Lebensmittel“, Süßes unter „Lebensmittel“, Shampoo unter der alten Sammelkategorie „Drogerie & Haushalt“) oder
 * Vorschlag der KI. Ändert nichts – nur ein Hinweis zum Prüfen.
 */
export function categoryHint(p: { name: string; variant?: string | null; category: string; categoryChecked?: boolean | null }, aiCategory?: string | null): { suggest: string; reason: string } | null {
  if (p.categoryChecked || p.category === UNSORTED_CATEGORY) return null;
  const kind = productKind(p.name, p.variant);
  // Babyprodukte bleiben Babyprodukte (Babynahrung, -pflege, -zubehör, -spielzeug).
  if (p.category === "Babyprodukte") return null;
  if (kind) {
    const suggest = KIND_CATEGORY[kind.kind];
    // Nur Geschmack/Duft erkannt („Mango“, „Orange“) – nie ein Grund, die Kategorie zu ändern.
    if (kind.flavorOnly) return null;
    if (suggest !== p.category) {
      // Nicht jede Abweichung ist ein Fehler: Getränke/Tee/Süßes unter „Lebensmittel“ sind nur zu grob, eigene
      // Kategorien (z. B. „Kaffee“) bleiben unangetastet, solange sie zur Art passen.
      const known = (DONATION_CATEGORY_NAMES as readonly string[]).includes(p.category) || (LEGACY_CATEGORIES as readonly string[]).includes(p.category);
      if (known) return { suggest, reason: FOOD_KINDS.has(kind.kind) === FOOD_CATEGORIES.has(p.category) ? `genauer: „${kind.word}“` : `„${kind.word}“ gehört zu ${suggest}` };
    }
    return null;
  }
  if ((LEGACY_CATEGORIES as readonly string[]).includes(p.category)) return { suggest: aiCategory && aiCategory !== p.category ? aiCategory : p.category === "Drogerie & Haushalt" ? "Drogerie" : "Drogerie", reason: "alte Kategorie – bitte Drogerie oder Haushalt wählen" };
  if (aiCategory && aiCategory !== p.category) return { suggest: aiCategory, reason: "KI-Vorschlag" };
  return null;
}

/** Vorgegebene Kategorien in Aushang-Reihenfolge (hier, damit lib/layout.ts und diese Datei sie teilen). */
export const DONATION_CATEGORY_NAMES = ["Babyprodukte", "Lebensmittel", "Süßes & Snacks", "Getränke inkl. Pfand", "Tee & Nahrungsergänzung", "Drogerie", "Haushalt", "Spielzeug", "Sonstiges"] as const;
/** Alte Kategorien: werden nicht mehr angeboten; Produkte darin erscheinen unter „Kategorie prüfen“. */
export const LEGACY_CATEGORIES = ["Drogerie & Haushalt", "Hautpflege", "Haarpflege"] as const;

// ---------- Ganze Packung / Kasten ----------

export const PACK_KINDS = { karton: "Karton", kasten: "Kasten", packung: "Packung", tray: "Tray", palette: "Palette" } as const;
export type PackKind = keyof typeof PACK_KINDS;
export const isPackKind = (v: unknown): v is PackKind => typeof v === "string" && v in PACK_KINDS;

/**
 * Bezeichnung der ganzen Packung: eigener Text, sonst aus Art und Anzahl – bei Getränken mit Inhalt je Flasche:
 * „Kasten (12 × 0,5 l)“, „Karton (24 St.)“, „ganze Packung“.
 */
export function packText(i: { packKind?: string | null; packCount?: number | null; packNote?: string | null }, drink = false, variant?: string | null): string {
  const note = i.packNote?.trim();
  if (note) return note;
  const kind = isPackKind(i.packKind) ? PACK_KINDS[i.packKind] : drink ? "Kasten" : "ganze Packung";
  const n = i.packCount && i.packCount > 1 ? i.packCount : null;
  if (!n) return kind;
  const size = drink ? parseSize(variant) : null;
  const vol = size && size.base === "ml" && size.total < 5000 ? (size.total >= 1000 ? `${String(size.total / 1000).replace(".", ",")} l` : size.total % 100 === 0 && size.total >= 100 ? `${String(size.total / 1000).replace(".", ",")} l` : `${size.total} ml`) : null;
  return vol ? `${kind} (${n} × ${vol})` : `${kind} (${n} ${drink ? "Fl." : "St."})`;
}

export type PackOffer = { label: string; price: number };
type PackSource = { packKind?: string | null; packCount?: number | null; packNote?: string | null; packPrice?: number | null; morePacks?: { kind: string | null; count: number | null; price: number | null; note: string | null }[] | null };

/**
 * Alle Varianten mit eigener Spendenempfehlung neben dem Einzelpreis – „Packung (6 St.) 2 €“, „Karton (24 St.) 5 €“.
 * Gleiche Grundlage für Liste, Collage, Aushang, Messenger und Ideen. Varianten ohne Preis erscheinen nicht.
 */
export function packOffers(i: PackSource, drink = false, variant?: string | null): PackOffer[] {
  const out: PackOffer[] = [];
  if (i.packPrice != null) out.push({ label: packText(i, drink, variant), price: i.packPrice });
  for (const m of i.morePacks ?? []) {
    if (m.price == null) continue;
    out.push({ label: packText({ packKind: m.kind, packCount: m.count, packNote: m.note }, drink, variant), price: m.price });
  }
  // Nach Preis aufsteigend: kleine Packung vor Karton vor Palette.
  return out.sort((a, b) => a.price - b.price);
}

// ---------- Interne Hinweise aus Namen/Varianten heraushalten ----------

/** Formulierungen der KI, die nur fürs Team gedacht sind („genaue Packungsgröße unbekannt“, „alternativ …“). */
// Nur echte Recherche-Kommentare. Sachliche Angaben wie „ca. 12 cm Höhe“ oder „ca. 60–80 g“ bleiben öffentlich.
const INTERNAL = /(unbekannt|unklar|nicht (?:identifiziert|erkennbar|lesbar|eindeutig|verifiziert|gefunden|bestätigt)|vermutlich|wahrscheinlich|möglicherweise|alternativ|ähnlich wie|oder ähnlich|keine (?:angabe|info)|siehe foto|laut (?:foto|bild) nicht|marke unklar)/i;

/** Eindeutige Recherche-Kommentare – nur diese werden aus freiem Text (Ideen, Werbetext) entfernt. */
const RESEARCH = /(unbekannt|unklar|nicht (?:identifiziert|erkennbar|lesbar|verifiziert)|alternativ (?:verfügbar|erhältlich)|keine (?:angabe|info)|siehe foto|marke unklar)/i;

/**
 * Freier Text (gespeicherte Ideen, Pakete, Werbetext): Recherche-Anmerkungen wie „Thai Style Nudeln – Marke nicht
 * identifiziert“ oder „(genaue Packungsgröße unbekannt)“ entfernen, der übrige Text bleibt wörtlich erhalten.
 */
export function stripInternal(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/\s*[([]([^)\]\n]*)[)\]]/g, (m, inner: string) => (RESEARCH.test(inner) ? "" : m))
        .replace(/(\s[–-]\s|,\s*|;\s*)([^,;–\n]*)/g, (m, _sep: string, seg: string) => (RESEARCH.test(seg) && seg.length < 90 ? "" : m)),
    )
    .join("\n");
}

/** Alle Texte eines gespeicherten Objekts (z. B. Ideen) bereinigen – für Anzeige und Kopieren; das Original bleibt. */
export function stripInternalDeep<T>(value: T): T {
  if (typeof value === "string") return stripInternal(value) as T;
  if (Array.isArray(value)) return value.map((v) => stripInternalDeep(v)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInternalDeep(v)])) as T;
  return value;
}

/** Name/Variante ohne interne Hinweise – so erscheinen sie in Collage, Aushang, Messenger und Social Media. */
export function splitInternal(text: string | null | undefined): { clean: string; notes: string[] } {
  if (!text) return { clean: "", notes: [] };
  const notes: string[] = [];
  let clean = text.replace(/\s*[([]([^)\]]*)[)\]]/g, (m, inner: string) => (INTERNAL.test(inner) ? (notes.push(inner.trim()), "") : m));
  // Teile nach Komma, Semikolon, Gedankenstrich oder „/“
  // Dezimalkomma („0,25 l“) ist kein Trenner.
  const parts = clean.split(/\s*;\s*|(?<!\d),(?!\d)\s*|\s[–-]\s|\s\/\s/);
  if (parts.length > 1) {
    const keep = parts.filter((x) => !(INTERNAL.test(x) && (notes.push(x.trim()), true)));
    // Nur neu zusammensetzen, wenn wirklich etwas entfernt wurde – sonst bleibt der Text wie er war.
    if (keep.length < parts.length) clean = keep.join(", ");
  } else if (INTERNAL.test(clean)) {
    notes.push(clean.trim());
    clean = "";
  }
  return { clean: clean.replace(/\s{2,}/g, " ").trim(), notes };
}

/** Text für Ausgaben: ohne interne Hinweise; bleibt nichts übrig, das Original (lieber zu viel als leer). */
export function publicText(text: string | null | undefined): string {
  const { clean } = splitInternal(text);
  return clean || (text ?? "").trim();
}

/** KI-Text ohne technische Markierungen wie <cite index="…">…</cite>. */
export function cleanAiText(text: string | null | undefined): string {
  return (text ?? "").replace(/<\/?[a-z][^>]*>/gi, "").replace(/\s{2,}/g, " ").trim();
}

/** B-Ware, gebraucht, generalüberholt … – kein Vergleichspreis für Neuware. */
export const isSecondHand = (title: string | null | undefined, shop?: string | null) => /b-?ware|gebraucht|refurbished|generalüberholt|retoure|2\.\s*wahl|vorführ|mängelexemplar|wie neu|second ?hand/i.test(`${title ?? ""} ${shop ?? ""}`);

// ---------- Ausgegebener Preis und Preis im Foto ----------

export type PhotoReading = { status: string | null; price: number | null; text: string | null; box: unknown; reader?: number | null } | null;

/** Leser-Version, ab der „kein Preis im Foto“ als verlässlich gilt (siehe lib/photo-price.ts). */
export const RELIABLE_READER = 2;
export type PriceInput = { price: number | null; priceSource?: string | null; priceConfirmed?: boolean | null; priceOverPhotoFileId?: string | null };

export type PriceState = {
  /** Dieser Preis erscheint in allen Ausgaben. */
  price: number | null;
  /** Im Foto erkannter Preis (oder null). */
  printed: PrintedInfo;
  photo: "keiner" | "wird-gelesen" | "gleich" | "mehrere" | "ohne-betrag" | "fehlt-eingetragen" | "abweichend" | "abweichend-geloest";
  /** Braucht eine Entscheidung (Foto und Angabe widersprechen sich). */
  conflict: boolean;
  /** Die Fotoerkennung ist wahrscheinlich falsch (z. B. „50 €“ statt „50 Cent“). */
  suspicious: boolean;
  /** Preis von einem Menschen eingetragen oder bestätigt. */
  confirmed: boolean;
  /**
   * Collage/Social Media: „drucken“ = Preis normal aufs Bild; „foto“ = steht schon richtig im Foto, nicht doppelt;
   * „aufkleber“ = eingetragenen Preis als Feld über den alten Preis im Foto setzen.
   */
  plan: "drucken" | "foto" | "aufkleber" | "ersetzen";
  /**
   * Der alte Preis im Foto lässt sich nicht gezielt verdecken (Lage unbekannt oder mehrere Preise) – „ersetzen“:
   * kein zusätzlicher Preis aufs Bild (sonst stünden zwei da), stattdessen ein Foto ohne Preis verlangen.
   */
  oldVisible: boolean;
  /** Foto wurde noch nicht auf einen eingebrannten Preis geprüft – Gefahr doppelter Preise. */
  unread: boolean;
};

export function printedFrom(imageFileId: string | null | undefined, photo: PhotoReading): PrintedInfo {
  return imageFileId && photo?.text ? { price: photo.price, text: photo.text, box: (photo.box as PriceBox | null) ?? null } : null;
}

export function priceState(item: PriceInput, imageFileId: string | null | undefined, photo: PhotoReading): PriceState {
  const price = item.price;
  const confirmed = price !== null && !!item.priceConfirmed;
  // Noch nicht (oder nur vom alten, unzuverlässigeren Leser ohne Ergebnis) gelesen → Gefahr doppelter Preise.
  const unread = !!imageFileId && (!photo?.status || photo.status === "error" || (photo.status === "done" && !photo.text && (photo.reader ?? 1) < RELIABLE_READER));
  const base: PriceState = { price, printed: null, photo: "keiner", conflict: false, suspicious: false, confirmed, plan: "drucken", oldVisible: false, unread };
  if (imageFileId && photo?.status === "pending") return { ...base, photo: "wird-gelesen" };
  const printed = printedFrom(imageFileId, photo);
  if (!printed) return base;
  const suspicious = printed.price !== null && (printed.price >= 20 || (price !== null && price > 0 && (printed.price / price >= 8 || price / printed.price >= 8)));
  const s = { ...base, printed, suspicious };
  const resolvedFor = !!imageFileId && item.priceOverPhotoFileId === imageFileId;
  if (hasSeveralPrices(printed.text)) {
    // Staffelpreise im Foto (z. B. „2kg 5€ / 5kg 10€“): passt der eingetragene dazu, Foto unverändert lassen.
    if (price === null) return { ...s, photo: "mehrere", conflict: true, plan: "foto" };
    if (printedAmounts(printed.text).some((a) => Math.abs(a - price) < 0.005)) return { ...s, photo: "mehrere", plan: "foto" };
    return { ...s, photo: resolvedFor ? "abweichend-geloest" : "abweichend", conflict: !resolvedFor, plan: "ersetzen", oldVisible: true };
  }
  // Text ohne lesbaren Betrag: eingetragenen Preis normal drucken.
  if (printed.price === null) return price === null ? { ...s, photo: "ohne-betrag", plan: "foto" } : { ...s, photo: "ohne-betrag", plan: "drucken" };
  if (price === null) return { ...s, photo: "fehlt-eingetragen", conflict: true, plan: "foto" };
  if (Math.abs(printed.price - price) < 0.005) return { ...s, photo: "gleich", plan: "foto" };
  const plan = plausibleBox(printed.box) ? "aufkleber" : "ersetzen";
  return { ...s, photo: resolvedFor ? "abweichend-geloest" : "abweichend", conflict: !resolvedFor, plan, oldVisible: plan === "ersetzen" };
}

// ---------- Prüfstatus einer Zeile ----------

export type Issue = { key: IssueKey; label: string; level: "fehlt" | "pruefen" };
export type IssueKey = "name" | "preis" | "konflikt" | "foto-alt" | "preis-unbestaetigt" | "einheit" | "ki-angaben" | "intern" | "kategorie" | "kategorie-pruefen" | "mhd" | "mhd-pruefen" | "foto" | "vergleich" | "rueckseite" | "mhd-ki" | "mehrere";

/**
 * Rangfolge der Prüfhinweise: 1 = zuerst klären (Preis/Konflikt – sonst steht Falsches im Aushang),
 * 2 = prüfen, 3 = optional (stört die Ausgabe nicht).
 */
export const ISSUE_TIER: Record<IssueKey, 1 | 2 | 3> = {
  konflikt: 1, "foto-alt": 1, preis: 1, name: 1, rueckseite: 1, mehrere: 1,
  "preis-unbestaetigt": 2, vergleich: 2, einheit: 2, "ki-angaben": 2, mhd: 2, "mhd-pruefen": 2, "mhd-ki": 2, kategorie: 2, "kategorie-pruefen": 2,
  intern: 3, foto: 3,
};
export const TIER_LABELS = { 1: "Zuerst klären", 2: "Prüfen", 3: "Optional" } as const;

/** Was der Hinweis bedeutet und was zu tun ist – für die aufklappbaren Details je Produkt. */
export const ISSUE_HELP: Record<IssueKey, string> = {
  konflikt: "Im Foto steht ein anderer Preis als eingetragen – entscheiden, welcher gilt.",
  "foto-alt": "Das Foto zeigt einen alten Preis, der sich nicht verdecken lässt – bitte ein Foto ohne Preis hochladen.",
  preis: "Noch keine Spendenempfehlung – ohne Preis erscheint das Produkt ohne Betrag.",
  name: "Noch kein Name – erscheint sonst nicht im Aushang.",
  rueckseite: "Wahrscheinlich die Rückseite eines anderen Produkts – zusammenführen, sonst steht es doppelt da.",
  mehrere: "Auf dem Foto sind mehrere verschiedene Produkte – bitte einzeln fotografieren.",
  "preis-unbestaetigt": "Preis aus Foto oder KI übernommen – kurz ansehen und bestätigen.",
  vergleich: "Der Handelspreis bezieht sich evtl. auf eine andere Packungsgröße.",
  einheit: "Worauf bezieht sich der Preis – Stück, Packung oder Karton?",
  "ki-angaben": "Name/Variante hat die KI eingetragen – bitte kurz prüfen.",
  mhd: "Lebensmittel ohne MHD – Datum eintragen oder von der Rückseite lesen lassen.",
  "mhd-pruefen": "Unklar, ob Nahrung (MHD nötig) oder Zubehör.",
  "mhd-ki": "MHD automatisch vom Foto gelesen – bitte bestätigen oder korrigieren.",
  kategorie: "Noch keiner Kategorie zugeordnet – steht sonst unter „Sonstiges“.",
  "kategorie-pruefen": "Die Kategorie passt vermutlich nicht zum Produkt.",
  intern: "Interner KI-Hinweis im Namen – erscheint nicht in der Ausgabe, kann bereinigt werden.",
  foto: "Kein Foto – erscheint nicht auf der Collage.",
};

/** Wichtigste zuerst (stabile Reihenfolge innerhalb einer Stufe). */
export function sortIssues<T extends { key: IssueKey }>(issues: T[]): T[] {
  return issues.map((x, n) => ({ x, n })).sort((a, b) => ISSUE_TIER[a.x.key] - ISSUE_TIER[b.x.key] || a.n - b.n).map((e) => e.x);
}

/** Ein Satz je Produkt: „Zuerst klären: Preis fehlt · außerdem 2 zu prüfen“. */
export function issueSummary(issues: { key: IssueKey; label: string }[]): string {
  if (issues.length === 0) return "Alles erledigt";
  const sorted = sortIssues(issues);
  const top = ISSUE_TIER[sorted[0].key];
  const first = sorted.filter((i) => ISSUE_TIER[i.key] === top).map((i) => i.label);
  const rest = sorted.length - first.length;
  return `${TIER_LABELS[top]}: ${first.join(", ")}${rest ? ` · außerdem ${rest} weitere${rest === 1 ? "r Punkt" : " Punkte"}` : ""}`;
}

export const ISSUE_FILTERS: { key: IssueKey; label: string }[] = [
  { key: "mehrere", label: "Mehrere Produkte im Foto" },
  { key: "konflikt", label: "Preiswiderspruch" },
  { key: "foto-alt", label: "Foto zeigt alten Preis" },
  { key: "preis", label: "Ohne Preis" },
  { key: "name", label: "Ohne Namen" },
  { key: "rueckseite", label: "Mögliche Rückseite" },
  { key: "preis-unbestaetigt", label: "Preis unbestätigt" },
  { key: "einheit", label: "Abgabeeinheit offen" },
  { key: "ki-angaben", label: "KI-Angaben prüfen" },
  { key: "intern", label: "Interne Hinweise im Text" },
  { key: "vergleich", label: "Preisvergleich unsicher" },
  { key: "kategorie", label: "Kategorie zuordnen" },
  { key: "kategorie-pruefen", label: "Kategorie prüfen" },
  { key: "mhd", label: "MHD fehlt" },
  { key: "mhd-pruefen", label: "MHD-Relevanz prüfen" },
  { key: "mhd-ki", label: "MHD automatisch gelesen" },
  { key: "foto", label: "Ohne Foto" },
];

/** Ist die Abgabeeinheit offen? Bestätigt nur, wenn jemand sie festgelegt hat – unabhängig vom Preis. */
export function unitIssue(item: { unit: string | null; unitCount: number | null; unitConfirmed?: boolean | null; price: number | null }): string | null {
  if (item.unitConfirmed && item.unit) {
    // Plausibilität: hoher Betrag für ein Einzelstück
    if (item.unit === "stueck" && item.price !== null && item.price >= 3) return `Einzelstück für ${item.price.toFixed(2).replace(".", ",")} € – stimmt die Einheit?`;
    return null;
  }
  if (item.unitConfirmed && !item.unit) return null;
  return "Abgabeeinheit offen";
}

export function itemIssues(o: {
  unnamed: boolean;
  product: { name: string; variant?: string | null; category: string; categoryChecked?: boolean | null; mhdMode?: string | null; reviewNote?: string | null; imageFileId: string | null };
  item: { bestBefore: string | null; bestBeforeSource?: string | null; inCollage: boolean; unit?: string | null; unitCount?: number | null; unitConfirmed?: boolean | null; price?: number | null };
  state: PriceState;
  compare?: Comparability | null;
  aiCategory?: string | null;
  /** KI sieht mehrere verschiedene Produkte auf dem Foto. */
  multiple?: boolean;
}): Issue[] {
  const out: Issue[] = [];
  if (o.multiple) out.push({ key: "mehrere", label: "Mehrere Produkte im Foto", level: "fehlt" });
  if (o.unnamed) out.push({ key: "name", label: "Name fehlt", level: "fehlt" });
  if (o.state.conflict) out.push({ key: "konflikt", label: o.state.photo === "fehlt-eingetragen" ? "Preis nur im Foto" : "Preis ≠ Foto", level: "pruefen" });
  else if (o.state.plan === "ersetzen") out.push({ key: "foto-alt", label: "Foto zeigt alten Preis", level: "pruefen" });
  if (o.state.price === null && !o.state.conflict) out.push({ key: "preis", label: "Preis fehlt", level: "fehlt" });
  if (o.state.price !== null && !o.state.confirmed) out.push({ key: "preis-unbestaetigt", label: "Preis unbestätigt", level: "pruefen" });
  const unit = unitIssue({ unit: o.item.unit ?? null, unitCount: o.item.unitCount ?? null, unitConfirmed: o.item.unitConfirmed, price: o.state.price });
  if (unit && !o.unnamed) out.push({ key: "einheit", label: unit.startsWith("Einzelstück") ? "Einheit prüfen" : "Einheit offen", level: "pruefen" });
  if (o.product.reviewNote && !o.unnamed) out.push({ key: "ki-angaben", label: "KI-Angaben prüfen", level: "pruefen" });
  if (!o.unnamed && (splitInternal(o.product.name).notes.length || splitInternal(o.product.variant).notes.length)) out.push({ key: "intern", label: "Interner Hinweis im Text", level: "pruefen" });
  if (o.compare && o.compare.level !== "passt") out.push({ key: "vergleich", label: o.compare.level === "abweichend" ? "Größe ≠ Handel" : "Vergleich unsicher", level: "pruefen" });
  if (o.product.category === UNSORTED_CATEGORY) out.push({ key: "kategorie", label: "Kategorie fehlt", level: "fehlt" });
  else if (categoryHint(o.product, o.aiCategory)) out.push({ key: "kategorie-pruefen", label: "Kategorie prüfen", level: "pruefen" });
  const mhd = mhdAuto(o.product);
  // Unklar, ob Nahrung (z. B. unbekanntes Babyprodukt): nicht auslassen, sondern ausdrücklich prüfen lassen.
  if (!o.item.bestBefore && mhd.unsure) out.push({ key: "mhd-pruefen", label: "MHD-Relevanz prüfen", level: "pruefen" });
  else if (!o.item.bestBefore && mhd.relevant) out.push({ key: "mhd", label: "MHD fehlt", level: "fehlt" });
  // Von der KI vom Foto gelesen: kurz bestätigen oder korrigieren.
  if (o.item.bestBefore && o.item.bestBeforeSource === "foto-ki") out.push({ key: "mhd-ki", label: "MHD prüfen (KI)", level: "pruefen" });
  if (!o.product.imageFileId && o.item.inCollage) out.push({ key: "foto", label: "Foto fehlt", level: "fehlt" });
  return out;
}

// ---------- Bestand und Ergebnis ----------

/** Wie viel ist ungefähr da? (intern, erscheint nicht in den Ausgaben) */
export const STOCK_LABELS = { palette: "1 Palette", "halbe-palette": "½ Palette", "viertel-palette": "¼ Palette", kartons: "mehrere Kartons", einzeln: "Einzelprodukt", reste: "wenige / Reste" } as const;
/** Wie lief es bei der Verteilung? Grundlage der Statistik. */
export const OUTCOME_LABELS = { weg: "alles weg", wenig: "wenig übrig", viel: "viel übrig" } as const;
