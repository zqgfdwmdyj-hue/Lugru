// Tiere, die Kinder in einer Region entdecken können (Tiere-Bingo in der Kinder-Ansicht).
// Zuordnung über die Koordinaten des Tages – funktioniert ohne Internet und ohne KI.

// bild: eigene Zeichnung (tierbilder.js), gruppe: nur eins je Gruppe (z. B. ein Wal), nur: Gebiete [S, N, W, O]
const T = (emoji, name, satz, extra = {}) => ({ emoji, name, satz, ...extra });
const WAL = { gruppe: "wal" };
// Inseln/Gebiete in der Karibik, für Tiere, die es nicht überall gibt
const BARBADOS = [12.9, 13.4, -59.75, -59.3], ST_KITTS = [17.05, 17.45, -62.95, -62.5], GRENADA = [11.95, 12.3, -61.85, -61.5];
const DOMINICA = [15.1, 15.7, -61.6, -61.15], MARTINIQUE = [14.35, 14.9, -61.25, -60.8], GUADELOUPE = [15.8, 16.55, -61.85, -61.0];
const DOM_REP = [17.4, 20, -72.1, -68.3], ABC_INSELN = [11.9, 12.7, -70.2, -68.1], BAHAMAS = [20.9, 27.3, -79.5, -72.7], KUBA = [19.8, 23.3, -85, -74.1], YUCATAN = [18, 22, -91, -86.5];
const ST_LUCIA = [13.7, 14.15, -61.1, -60.85], ST_VINCENT = [12.5, 13.4, -61.5, -61.1];

