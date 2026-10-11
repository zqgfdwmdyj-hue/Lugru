// Tiere, die Kinder in einer Region entdecken können (Tiere-Bingo in der Kinder-Ansicht).
// Zuordnung über die Koordinaten des Tages – funktioniert ohne Internet und ohne KI.

const T = (emoji, name, satz) => ({ emoji, name, satz });

export const REGIONEN = [
  {
    id: "karibik", name: "Karibik", box: [9, 27.5, -90, -59],
    tiere: [
      T("🐢", "Meeresschildkröte", "Sie kann ihre Luft stundenlang anhalten, wenn sie schläft."),
      T("🦜", "Papagei", "Auf Dominica und St. Lucia leben Papageien, die es sonst nirgends gibt."),
      T("🐦", "Kolibri", "Er schlägt bis zu 80-mal pro Sekunde mit den Flügeln – darum summt er."),
      T("🦎", "Leguan", "Leguane sonnen sich gern auf warmen Steinen und können gut schwimmen."),
      T("🐦", "Pelikan", "Er fängt Fische mit seinem Kehlsack wie mit einem Kescher."),
      T("🐬", "Delfin", "Delfine schlafen mit einer Gehirnhälfte – die andere passt auf."),
      T("🐋", "Pottwal", "Vor Dominica leben Pottwale das ganze Jahr – sie tauchen über 1000 m tief."),
      T("🐠", "Papageifisch", "Aus seinem Kot entsteht weißer Sand für die Strände!"),
      T("🦀", "Landkrabbe", "Sie wohnt in Löchern am Strand und läuft seitwärts."),
      T("🐒", "Grüne Meerkatze", "Auf Barbados und St. Kitts klettern kleine Affen durch die Bäume."),
      T("🦩", "Flamingo", "Auf Bonaire leben viele Flamingos – sie sind rosa vom Futter."),
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
      T("🐋", "Grindwal", "Vor Teneriffa leben Grindwale das ganze Jahr."),
      T("🐬", "Delfin", "Große Tümmler springen oft vor dem Schiff aus dem Wasser."),
      T("🦎", "Rieseneidechse", "Auf den Kanaren gibt es Eidechsen, die so lang wie ein Arm werden."),
      T("🐦", "Kanarienvogel", "Die Inseln haben ihren Namen nicht von ihm – aber er wohnt dort."),
      T("🐢", "Meeresschildkröte", "Manchmal ziehen Schildkröten an den Inseln vorbei."),
      T("🦀", "Rote Klippenkrabbe", "Leuchtend rote Krabben klettern über die Lavafelsen."),
    ],
  },
  {
    id: "mittelmeer", name: "Mittelmeer", box: [30, 46.5, -6, 36.5],
    tiere: [
      T("🐬", "Delfin", "Im Mittelmeer leben mehrere Delfinarten."),
      T("🐙", "Oktopus", "Ein Oktopus hat drei Herzen und blaues Blut."),
      T("🐢", "Unechte Karettschildkröte", "Sie legt in Griechenland und Zypern ihre Eier."),
      T("🐦", "Möwe", "Möwen trinken sogar Salzwasser."),
      T("🦎", "Gecko", "Geckos laufen kopfüber an der Decke."),
      T("🐐", "Bergziege", "Auf den Inseln klettern Ziegen auf steile Felsen."),
      T("🐟", "Zackenbarsch", "Ein großer Fisch, der gern in Höhlen wohnt."),
      T("🪼", "Qualle", "Quallen bestehen fast nur aus Wasser."),
    ],
  },
  {
    id: "norden", name: "Nordeuropa", box: [53, 72, -25, 32],
    tiere: [
      T("🐋", "Buckelwal", "Buckelwale singen lange Lieder unter Wasser."),
      T("🦭", "Robbe", "Robben liegen gern auf Steinen in der Sonne."),
      T("🐧", "Papageitaucher", "Er heißt auch Puffin und hat einen bunten Schnabel."),
      T("🦅", "Seeadler", "Er hat Flügel, die so breit sind wie ein Auto."),
      T("🦌", "Rentier", "Rentiere haben Fell sogar an den Hufen."),
      T("🐟", "Lachs", "Lachse schwimmen den Fluss hinauf und springen über Wasserfälle."),
      T("🐬", "Schweinswal", "Ein kleiner, scheuer Wal in Nord- und Ostsee."),
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
      T("🐟", "Mantarochen", "Mantas sehen aus, als würden sie unter Wasser fliegen."),
      T("🐬", "Delfin", "Spinner-Delfine drehen sich beim Springen in der Luft."),
      T("🦇", "Flughund", "Abends fliegen große Flughunde über die Palmen."),
      T("🐠", "Doktorfisch", "Er hat am Schwanz ein kleines Skalpell."),
    ],
  },
  {
    id: "alaska", name: "Alaska & Kanada", box: [47, 72, -170, -122],
    tiere: [
      T("🐻", "Bär", "Bären fangen im Sommer Lachse direkt aus dem Fluss."),
      T("🐋", "Buckelwal", "Buckelwale jagen gemeinsam mit einem Netz aus Luftblasen."),
      T("🦅", "Weißkopfseeadler", "Das Wappentier der USA."),
      T("🦦", "Seeotter", "Seeotter halten sich beim Schlafen an den Pfoten."),
      T("🦭", "Seelöwe", "Seelöwen bellen laut auf den Felsen."),
    ],
  },
];

export const SEETAG_TIERE = [
  T("🐬", "Delfin", "Delfine schwimmen gern in der Bugwelle des Schiffs."),
  T("🐟", "Fliegender Fisch", "Er gleitet mit seinen Flossen über das Wasser – bis zu 200 Meter weit!"),
  T("🐋", "Wal", "Manchmal sieht man den Blas – eine Wasserfontäne – am Horizont."),
  T("🐦", "Seevogel", "Seevögel begleiten das Schiff oft weit draußen auf dem Meer."),
  T("🌈", "Regenbogen", "Kein Tier – aber auf See sieht man besonders oft Regenbögen."),
];

export function regionFuer(ort) {
  if (!ort || !Number.isFinite(ort.lat) || !Number.isFinite(ort.lng)) return null;
  return REGIONEN.find(({ box: [s, n, w, o] }) => ort.lat >= s && ort.lat <= n && ort.lng >= w && ort.lng <= o) ?? null;
}

/** Tiere für einen Tag (Seetag: Tiere auf See, sonst Region des Ortes). */
export function tiereFuer(tag) {
  if (!tag) return [];
  if ((tag.art ?? (tag.seetag ? "seetag" : "hafen")) === "seetag") return SEETAG_TIERE;
  return regionFuer(tag)?.tiere ?? [];
}

/** Alle Tiere einer Reise, ohne doppelte Namen. */
export function tiereDerReise(reise) {
  const tiere = new Map();
  for (const h of reise?.haefen ?? []) for (const t of tiereFuer(h)) if (!tiere.has(t.name)) tiere.set(t.name, t);
  return [...tiere.values()];
}
