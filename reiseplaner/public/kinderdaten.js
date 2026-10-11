// Inhalte für den Kinder-Bereich: Länder-Steckbriefe, Wörterbuch, Schatzsuche, Rätsel, Abzeichen.
// Alles fest eingebaut – funktioniert ohne Internet auf See.

// ---------- Länder & Inseln ----------
// box: Gebiet [S, N, W, O] für Inseln, die politisch zu einem anderen Land gehören (z. B. Martinique → Frankreich)
const L = (name, flagge, sprache, hauptstadt, waehrung, essen, fakt, extra = {}) => ({ name, flagge, sprache, hauptstadt, waehrung, essen, fakt, ...extra });

export const LAENDER = [
  L("Dominikanische Republik", "🇩🇴", "es", "Santo Domingo", "Dominikanischer Peso", "Mangú (Bananenbrei)", "Hier wurde die erste Stadt Europas in Amerika gebaut – vor über 500 Jahren.", { namen: ["dominikanische republik", "república dominicana", "dominican republic"] }),
  L("St. Lucia", "🇱🇨", "en", "Castries", "Ostkaribischer Dollar", "Grüne Bananen mit Salzfisch", "Die zwei spitzen Berge „Pitons“ sind fast 800 m hoch – und auf der Flagge!", { namen: ["st. lucia", "saint lucia", "sankt lucia"], sprache2: "fr" }),
  L("Barbados", "🇧🇧", "en", "Bridgetown", "Barbados-Dollar", "Fliegender Fisch mit Cou-Cou", "Auf der Flagge ist ein Dreizack – vom Meeresgott Neptun.", { namen: ["barbados"] }),
  L("Grenada", "🇬🇩", "en", "St. George's", "Ostkaribischer Dollar", "Oil Down (Eintopf)", "Grenada heißt „Gewürzinsel“ – auf der Flagge ist eine Muskatnuss!", { namen: ["grenada"] }),
  L("St. Vincent und die Grenadinen", "🇻🇨", "en", "Kingstown", "Ostkaribischer Dollar", "Gegrillte Brotfrucht", "Hier wurde der Film „Fluch der Karibik“ gedreht.", { namen: ["st. vincent", "saint vincent", "st. vincent und die grenadinen"] }),
  L("Martinique", "🇫🇷", "fr", "Fort-de-France", "Euro", "Accras (Fischbällchen)", "Martinique gehört zu Frankreich – hier zahlt man mit Euro, mitten in der Karibik!", { namen: ["martinique"], box: [14.35, 14.9, -61.25, -60.8] }),
  L("Guadeloupe", "🇫🇷", "fr", "Basse-Terre", "Euro", "Colombo (Curry)", "Die Insel sieht von oben aus wie ein Schmetterling.", { namen: ["guadeloupe"], box: [15.8, 16.55, -61.85, -61.0] }),
  L("Dominica", "🇩🇲", "en", "Roseau", "Ostkaribischer Dollar", "Callaloo-Suppe", "Dominica hat 365 Flüsse – einen für jeden Tag im Jahr.", { namen: ["dominica"] }),
  L("Antigua und Barbuda", "🇦🇬", "en", "St. John's", "Ostkaribischer Dollar", "Fungie mit Pfeffertopf", "Antigua hat 365 Strände – einen für jeden Tag im Jahr.", { namen: ["antigua", "antigua und barbuda"] }),
  L("St. Kitts und Nevis", "🇰🇳", "en", "Basseterre", "Ostkaribischer Dollar", "Ziegeneintopf", "Hier gibt es mehr Affen als Menschen!", { namen: ["st. kitts", "saint kitts", "st. kitts und nevis"] }),
  L("Bahamas", "🇧🇸", "en", "Nassau", "Bahama-Dollar", "Conch (Riesenmuschel)", "Auf einer Insel schwimmen Schweine im Meer.", { namen: ["bahamas"] }),
  L("Jamaika", "🇯🇲", "en", "Kingston", "Jamaika-Dollar", "Jerk Chicken", "Der schnellste Läufer der Welt, Usain Bolt, kommt von hier.", { namen: ["jamaika", "jamaica"] }),
  L("Kuba", "🇨🇺", "es", "Havanna", "Kubanischer Peso", "Reis mit schwarzen Bohnen", "Hier fahren noch ganz alte bunte Autos herum.", { namen: ["kuba", "cuba"] }),
  L("Aruba", "🇦🇼", "pap", "Oranjestad", "Aruba-Florin", "Keshi Yena (gefüllter Käse)", "Auf Aruba regnet es ganz selten – fast immer Sonne!", { namen: ["aruba"], box: [12.4, 12.65, -70.1, -69.85] }),
  L("Curaçao", "🇨🇼", "pap", "Willemstad", "Gulden", "Stoba (Eintopf)", "Die Häuser in Willemstad sind so bunt wie Bonbons.", { namen: ["curaçao", "curacao"], box: [12, 12.4, -69.2, -68.7] }),
  L("Bonaire", "🇧🇶", "pap", "Kralendijk", "US-Dollar", "Fisch mit Funchi", "Bonaire ist eines der besten Tauchgebiete der Welt.", { namen: ["bonaire"], box: [12, 12.35, -68.45, -68.15] }),
  L("Mexiko", "🇲🇽", "es", "Mexiko-Stadt", "Mexikanischer Peso", "Tacos", "Die Maya bauten hier riesige Pyramiden.", { namen: ["mexiko", "méxico", "mexico"] }),
  L("USA", "🇺🇸", "en", "Washington", "US-Dollar", "Burger", "Die USA haben 50 Bundesstaaten – die Sterne auf der Flagge.", { namen: ["vereinigte staaten", "usa", "united states"] }),
  L("Kanarische Inseln", "🇪🇸", "es", "Madrid (Spanien)", "Euro", "Papas arrugadas (Runzelkartoffeln)", "Auf Teneriffa steht der höchste Berg Spaniens – ein Vulkan!", { namen: [], box: [27.5, 29.5, -18.5, -13.3] }),
  L("Madeira", "🇵🇹", "pt", "Lissabon (Portugal)", "Euro", "Espetada (Fleischspieß)", "Hier fährt man in Korbschlitten die Straße hinunter!", { namen: ["madeira"], box: [32.5, 33.2, -17.4, -16.2] }),
  L("Spanien", "🇪🇸", "es", "Madrid", "Euro", "Paella", "In Spanien isst man oft erst um 21 Uhr zu Abend.", { namen: ["spanien", "españa"] }),
  L("Portugal", "🇵🇹", "pt", "Lissabon", "Euro", "Pastel de Nata", "In Lissabon fahren alte gelbe Straßenbahnen.", { namen: ["portugal"] }),
  L("Italien", "🇮🇹", "it", "Rom", "Euro", "Pizza", "Italien sieht auf der Landkarte aus wie ein Stiefel.", { namen: ["italien", "italia"] }),
  L("Griechenland", "🇬🇷", "el", "Athen", "Euro", "Gyros", "Hier fanden die ersten Olympischen Spiele statt.", { namen: ["griechenland", "ελλάδα", "ellada"] }),
  L("Kroatien", "🇭🇷", "hr", "Zagreb", "Euro", "Ćevapčići", "Kroatien hat über 1000 Inseln.", { namen: ["kroatien", "hrvatska"] }),
  L("Frankreich", "🇫🇷", "fr", "Paris", "Euro", "Croissant", "Der Eiffelturm wird im Sommer ein paar Zentimeter größer – durch die Wärme.", { namen: ["frankreich", "france"] }),
  L("Malta", "🇲🇹", "en", "Valletta", "Euro", "Pastizzi", "Malta ist so klein, dass man es in einem Tag umrunden kann.", { namen: ["malta"] }),
  L("Türkei", "🇹🇷", "tr", "Ankara", "Türkische Lira", "Döner", "Istanbul liegt auf zwei Kontinenten: Europa und Asien.", { namen: ["türkei", "türkiye", "turkey"] }),
  L("Zypern", "🇨🇾", "el", "Nikosia", "Euro", "Halloumi", "Hier soll die Göttin Aphrodite aus dem Meer gestiegen sein.", { namen: ["zypern", "cyprus", "κύπρος"] }),
  L("Ägypten", "🇪🇬", "ar", "Kairo", "Ägyptisches Pfund", "Falafel", "Die Pyramiden sind über 4500 Jahre alt.", { namen: ["ägypten", "egypt", "مصر"] }),
  L("Vereinigte Arabische Emirate", "🇦🇪", "ar", "Abu Dhabi", "Dirham", "Hummus", "In Dubai steht das höchste Haus der Welt: über 800 m!", { namen: ["vereinigte arabische emirate", "emirate"] }),
  L("Oman", "🇴🇲", "ar", "Maskat", "Omanischer Rial", "Shuwa (Lamm)", "Im Oman gibt es Wüste, Berge und Meer – alles nah beieinander.", { namen: ["oman"] }),
  L("Norwegen", "🇳🇴", "no", "Oslo", "Norwegische Krone", "Lachs", "Im Sommer wird es im Norden nachts gar nicht dunkel.", { namen: ["norwegen", "norge"] }),
  L("Island", "🇮🇸", "is", "Reykjavík", "Isländische Krone", "Skyr", "Auf Island gibt es Geysire, die heißes Wasser in die Luft spritzen.", { namen: ["island", "ísland"] }),
  L("Dänemark", "🇩🇰", "da", "Kopenhagen", "Dänische Krone", "Smørrebrød", "LEGO wurde in Dänemark erfunden!", { namen: ["dänemark", "danmark"] }),
  L("Schweden", "🇸🇪", "sv", "Stockholm", "Schwedische Krone", "Köttbullar", "Pippi Langstrumpf kommt aus Schweden.", { namen: ["schweden", "sverige"] }),
  L("Großbritannien", "🇬🇧", "en", "London", "Pfund", "Fish and Chips", "Die Uhr „Big Ben“ ist eigentlich der Name der Glocke.", { namen: ["vereinigtes königreich", "großbritannien", "united kingdom", "england", "schottland"] }),
  L("Niederlande", "🇳🇱", "nl", "Amsterdam", "Euro", "Poffertjes", "Viele Teile des Landes liegen unter dem Meeresspiegel.", { namen: ["niederlande", "nederland"] }),
  L("Deutschland", "🇩🇪", "de", "Berlin", "Euro", "Brezel", "In Deutschland gibt es über 3000 Brotsorten.", { namen: ["deutschland"] }),
  L("Österreich", "🇦🇹", "de", "Wien", "Euro", "Kaiserschmarrn", "In Österreich gibt es über 900 Berggipfel mit mehr als 3000 m.", { namen: ["österreich"] }),
  L("Schweiz", "🇨🇭", "de", "Bern", "Schweizer Franken", "Käsefondue", "Die Schweiz hat vier Landessprachen.", { namen: ["schweiz", "suisse", "svizzera"] }),
  L("Marokko", "🇲🇦", "ar", "Rabat", "Dirham", "Couscous", "In Marokko klettern Ziegen auf Bäume!", { namen: ["marokko", "maroc", "المغرب"] }),
  L("Thailand", "🇹🇭", "th", "Bangkok", "Baht", "Pad Thai", "Der Elefant ist das Nationaltier Thailands.", { namen: ["thailand", "ประเทศไทย"] }),
  L("Malediven", "🇲🇻", "en", "Malé", "Rufiyaa", "Mas Huni (Thunfisch mit Kokos)", "Die Malediven bestehen aus fast 1200 kleinen Inseln.", { namen: ["malediven", "maldives"] }),
  L("Mauritius", "🇲🇺", "fr", "Port Louis", "Mauritius-Rupie", "Dholl Puri", "Hier lebte früher der Dodo – ein Vogel, der nicht fliegen konnte.", { namen: ["mauritius"] }),
  L("Seychellen", "🇸🇨", "en", "Victoria", "Seychellen-Rupie", "Fischcurry", "Hier wächst die größte Nuss der Welt: die Seychellennuss.", { namen: ["seychellen", "seychelles"] }),
];

