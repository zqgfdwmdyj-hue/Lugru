// GRULU-Produkte: eine Quelle für Box-Finder, Produkthilfe und Countdown.
// Bei neuen Produkten, Preisen oder Amazon-Links nur hier (und in index.html,
// llms.txt, feed/products.jsonl, knowledge.md) ändern.
(function (wurzel) {
  "use strict";
  const PRODUKTE = {
    nerds: {
      name: "Nerds Probierbox", preis: "14,99 €", verfuegbar: true,
      bild: "/img/Nerds-Probierbox-1-768x768.webp",
      url: "https://www.amazon.de/dp/B0H62R2VKD",
      kurz: "4 Nerds-Sorten – bunt und knusprig, gut zum Teilen.",
      inhalt: "4 verschiedene Nerds-Sorten", buch: false,
    },
    pop: {
      name: "Pop Rocks Probierbox", preis: "14,99 €", verfuegbar: true,
      bild: "/img/Pop-Rocks-Probierbox-1-768x768.webp",
      url: "https://www.amazon.de/dp/B0H6CJH7RY",
      kurz: "Knisternder Knallzucker in verschiedenen Sorten – prickelt im Mund.",
      inhalt: "Pop Rocks Knallzucker in verschiedenen Sorten", buch: false,
    },
    schultuete: {
      name: "GRULU Schultüte", preis: "", verfuegbar: true,
      bild: "/img/grulu-schultuete-768x768.webp",
      // Direkter Produktlink fehlt noch – bis dahin die Suche bei Amazon.
      url: "https://www.amazon.de/s?k=GRULU+Schult%C3%BCte", suche: true,
      kurz: "Die bunte GRULU-Schultüte für den großen Tag, mit Überraschungen zum Schulstart.",
      inhalt: "Schultüte mit Überraschungen", buch: false,
    },
    fuellung: {
      name: "Füllung für die Schultüte (28 Teile)", preis: "", verfuegbar: true,
      bild: "/img/Fullmaterial-fur-Schultute-768x768.webp",
      url: "https://www.amazon.de/dp/B0HCCVDJKX",
      kurz: "28 Teile amerikanische und saure Süßigkeiten, ohne Schokolade.",
      inhalt: "28 Teile, ohne Schokolade", buch: false,
    },
    reise: {
      name: "Kinder-Reisebox", preis: "12,99 €", verfuegbar: false,
      bild: "",
      url: "#newsletter",
      kurz: "Snacks für unterwegs und ein kleines GRULU-Buch. Kommt bald zu Amazon.",
      inhalt: "wechselnde Snacks für unterwegs + GRULU-Buch", buch: true,
    },
  };

  // Box-Finder: Antworten → Empfehlung mit Begründung und Alternative.
  // wer: klein | gross | familie · anlass: schule | geschenk | reise | snack
  // typ: pop | nerds | buch
  function empfehlung(wer, anlass, typ) {
    const warum = [];
    let tipp, auch = null;
    if (anlass === "schule") {
      if (wer === "familie") {
        tipp = "fuellung"; auch = "schultuete";
        warum.push("Zum Schulstart für die ganze Familie: die große Füllung mit 28 Teilen reicht für eine ganze Schultüte.");
      } else {
        tipp = "schultuete"; auch = "fuellung";
        warum.push("Zum Schulstart: die GRULU-Schultüte – mit der 28-teiligen Füllung ist sie schnell voll.");
      }
    } else if (typ === "buch" || anlass === "reise") {
      tipp = "reise";
      auch = typ === "pop" ? "pop" : "nerds";
      warum.push(typ === "buch"
        ? "Ihr wolltet Snacks und eine Geschichte: In der Kinder-Reisebox liegt das GRULU-Buch bei."
        : "Für unterwegs: die Kinder-Reisebox mit Snacks und kleinem GRULU-Buch.");
      warum.push(`Sie kommt erst bald zu Amazon – bis dahin passt die ${PRODUKTE[auch].name}.`);
    } else if (typ === "pop") {
      tipp = "pop"; auch = "nerds";
      warum.push("Ihr wolltet Knistern & Prickeln: Pop Rocks knistert und prickelt im Mund.");
    } else {
      tipp = "nerds"; auch = "pop";
      warum.push("Ihr wolltet es bunt & knusprig: 4 Nerds-Sorten in einer Box.");
    }
    if (anlass === "geschenk" && tipp !== "reise") warum.push("Schön verpackt – gut zum Verschenken.");
    if (typ === "pop" && wer === "klein") warum.push("Knallzucker ist für Kinder ab 4 gut geeignet, für Kleinkinder unter 3 nicht.");
    return { tipp, auch, warum };
  }

  const api = { PRODUKTE, empfehlung };
  wurzel.GRULU_PRODUKTE = api;
})(window);
