// Passt ein per Titel gefundenes Amazon-Angebot zum Artikel des Lieferanten? Titelsuchen (ohne EAN)
// liefern oft ein anderes Produkt (T-Shirt, Katzenfutter, Gin …), eine andere Marke oder eine andere
// Sorte derselben Marke. Reine Logik, ohne Server-Abhängigkeiten.

export type MatchIssue = { kind: "produkt" | "marke" | "sorte"; text: string };

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss");

// Mehrwortsorten zu einem Wort, damit „Blue Raspberry“ nicht als „Blue“ + „Raspberry“ zählt.
const PHRASES: [RegExp, string][] = [
  [/blue\s*(?:rasp(?:berry)?|razz|himbeere?n?)|blaue?[rn]?\s*himbeere?n?/g, " blueraspberry "],
  [/cotton\s*candy|zuckerwatte/g, " cottoncandy "],
  [/green\s*apple|grune?[rn]?\s*apfel/g, " greenapple "],
  [/(?:sour|saure?[rn]?)\s*(?:apple|apfel)|sauerapfel/g, " sourapple "],
  [/cherry\s*cola|kirsch[\s-]*cola|cola[\s-]*kirsche?/g, " cherrycola "],
  [/tutti\s*frutti/g, " tuttifrutti "],
  [/t[\s-]?shirts?/g, " shirt "],
];

// Deutsch → Englisch (Amazon.de übersetzt Sorten, die Großhändler-Listen nicht).
const WORDS: Record<string, string> = {
  kirsche: "cherry", kirsch: "cherry", kirschen: "cherry", erdbeere: "strawberry", erdbeer: "strawberry", erdbeeren: "strawberry",
  himbeere: "raspberry", himbeer: "raspberry", himbeeren: "raspberry", wassermelone: "watermelon", melone: "melon", apfel: "apple",
  traube: "grape", trauben: "grape", wassermelonen: "watermelon", toffee: "caramel", bausteine: "block", baustein: "block",
  gefriergetrocknet: "freeze dried", gefriergetrocknete: "freeze dried", zitrone: "lemon", limette: "lime", pfirsich: "peach", banane: "banana", ananas: "pineapple",
  kokos: "coconut", minze: "mint", pfefferminz: "peppermint", pfefferminze: "peppermint", zimt: "cinnamon", karamell: "caramel",
  erdnuss: "peanut", vanille: "vanilla", schokolade: "chocolate", schoko: "chocolate", beere: "berry", beeren: "berry",
  frucht: "fruit", fruchte: "fruit", zitrus: "citrus", zitrusfruchte: "citrus", fruchtgummi: "gummy", fruchtgummis: "gummy",
  gummibarchen: "gummy", kaugummi: "gum", lutscher: "lollipop pop", kaubonbons: "chew", kaubonbon: "chew", kauriegel: "chew bar",
  gefullte: "filled", gefullt: "filled", lakritz: "licorice", lakritze: "licorice", liquorice: "licorice", flavour: "flavor",
};

// Zählen nicht für den Vergleich: Füllwörter, Verpackung, Mengen und Allerweltswörter.
const IGNORE = new Set(
  ("and und mit with the der die das den dem des ein eine for fur by von of an in im je per pro er inkl plus " +
    "pack packung packs pk stuck stk st count ct box case tray bag beutel tute tuten dose dosen tub piece pieces pcs set karton display " +
    "multipack vorteilspack grosspackung bulk size share family single oz ounce ounces gramm kg ml lb lbs zahlen einheiten units " +
    "candy candies sweets sussigkeiten sussigkeit susswaren bonbons bonbon original classic sour sours sauer saure saurer sauere " +
    "new neu usa us american amerikanische amerikanisch import vegan vegane veganer refill refills flavor flavors geschmack " +
    "geschmacksrichtungen assorted sortiert edition limited xxl")
    .split(" ")
    .map((w) => stem(w)),
);

// Bei Amazon, aber nicht beim Lieferanten → fast sicher ein anderes Produkt.
const MERCH = new Set(
  ("shirt hoodie pullover sweatshirt tasse becher mug poster klebepunkte kostum costume plusch plush kuscheltier " +
    "figur figure spielzeug toy spiel logikspiel brettspiel reisespiel puzzle buch book malbuch dvd socken socks mutze rucksack backpack " +
    "schlusselanhanger keychain handyhulle leckerli leckerlies katzenfutter hundefutter tierfutter katzensnack gin wodka vodka rum whisky " +
    "whiskey likor wein bier lampe kissen deko dekoration kerze seife shampoo parfum babyflasche gurtel novel roman taschenbuch " +
    "paperback hardcover kindle sensory diameter durchmesser")
    .split(" ")
    .map((w) => stem(w)),
);