const imGebiet = (o, [s, n, w, e]) => o.lat >= s && o.lat <= n && o.lng >= w && o.lng <= e;

/** Land bzw. Insel eines Tages (zuerst über die Koordinaten, dann über den Ländernamen). */
export function landFuer(tag) {
  if (!tag || (tag.art ?? "hafen") === "seetag") return null;
  if (Number.isFinite(tag.lat)) {
    const nachGebiet = LAENDER.find((l) => l.box && imGebiet(tag, l.box));
    if (nachGebiet) return nachGebiet;
  }
  const land = String(tag.land ?? "").trim().toLowerCase();
  const genau = LAENDER.find((l) => l.namen.includes(land));
  if (genau) return genau;
  // Sonst ganze Wörter im Orts-/Ländernamen (damit „La Romana“ nicht als „Oman“ gilt)
  const text = ` ${land} ${String(tag.name ?? "").toLowerCase()} `.replace(/[,()]/g, " ");
  return LAENDER.find((l) => l.namen.some((n) => n && text.includes(` ${n} `))) ?? null;
}

// ---------- Wörterbuch ----------

export const SPRACHEN = { en: "Englisch", fr: "Französisch", es: "Spanisch", it: "Italienisch", pt: "Portugiesisch", el: "Griechisch", hr: "Kroatisch", tr: "Türkisch", ar: "Arabisch", nl: "Niederländisch", no: "Norwegisch", da: "Dänisch", sv: "Schwedisch", is: "Isländisch", th: "Thailändisch", pap: "Papiamento", de: "Deutsch" };