export const REGIONEN = [
  {
    id: "karibik", name: "Karibik", box: [9, 27.5, -90, -59],
    tiere: [
      T("🐢", "Meeresschildkröte", "Sie kann ihre Luft stundenlang anhalten, wenn sie schläft."),
      T("🦜", "Papagei", "Auf Dominica, St. Lucia und St. Vincent leben Papageien, die es sonst nirgends gibt.", { nur: [DOMINICA, ST_LUCIA, ST_VINCENT, DOM_REP, KUBA] }),
      T("", "Kolibri", "Er schlägt bis zu 80-mal pro Sekunde mit den Flügeln – darum summt er.", { bild: "kolibri" }),
      T("🦎", "Leguan", "Leguane sonnen sich gern auf warmen Steinen und können gut schwimmen."),
      T("", "Pelikan", "Er fängt Fische mit seinem Kehlsack wie mit einem Kescher.", { bild: "pelikan" }),
      T("🐬", "Delfin", "Delfine schlafen mit einer Gehirnhälfte – die andere passt auf."),
      T("🐋", "Buckelwal", "Von Januar bis März kommen Tausende Buckelwale in die Bucht von Samaná, um ihre Babys zu bekommen.", { ...WAL, nur: [DOM_REP] }),
      T("", "Pottwal", "Vor Dominica leben Pottwale das ganze Jahr – sie tauchen über 1000 m tief.", { bild: "pottwal", gruppe: "pottwal", nur: [DOMINICA, MARTINIQUE, GUADELOUPE] }),
      T("🐠", "Papageifisch", "Aus seinem Kot entsteht weißer Sand für die Strände!"),
      T("🦀", "Landkrabbe", "Sie wohnt in Löchern am Strand und läuft seitwärts."),
      T("🐒", "Grüne Meerkatze", "Auf Barbados, St. Kitts und Grenada klettern kleine Affen durch die Bäume.", { nur: [BARBADOS, ST_KITTS, GRENADA] }),
      T("🦩", "Flamingo", "Flamingos sind rosa vom Futter – sie stehen gern auf einem Bein.", { nur: [ABC_INSELN, DOM_REP, BAHAMAS, KUBA, YUCATAN] }),
      T("🦈", "Ammenhai", "Er liegt gern faul am Meeresboden und ist ganz friedlich."),
    ],
  },
  {
    id: "rotesmeer", name: "Rotes Meer", box: [12, 30, 32, 44],
    tiere: [
      T("🐠", "Clownfisch", "Er wohnt in einer Seeanemone, die ihn beschützt – wie Nemo."),
      T("🐢", "Meeresschildkröte", "Sie frisst gern Seegras und kann über 80 Jahre alt werden."),
      T("🐬", "Delfin", "Im Roten Meer schwimmen oft ganze Delfin-Familien neben den Booten."),
      T("🐟", "Napoleon", "Ein riesiger, neugieriger Fisch mit einer Beule auf der Stirn."),
      T("🦑", "Sepia", "Sie kann blitzschnell ihre Farbe wechseln."),
      T("🐡", "Kugelfisch", "Bei Gefahr bläst er sich zu einer stacheligen Kugel auf."),
      T("🐪", "Kamel", "Kamele speichern Fett im Höcker und können lange ohne Wasser auskommen."),
      T("🦈", "Riffhai", "Riffhaie patrouillieren am Riff – meist sehr scheu."),
    ],
  },
  {
    id: "orient", name: "Arabische Halbinsel", box: [12, 30, 44, 61],
    tiere: [
      T("🐪", "Kamel", "Ein Kamel kann bis zu 100 Liter auf einmal trinken."),
      T("🦅", "Falke", "Falken sind die schnellsten Vögel der Welt."),
      T("🐢", "Meeresschildkröte", "Am Strand von Oman legen Schildkröten ihre Eier in den Sand."),
      T("🐬", "Delfin", "In Fjorden von Musandam sieht man oft Delfine."),
      T("🦩", "Flamingo", "Im Winter rasten Flamingos an den Lagunen."),
      T("🦎", "Dornschwanzagame", "Eine Echse, die in der Wüste Höhlen gräbt."),
    ],
  },
  {
    id: "atlantik", name: "Kanaren & Madeira", box: [27, 33.5, -18.5, -13],
    tiere: [
      T("🐋", "Grindwal", "Vor Teneriffa leben Grindwale das ganze Jahr.", WAL),
      T("🐬", "Delfin", "Große Tümmler springen oft vor dem Schiff aus dem Wasser."),
      T("🦎", "Rieseneidechse", "Auf den Kanaren gibt es Eidechsen, die so lang wie ein Arm werden."),
      T("🐤", "Kanarienvogel", "Die Inseln haben ihren Namen nicht von ihm – aber er wohnt dort."),
      T("🐢", "Meeresschildkröte", "Manchmal ziehen Schildkröten an den Inseln vorbei."),
      T("🦀", "Rote Klippenkrabbe", "Leuchtend rote Krabben klettern über die Lavafelsen."),
    ],
  },
  {
    id: "alpen", name: "Alpen", box: [45.6, 48.1, 5.8, 16.5],
    tiere: [
      T("", "Murmeltier", "Murmeltiere pfeifen laut, wenn Gefahr droht – und schlafen den ganzen Winter.", { bild: "murmeltier" }),
      T("🐐", "Steinbock", "Steinböcke klettern an fast senkrechten Felswänden."),
      T("🦅", "Steinadler", "Er kann einen Hasen aus einem Kilometer Entfernung sehen."),
      T("🐄", "Kuh auf der Alm", "Im Sommer ziehen die Kühe hinauf auf die Almwiesen – mit Glocken!"),
      T("🦊", "Fuchs", "Im Winter sieht man seine Spuren im Schnee."),
      T("", "Alpendohle", "Schwarze Vögel mit gelbem Schnabel – sie betteln gern an Berghütten.", { bild: "alpendohle" }),
      T("🐇", "Schneehase", "Im Winter wird sein Fell weiß wie der Schnee."),
    ],
  },
  {
    id: "mitteleuropa", name: "Mitteleuropa", box: [47, 55.4, -5, 20],
    tiere: [
      T("🦌", "Reh", "Rehe sieht man oft morgens und abends am Waldrand."),
      T("🦊", "Fuchs", "Füchse wohnen in Höhlen, die Bau heißen."),
      T("🐿️", "Eichhörnchen", "Es versteckt Nüsse und vergisst viele – daraus wachsen Bäume."),
      T("🦢", "Schwan", "Schwäne bleiben ihr ganzes Leben zusammen."),
      T("🦆", "Ente", "Enten haben wasserdichte Federn."),
      T("", "Storch", "Störche fliegen im Winter bis nach Afrika.", { bild: "storch" }),
      T("🦔", "Igel", "Ein Igel hat rund 7000 Stacheln."),
      T("🦭", "Seehund", "An Nord- und Ostsee liegen Seehunde auf den Sandbänken.", { gruppe: "robbe" }),
      T("🐞", "Marienkäfer", "Die Punkte zeigen nicht das Alter – aber sie sind trotzdem schön."),
    ],
  },
  {
    id: "mittelmeer", name: "Mittelmeer", box: [30, 46.5, -6, 36.5],
    tiere: [
      T("🐬", "Delfin", "Im Mittelmeer leben mehrere Delfinarten."),
      T("🐙", "Oktopus", "Ein Oktopus hat drei Herzen und blaues Blut."),
      T("🐢", "Unechte Karettschildkröte", "Sie legt in Griechenland und Zypern ihre Eier."),
      T("", "Möwe", "Möwen trinken sogar Salzwasser.", { bild: "moewe" }),
      T("🦎", "Gecko", "Geckos laufen kopfüber an der Decke."),
      T("🐐", "Bergziege", "Auf den Inseln klettern Ziegen auf steile Felsen."),
      T("🐟", "Zackenbarsch", "Ein großer Fisch, der gern in Höhlen wohnt."),
      T("🪼", "Qualle", "Quallen bestehen fast nur aus Wasser."),
    ],
  },
  {
    id: "norden", name: "Nordeuropa", box: [53, 72, -25, 32],
    tiere: [
      T("🐋", "Buckelwal", "Buckelwale singen lange Lieder unter Wasser.", WAL),
      T("🦭", "Robbe", "Robben liegen gern auf Steinen in der Sonne.", { gruppe: "robbe" }),
      T("", "Papageitaucher", "Er heißt auch Puffin und hat einen bunten Schnabel.", { bild: "papageitaucher" }),
      T("🦅", "Seeadler", "Er hat Flügel, die so breit sind wie ein Auto."),
      T("🦌", "Rentier", "Rentiere haben Fell sogar an den Hufen."),
      T("🐟", "Lachs", "Lachse schwimmen den Fluss hinauf und springen über Wasserfälle."),
      T("🐬", "Schweinswal", "Ein kleiner, scheuer Wal in Nord- und Ostsee.", { gruppe: "delfin" }),
    ],
  },
  {
    id: "asien", name: "Südostasien", box: [-11, 22, 92, 141],
    tiere: [
      T("🐒", "Makake", "Makaken sind freche Affen – Essen gut festhalten!"),
      T("🦎", "Waran", "Große Echsen, die schwimmen können."),
      T("🐘", "Elefant", "Elefanten können mit dem Rüssel trinken und duschen."),
      T("🐢", "Meeresschildkröte", "In Malaysia und Thailand legen Schildkröten Eier am Strand."),
      T("🐠", "Clownfisch", "Er lebt in Anemonen – wie Nemo."),
      T("🦇", "Flughund", "Flughunde sind große Fledermäuse, die Früchte fressen."),
    ],
  },
  {
    id: "indischerozean", name: "Indischer Ozean", box: [-26, 8, 50, 80],
    tiere: [
      T("🐢", "Riesenschildkröte", "Auf den Seychellen leben Landschildkröten, die über 150 Jahre alt werden."),
      T("🦈", "Walhai", "Der größte Fisch der Welt frisst nur winziges Plankton."),
      T("", "Mantarochen", "Mantas sehen aus, als würden sie unter Wasser fliegen.", { bild: "manta" }),
      T("🐬", "Delfin", "Spinner-Delfine drehen sich beim Springen in der Luft."),
      T("🦇", "Flughund", "Abends fliegen große Flughunde über die Palmen."),
      T("🐠", "Doktorfisch", "Er hat am Schwanz ein kleines Skalpell."),
    ],
  },
  {
    id: "alaska", name: "Alaska & Kanada", box: [47, 72, -170, -122],
    tiere: [
      T("🐻", "Bär", "Bären fangen im Sommer Lachse direkt aus dem Fluss."),
      T("🐋", "Buckelwal", "Buckelwale jagen gemeinsam mit einem Netz aus Luftblasen.", WAL),
      T("🦅", "Weißkopfseeadler", "Das Wappentier der USA."),
      T("🦦", "Seeotter", "Seeotter halten sich beim Schlafen an den Pfoten."),
      T("🦭", "Seelöwe", "Seelöwen bellen laut auf den Felsen."),
    ],
  },
];