// Sorten/Geschmacksrichtungen – unterschiedliche Sorte = anderes Produkt.
const FLAVORS = new Set(
  ("cherry strawberry raspberry blueraspberry watermelon melon apple greenapple sourapple grape lemon lime orange peach banana pineapple " +
    "coconut mint peppermint spearmint wintergreen cinnamon caramel peanut vanilla chocolate cola cherrycola cottoncandy tuttifrutti mango " +
    "berry tropical citrus bubblegum licorice rhubarb custard toffee butterscotch honey lemonade acai lychee passionfruit kiwi blackcurrant pear plum")
    .split(" ")
    .map((w) => stem(w)),
);

function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length >= 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/** Vergleichbare Wörter eines Titels (klein, ohne Akzente, Sorten auf Englisch, ohne Mengen und Füllwörter). */
export function titleTokens(title: string): string[] {
  let s = ` ${fold(title)} `;
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const out: string[] = [];
  for (const raw of s.split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || /^\d+([.,]\d+)?(g|kg|ml|l|cl|oz|lb|lbs|ct|er|x|p|pk|pcs|cm|mm|st|stk|nd|rd|th)?$/.test(raw)) continue;
    for (const w of (WORDS[raw] ?? WORDS[stem(raw)] ?? raw).split(" ")) {
      const t = stem(w);
      if (!IGNORE.has(t)) out.push(t);
    }
  }
  return out;
}

const same = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6));

/**
 * Hinweis, wenn das Amazon-Angebot wohl nicht der Artikel des Lieferanten ist – sonst null.
 * Marke = erstes Wort beim Lieferanten; danach muss wenigstens ein weiteres Merkmal passen.
 */
export function matchIssue(supplierTitle: string | null | undefined, amazonTitle: string | null | undefined): MatchIssue | null {
  if (!supplierTitle || !amazonTitle) return null;
  const sup = titleTokens(supplierTitle);
  const amz = titleTokens(amazonTitle);
  if (!sup.length || !amz.length) return null;
  const has = (t: string) => amz.some((a) => same(a, t));
  const merch = amz.find((a) => MERCH.has(a) && !sup.includes(a));
  if (merch) return { kind: "produkt", text: `anderes Produkt? („${merch}“ bei Amazon)` };
  // Doppelbuchstaben zusammenziehen: „SweeTARTS“ = „SweetTarts“.
  const squash = (x: string) => x.replace(/(.)\1+/g, "$1");
  const compact = squash(fold(amazonTitle).replace(/[^a-z0-9]/g, ""));
  const brand = sup[0];
  if (!has(brand) && !(brand.length >= 4 && compact.includes(squash(brand)))) {
    // Amazon lässt den Hersteller oft weg („Mega Double Lollies“ statt „Swizzels Mega Double Lollies“):
    // reicht, wenn der Produktname sonst überwiegend passt und der Amazon-Titel nicht mit einer
    // fremden Marke beginnt („Kellogg's Pop Tarts“ ≠ „Swizzels Strawberry Tarts“).
    const name = sup.slice(1);
    const hits = name.filter(has).length;
    const foreignStart = !sup.some((t) => same(t, amz[0]));
    if (foreignStart || hits < 2 || hits < name.length / 2) return { kind: "marke", text: `andere Marke? („${brand}“ fehlt bei Amazon)` };
  }
  let i = 1;
  while (i < sup.length && has(sup[i])) i++;
  const rest = [...new Set(sup.slice(i))];
  if (!rest.length) return null;
  const supFl = rest.filter((t) => FLAVORS.has(t));
  const amzFl = [...new Set(amz.filter((t) => FLAVORS.has(t)))];
  if (supFl.length && amzFl.length && !supFl.some((f) => amzFl.includes(f))) return { kind: "sorte", text: `andere Sorte? (${supFl.join("/")} ↔ ${amzFl.join("/")})` };
  if (!rest.some(has)) return { kind: "sorte", text: `andere Sorte? („${rest.slice(0, 2).join(" ")}“ fehlt bei Amazon)` };
  return null;
}

/** Aus den Treffern einer Titelsuche den ersten, der zum Lieferanten-Artikel passt (sonst den ersten). */
export function pickTitleMatch<T extends { title: string }>(supplierTitle: string, products: T[]): T | undefined {
  return products.find((p) => !matchIssue(supplierTitle, p.title)) ?? products[0];
}