// [Deutsch, Übersetzung, Aussprache]
const W = (...zeilen) => zeilen;
export const WOERTER = {
  en: W(["Hallo", "Hello", "hel-lo"], ["Danke", "Thank you", "fänk ju"], ["Bitte", "Please", "plies"], ["Ein Eis, bitte", "An ice cream, please", "än eis kriem, plies"], ["Wie heißt du?", "What's your name?", "wots jor nehm"], ["Ich heiße …", "My name is …", "mai nehm is"], ["Wo ist die Toilette?", "Where is the toilet?", "wär is se teulett"], ["Lecker!", "Yummy!", "jammi"], ["Tschüss", "Bye", "bai"]),
  fr: W(["Hallo", "Bonjour", "bong-schur"], ["Danke", "Merci", "mär-ssi"], ["Bitte", "S'il vous plaît", "ssil wu plä"], ["Ein Eis, bitte", "Une glace, s'il vous plaît", "ün glass, ssil wu plä"], ["Wie heißt du?", "Comment tu t'appelles ?", "ko-mong tü ta-pell"], ["Ich heiße …", "Je m'appelle …", "schö ma-pell"], ["Wo ist die Toilette?", "Où sont les toilettes ?", "u ssong le tua-lett"], ["Lecker!", "C'est bon !", "ssä bong"], ["Tschüss", "Au revoir", "o rö-woar"]),
  es: W(["Hallo", "Hola", "o-la"], ["Danke", "Gracias", "gra-ssjas"], ["Bitte", "Por favor", "por fa-wor"], ["Ein Eis, bitte", "Un helado, por favor", "un e-la-do, por fa-wor"], ["Wie heißt du?", "¿Cómo te llamas?", "ko-mo te ja-mas"], ["Ich heiße …", "Me llamo …", "me ja-mo"], ["Wo ist die Toilette?", "¿Dónde está el baño?", "don-de es-ta el ba-njo"], ["Lecker!", "¡Qué rico!", "ke ri-ko"], ["Tschüss", "Adiós", "a-djos"]),
  it: W(["Hallo", "Ciao", "tschau"], ["Danke", "Grazie", "gra-tsje"], ["Bitte", "Per favore", "per fa-wo-re"], ["Ein Eis, bitte", "Un gelato, per favore", "un dsche-la-to, per fa-wo-re"], ["Wie heißt du?", "Come ti chiami?", "ko-me ti kja-mi"], ["Ich heiße …", "Mi chiamo …", "mi kja-mo"], ["Wo ist die Toilette?", "Dov'è il bagno?", "do-wä il ba-njo"], ["Lecker!", "Buonissimo!", "bwo-nis-si-mo"], ["Tschüss", "Ciao", "tschau"]),
  pt: W(["Hallo", "Olá", "o-la"], ["Danke", "Obrigado / Obrigada", "o-bri-ga-du"], ["Bitte", "Por favor", "pur fa-wor"], ["Ein Eis, bitte", "Um gelado, por favor", "um sche-la-du, pur fa-wor"], ["Wie heißt du?", "Como te chamas?", "ko-mu te scha-masch"], ["Ich heiße …", "Chamo-me …", "scha-mu-me"], ["Lecker!", "Delicioso!", "de-li-ssjo-su"], ["Tschüss", "Tchau", "tschau"]),
  el: W(["Hallo", "Γεια σου (Jassu)", "ja-ssu"], ["Danke", "Ευχαριστώ (Efcharistó)", "ef-cha-ri-sto"], ["Bitte", "Παρακαλώ (Parakaló)", "pa-ra-ka-lo"], ["Ein Eis, bitte", "Ένα παγωτό, παρακαλώ", "e-na pa-go-to, pa-ra-ka-lo"], ["Lecker!", "Νόστιμο! (Nóstimo)", "no-sti-mo"], ["Tschüss", "Αντίο (Andío)", "an-di-o"]),
  hr: W(["Hallo", "Bok", "bok"], ["Danke", "Hvala", "chwa-la"], ["Bitte", "Molim", "mo-lim"], ["Ein Eis, bitte", "Jedan sladoled, molim", "je-dan sla-do-led, mo-lim"], ["Lecker!", "Fino!", "fi-no"], ["Tschüss", "Bok", "bok"]),
  tr: W(["Hallo", "Merhaba", "mer-ha-ba"], ["Danke", "Teşekkürler", "te-schek-kür-ler"], ["Bitte", "Lütfen", "lüt-fen"], ["Ein Eis, bitte", "Bir dondurma, lütfen", "bir don-dur-ma, lüt-fen"], ["Lecker!", "Çok güzel!", "tschok gü-sel"], ["Tschüss", "Güle güle", "gü-le gü-le"]),
  ar: W(["Hallo", "مرحبا (Marhaba)", "mar-ha-ba"], ["Danke", "شكرا (Shukran)", "schuk-ran"], ["Bitte", "من فضلك (Min fadlak)", "min fad-lak"], ["Lecker!", "لذيذ (Ladhidh)", "la-sies"], ["Tschüss", "مع السلامة (Ma'a salama)", "ma-a sa-la-ma"]),
  nl: W(["Hallo", "Hallo", "hal-lo"], ["Danke", "Dank je", "dank je"], ["Bitte", "Alsjeblieft", "al-sche-blieft"], ["Ein Eis, bitte", "Een ijsje, alsjeblieft", "en ei-sche, al-sche-blieft"], ["Lecker!", "Lekker!", "lek-ker"], ["Tschüss", "Doei", "dui"]),
  no: W(["Hallo", "Hei", "hei"], ["Danke", "Takk", "tak"], ["Bitte", "Vær så snill", "wär so snil"], ["Ein Eis, bitte", "En is, takk", "en ies, tak"], ["Lecker!", "Nydelig!", "nü-de-li"], ["Tschüss", "Ha det", "ha de"]),
  da: W(["Hallo", "Hej", "hai"], ["Danke", "Tak", "tak"], ["Ein Eis, bitte", "En is, tak", "en ies, tak"], ["Lecker!", "Lækkert!", "lek-kert"], ["Tschüss", "Hej hej", "hai hai"]),
  sv: W(["Hallo", "Hej", "hej"], ["Danke", "Tack", "tack"], ["Ein Eis, bitte", "En glass, tack", "en glass, tack"], ["Lecker!", "Gott!", "gott"], ["Tschüss", "Hej då", "hej do"]),
  is: W(["Hallo", "Halló", "hal-lou"], ["Danke", "Takk", "tahk"], ["Tschüss", "Bless", "bless"]),
  th: W(["Hallo", "สวัสดี (Sawasdee)", "sa-wat-dii"], ["Danke", "ขอบคุณ (Khop khun)", "kop-kun"], ["Lecker!", "อร่อย (Aroi)", "a-roi"]),
  pap: W(["Hallo", "Bon dia", "bon di-a"], ["Danke", "Danki", "dan-ki"], ["Bitte", "Por fabor", "por fa-bor"], ["Ein Eis, bitte", "Un ijs, por fabor", "un ais, por fa-bor"], ["Lecker!", "Dushi!", "du-schi"], ["Tschüss", "Ayo", "a-jo"]),
};