export const SEETAG_TIERE = [
  T("🐬", "Delfin", "Delfine schwimmen gern in der Bugwelle des Schiffs.", { gruppe: "delfin" }),
  T("🐟", "Fliegender Fisch", "Er gleitet mit seinen Flossen über das Wasser – bis zu 200 Meter weit!"),
  T("🐳", "Wal", "Manchmal sieht man den Blas – eine Wasserfontäne – am Horizont.", { ...WAL, nichtNeben: ["pottwal"] }),
  T("", "Seevogel", "Seevögel begleiten das Schiff oft weit draußen auf dem Meer.", { bild: "moewe", gruppe: "moewe" }),
  T("🌈", "Regenbogen", "Kein Tier – aber auf See sieht man besonders oft Regenbögen."),
];

export function regionFuer(ort) {
  if (!ort || !Number.isFinite(ort.lat) || !Number.isFinite(ort.lng)) return null;
  return REGIONEN.find(({ box: [s, n, w, o] }) => ort.lat >= s && ort.lat <= n && ort.lng >= w && ort.lng <= o) ?? null;
}

const istSeetag = (tag) => (tag?.art ?? (tag?.seetag ? "seetag" : "hafen")) === "seetag";
const imGebiet = (ort, [s, n, w, o]) => ort.lat >= s && ort.lat <= n && ort.lng >= w && ort.lng <= o;

/** Tiere für einen Tag (Seetag: Tiere auf See, sonst Region des Ortes – nur die, die es dort gibt). */
export function tiereFuer(tag) {
  if (!tag) return [];
  if (istSeetag(tag)) return SEETAG_TIERE;
  return (regionFuer(tag)?.tiere ?? []).filter((t) => !t.nur || t.nur.some((g) => imGebiet(tag, g)));
}

/** Alle Tiere einer Reise: erst die der besuchten Orte, dann die vom Meer – ohne Doppelte (ein Wal genügt). */
export function tiereDerReise(reise) {
  const tiere = new Map();
  const tage = [...(reise?.haefen ?? [])].sort((a, b) => istSeetag(a) - istSeetag(b));
  for (const h of tage) for (const t of tiereFuer(h)) {
    const schluessel = t.gruppe ?? t.name;
    // Allgemeiner „Wal“ nur, wenn es keine bestimmte Walart gibt
    if (t.nichtNeben?.some((g) => tiere.has(g))) continue;
    if (!tiere.has(schluessel) && ![...tiere.values()].some((x) => x.name === t.name)) tiere.set(schluessel, t);
  }
  return [...tiere.values()];
}