// ---------- Schatzsuche ----------

export const SCHATZ_LAND = [
  "Finde eine blaue Tür 🚪", "Zähle die Palmen, die du siehst 🌴", "Mach ein Foto vom Schiff aus der Ferne 🛳️", "Entdecke ein Tier, das du noch nie gesehen hast 🦎",
  "Finde eine Blume in deiner Lieblingsfarbe 🌺", "Probiere eine Frucht, die du nicht kennst 🥭", "Finde ein Schild in einer fremden Sprache 🪧", "Sammle einen schönen Stein oder eine Muschel 🐚",
  "Finde ein Haus mit mindestens drei Farben 🏠", "Sag zu jemandem „Danke“ in der Landessprache 🗣️", "Finde etwas, das so groß ist wie du 📏", "Entdecke eine Katze oder einen Hund 🐕",
  "Finde einen Vogel und mach ihn nach 🐦", "Zeichne heute Abend, was du gesehen hast ✏️", "Finde etwas Rundes, etwas Eckiges und etwas Spitzes 🔺", "Mach ein lustiges Familienfoto 📸",
  "Finde die Flagge des Landes 🏳️", "Zähle die Boote im Hafen ⛵", "Finde einen Baum, den du nicht umarmen kannst 🌳", "Hör genau hin: Welche Musik spielt hier? 🎶",
];
export const SCHATZ_SEE = [
  "Finde die Rettungsboote und zähle sie 🛟", "Entdecke den Kapitän oder einen Offizier 👨‍✈️", "Finde das höchste Deck 🧭", "Halte Ausschau nach Delfinen oder fliegenden Fischen 🐬",
  "Lerne den Namen von jemandem aus der Crew 👋", "Finde heraus, wie schnell das Schiff fährt 🚀", "Zähle die Liegen am Pool ☀️", "Finde die Kinderclub-Tür 🧒",
  "Mach ein Foto vom Kielwasser hinter dem Schiff 🌊", "Probiere eine neue Eissorte 🍦", "Finde die Bordkarte auf einem Plan des Schiffs 🗺️", "Entdecke einen Regenbogen oder eine besondere Wolke ☁️",
];

/** 5 Aufgaben für einen Tag – immer dieselben für denselben Tag. */
export function schatzAufgaben(tag) {
  if (!tag) return [];
  const pool = (tag.art ?? "hafen") === "seetag" ? SCHATZ_SEE : SCHATZ_LAND;
  let h = 0;
  for (const c of `${tag.id}${tag.datum}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const auswahl = [];
  const frei = [...pool.keys()];
  for (let i = 0; i < Math.min(5, pool.length); i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    auswahl.push({ nr: i, text: pool[frei.splice(h % frei.length, 1)[0]] });
  }
  return auswahl;
}

// ---------- Rätsel, Witze & Spiele für Wartezeiten ----------

export const RAETSEL = [
  ["Was hat Zähne, aber kann nicht beißen?", "Ein Kamm"],
  ["Was wird nasser, je mehr es trocknet?", "Ein Handtuch"],
  ["Welches Tier trägt sein Haus immer mit sich herum?", "Die Schnecke (oder die Schildkröte) 🐌"],
  ["Was ist schwerer: ein Kilo Federn oder ein Kilo Steine?", "Beide gleich schwer!"],
  ["Was läuft, hat aber keine Beine?", "Die Nase (oder die Zeit)"],
  ["Welches Tier kann höher springen als ein Haus?", "Jedes – Häuser können nicht springen!"],
  ["Was hat ein Bett, schläft aber nie?", "Ein Fluss"],
  ["Was gehört dir, aber andere benutzen es öfter?", "Dein Name"],
  ["Je mehr du wegnimmst, desto größer wird es. Was ist das?", "Ein Loch"],
  ["Was kann um die Welt reisen und bleibt doch in der Ecke?", "Eine Briefmarke"],
  ["Was hat viele Schlüssel, aber kann keine Tür öffnen?", "Ein Klavier"],
  ["Was ist immer vor dir, aber du kannst es nie sehen?", "Die Zukunft"],
];

export const WITZE = [
  "Was sagt der große Stift zum kleinen Stift? Wachs-mal-stift!",
  "Warum können Seeräuber keinen Kreis berechnen? Weil sie Pi raten!",
  "Was macht ein Pirat am Computer? Er drückt die Enter-Taste!",
  "Wie heißt ein Fisch ohne Augen? Fsch!",
  "Was ist grün und klopft an die Tür? Ein Klopfsalat!",
  "Treffen sich zwei Wale. Sagt der eine: „Lange nicht gesehen!“ – „Ja, ich war auf Tauchstation.“",
  "Warum schwimmen Haie nur im Salzwasser? Weil sie im Pfefferwasser niesen müssen!",
];

export const ICH_SEHE_FARBEN = [["rot", "#e53935"], ["blau", "#1e88e5"], ["grün", "#43a047"], ["gelb", "#fdd835"], ["orange", "#fb8c00"], ["lila", "#8e24aa"], ["weiß", "#ffffff"], ["schwarz", "#212121"], ["pink", "#ec407a"], ["braun", "#6d4c41"]];

export const WER_FINDET = ["etwas, das fliegt", "jemanden mit Hut", "ein gelbes Auto", "einen Koffer mit Aufkleber", "ein Schild mit einer Zahl über 100", "etwas Gestreiftes", "eine Sonnenbrille", "ein Baby", "etwas aus Holz", "einen Hund", "etwas Rundes", "eine Uniform"];

export const PANTOMIME = ["Delfin", "Pirat", "Kapitän", "Krabbe", "Schildkröte", "Pelikan", "Taucher", "Koch", "Eis essen", "Sonnenbrand", "Surfer", "Affe", "Flamingo", "Koffer packen"];

// ---------- Abzeichen ----------

// auto(z): z = Kennzahlen der Reise (siehe kinderwelt.js) → true, wenn verdient
export const ABZEICHEN = [
  { id: "erster-stempel", emoji: "🛂", name: "Erster Stempel", text: "Den ersten Ort besucht", auto: (z) => z.stempel >= 1 },
  { id: "fuenf-stempel", emoji: "🗺️", name: "Weltenbummler", text: "5 Orte besucht", auto: (z) => z.stempel >= 5 },
  { id: "zehn-stempel", emoji: "🌍", name: "Entdecker-Profi", text: "10 Orte besucht", auto: (z) => z.stempel >= 10 },
  { id: "drei-laender", emoji: "🏳️", name: "Länder-Sammler", text: "3 Länder besucht", auto: (z) => z.laender >= 3 },
  { id: "seetag", emoji: "🌊", name: "Seebär", text: "Einen Seetag erlebt", auto: (z) => z.seetage >= 1 },
  { id: "tier-1", emoji: "🔍", name: "Tier-Spürnase", text: "Das erste Tier entdeckt", auto: (z) => z.tiere >= 1 },
  { id: "tier-5", emoji: "🦜", name: "Tierforscher", text: "5 Tiere entdeckt", auto: (z) => z.tiere >= 5 },
  { id: "tier-10", emoji: "🏆", name: "Tier-Champion", text: "10 Tiere entdeckt", auto: (z) => z.tiere >= 10 },
  { id: "schatz-5", emoji: "💎", name: "Schatzsucher", text: "5 Schatz-Aufgaben gelöst", auto: (z) => z.schatz >= 5 },
  { id: "quiz-perfekt", emoji: "🧠", name: "Quiz-Ass", text: "Ein Quiz ohne Fehler", auto: (z) => z.quizPerfekt },
  { id: "tagebuch-3", emoji: "📔", name: "Reporter", text: "3 Tage Tagebuch geschrieben", auto: (z) => z.tagebuch >= 3 },
  { id: "neues-essen", emoji: "🍽️", name: "Mutiger Esser", text: "Etwas ganz Neues probiert" },
  { id: "schnorcheln", emoji: "🤿", name: "Unterwasser-Held", text: "Zum ersten Mal geschnorchelt oder getaucht" },
  { id: "sprache", emoji: "🗣️", name: "Sprachtalent", text: "In einer fremden Sprache gesprochen" },
  { id: "mutprobe", emoji: "🦁", name: "Mutig!", text: "Eine Mutprobe geschafft" },
  { id: "helfer", emoji: "🤝", name: "Super-Helfer", text: "Toll geholfen" },
  { id: "wandern", emoji: "🥾", name: "Wanderprofi", text: "Ohne Meckern gewandert" },
  { id: "freund", emoji: "👫", name: "Neue Freunde", text: "Ein neues Kind kennengelernt" },
  { id: "sonnenaufgang", emoji: "🌅", name: "Frühaufsteher", text: "Den Sonnenaufgang gesehen" },
];

// ---------- Packliste mit Bildern ----------

const PACK_BILDER = [
  [/kuschel/i, "🧸"], [/bade|bikini|badehose/i, "🩱"], [/sonnencreme|lsf|after-sun/i, "🧴"], [/sonnenbrille|brille/i, "🕶️"], [/hut|kappe|mütze/i, "🧢"],
  [/schuh|sandale|flip/i, "👟"], [/schlafanzug|schlafsachen|pyjama/i, "🩳"], [/zahnbürste|zahn/i, "🪥"], [/buch/i, "📚"], [/spiel|karten/i, "🎲"],
  [/tablet|kopfhörer|film/i, "🎧"], [/handtuch|strandtuch/i, "🏖️"], [/schnorchel|maske|taucher/i, "🤿"], [/schwimmflügel|schwimmweste/i, "🛟"],
  [/pass|ausweis/i, "🛂"], [/snack|proviant/i, "🍪"], [/flasche|wasser/i, "💧"], [/jacke|regen/i, "🧥"], [/socke/i, "🧦"], [/t-shirt|shirt|kleid/i, "👕"],
  [/hose/i, "👖"], [/unterwäsche/i, "🩲"], [/medikament|apotheke|pflaster|thermometer/i, "🩹"], [/kamera/i, "📷"], [/stift|malen|block/i, "🖍️"],
  [/rucksack/i, "🎒"], [/ball/i, "⚽"], [/handschuh/i, "🧤"], [/helm/i, "⛑️"], [/skipass|ski/i, "⛷️"],
];
export const packBild = (text) => PACK_BILDER.find(([re]) => re.test(text))?.[1] ?? "📦";

/** Kleine Abzählfunktion für das Quiz: immer dieselbe Reihenfolge je Tag. */
export function mischen(liste, saat) {
  let h = 0;
  for (const c of String(saat)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Gute-Nacht-Geschichte ohne KI ----------

/** Kleine Geschichte aus Bausteinen (wenn keine KI da ist oder offline). */
export function geschichteOhneKi({ kinder, ort, seetag, tier, erlebnis, schiff }, saat = "") {
  const namen = kinder.length ? (kinder.length === 1 ? kinder[0] : `${kinder.slice(0, -1).join(", ")} und ${kinder.at(-1)}`) : "die Kinder";
  const sie = kinder.length === 1 ? "es" : "sie";
  const anfang = seetag
    ? `Heute war ein ganz besonderer Tag: Rundherum war nur Meer, so weit ${namen} schauen konnten. ${schiff ? `Die ${schiff}` : "Das Schiff"} schaukelte sanft, und der Wind roch nach Salz und Abenteuer.`
    : `Heute waren ${namen} in ${ort}. Die Sonne kitzelte auf der Nase, und überall gab es etwas Neues zu entdecken.`;
  const mitte = tier
    ? `Plötzlich entdeckten ${sie} ein Tier, das ganz neugierig zurückschaute. Wisst ihr, wer es war? Es war: ${tier}! Es schien zu sagen: „Hallo, ihr Reisenden!“ ${namen} winkten, und das Tier blinzelte freundlich.`
    : `${namen} hielten Ausschau nach Tieren – und ganz am Ende des Tages sahen ${sie} einen Vogel, der dreimal um sie herumflog, als wolle er „Gute Nacht“ sagen.`;
  const erlebnisSatz = erlebnis ? `Das Schönste war aber „${erlebnis}“. Davon wollten ${sie} noch lange erzählen.` : `Sie sammelten so viele schöne Erinnerungen, dass ihr Herz ganz warm wurde.`;
  const ende = [
    "Jetzt ist es Abend. Draußen funkeln die Sterne, und das Meer singt ein leises Lied. Die Augen werden schwer … und schwerer … Morgen wartet ein neues Abenteuer. Gute Nacht!",
    "Der Mond schaut durchs Fenster und flüstert: „Schlaft gut, ihr kleinen Entdecker.“ Und während die Wellen leise rauschen, träumen alle von Palmen, Tieren und Sonnenschein. Gute Nacht!",
    "Ganz langsam wird es still. Nur das Meer rauscht – hin und her, hin und her. Es ist das schönste Schlaflied der Welt. Gute Nacht und süße Träume!",
  ];
  let h = 0;
  for (const c of String(saat)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `## ${seetag ? "Die Reise übers große Meer" : `Ein Abenteuer in ${ort}`}\n\n${anfang}\n\n${mitte}\n\n${erlebnisSatz}\n\n${ende[h % ende.length]}`;
}

// ---------- Zahlen-Spaß ----------

/** Bekannte Schiffslängen in Metern (Mein Schiff). */
export const SCHIFFSLAENGEN = [[/mein schiff (1|2|7)\b/i, 316], [/mein schiff (3|4|5|6)\b/i, 295], [/mein schiff/i, 300]];

export function zahlenSpass({ km, tage, orte, laender, schiff }) {
  const fakten = [];
  const zahl = (n) => Math.round(n).toLocaleString("de-DE");
  if (km > 0) {
    fakten.push(`🛳️ Wir sind schon ca. <strong>${zahl(km)} km</strong> unterwegs – das ist ${km > 600 ? `${(km / 612).toFixed(1).replace(".", ",")}-mal von Hamburg nach München` : `${zahl(km / 0.4)} Runden um einen Sportplatz`}!`);
    fakten.push(`🚶 Zu Fuß bräuchtest du dafür etwa <strong>${zahl(km / 25)} Tage</strong> (25 km pro Tag).`);
    fakten.push(`🐆 Ein Gepard (110 km/h) wäre <strong>${zahl(km / 110)} Stunden</strong> gerannt – ohne Pause!`);
    fakten.push(`🐢 Eine Meeresschildkröte (ca. 2 km/h) bräuchte <strong>${zahl(km / 48)} Tage</strong> dafür.`);
  }
  const laenge = SCHIFFSLAENGEN.find(([re]) => re.test(schiff ?? ""))?.[1];
  if (laenge) {
    fakten.push(`📏 Unser Schiff ist etwa <strong>${laenge} m</strong> lang – so lang wie <strong>${(laenge / 105).toFixed(1).replace(".", ",")} Fußballfelder</strong> hintereinander!`);
    fakten.push(`🚌 Das sind ungefähr <strong>${zahl(laenge / 12)} Busse</strong> in einer Reihe.`);
  }
  if (tage) fakten.push(`📅 Die Reise dauert <strong>${tage} Tage</strong> – das sind <strong>${zahl(tage * 24)} Stunden</strong> Urlaub!`);
  if (orte) fakten.push(`📍 <strong>${orte}</strong> Orte${laender ? ` in <strong>${laender}</strong> Ländern` : ""} – mehr als manche Leute in ihrem ganzen Leben sehen.`);
  return fakten;
}
