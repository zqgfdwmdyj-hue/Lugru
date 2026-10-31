// Lernpfad „Uhren Buy & Flip“ (gebraucht und neu). Bewusst ohne konkrete Marktpreise – die ändern sich und
// gehören in die eigene Marktbeobachtung. Recht und Steuern nur als Überblick, keine Beratung.

export type Quiz = { q: string; options: string[]; answer: number; why: string };
export type Track = "start" | "gebraucht" | "neu" | "geld" | "verkauf";
export type Lesson = {
  key: string;
  title: string;
  track: Track;
  minutes: number;
  /** Was du danach kannst. */
  goal: string;
  sections: { h: string; points: string[] }[];
  /** Übung mit den Werkzeugen (Rechner, Marktpreise, Deals). */
  practice: { text: string; href: string; label: string };
  quiz: Quiz[];
};

export const TRACK_LABEL: Record<Track, string> = { start: "Start", gebraucht: "Gebrauchte Uhren", neu: "Neue Uhren", geld: "Geld & Recht", verkauf: "Verkaufen" };

const BASE = "/marken/uhren";

export const LESSONS: Lesson[] = [
  {
    key: "grundlagen",
    title: "Buy & Flip in 5 Minuten",
    track: "start",
    minutes: 5,
    goal: "Du weißt, wo der Gewinn entsteht und welche drei Zahlen jeden Deal entscheiden.",
    sections: [
      {
        h: "Der Gewinn entsteht beim Einkauf",
        points: [
          "Wer zu teuer kauft, kann das beim Verkauf kaum noch retten – der Verkaufspreis ist vom Markt vorgegeben, der Einkaufspreis ist verhandelbar.",
          "Deshalb vor jedem Kauf rückwärts rechnen: realistischer Verkaufspreis − alle Kosten − Ziel-Gewinn = höchster Ankaufspreis. Darüber nicht kaufen.",
        ],
      },
      {
        h: "Drei Zahlen entscheiden",
        points: [
          "Realistischer Verkaufspreis: aus tatsächlich verkauften Uhren gleicher Referenz, gleichem Zustand, gleichem Set – nicht aus Angeboten.",
          "Alle Kosten: Gebühren, Versand, Revision/Aufbereitung, Echtheitsprüfung, Steuern.",
          "Standzeit: Wie lange ist dein Geld gebunden? 300 € Gewinn in 3 Wochen sind besser als 500 € in 6 Monaten.",
        ],
      },
      {
        h: "Liquidität vor Marge",
        points: [
          "Gängige Modelle bekannter Marken verkaufen sich schneller und berechenbarer – kleine, sichere Marge schlägt große Marge auf dem Papier.",
          "Exoten, Modeuhren und Quarz-Massenware haben oft kaum Wiederverkaufswert.",
          "Fang klein an: eine Preisklasse, deren Verlust du verkraftest, und eine Marke oder Modellfamilie, die du gründlich lernst.",
        ],
      },
    ],
    practice: { text: "Lege eine Uhr, die dich interessiert, als Übungs-Deal an (nur auf dem Papier) und verfolge, zu welchem Preis sie wirklich verkauft wird.", href: `${BASE}/deals#neu`, label: "Übungs-Deal anlegen" },
    quiz: [
      { q: "Wo entsteht der Gewinn bei Buy & Flip hauptsächlich?", options: ["Beim Einkauf", "Beim Verkaufen mit guten Fotos", "Durch Glück beim Marktpreis"], answer: 0, why: "Der Verkaufspreis ist vom Markt vorgegeben – beeinflussen kannst du vor allem, wie günstig du einkaufst." },
      { q: "Welche Uhr ist für den Anfang besser?", options: ["Seltenes Modell, 25 % Marge laut Angeboten, keine verkauften Vergleiche", "Gängiges Modell, 8 % Marge, verkauft sich erfahrungsgemäß in wenigen Wochen"], answer: 1, why: "Liquidität vor Marge: Die 25 % stehen nur auf dem Papier, solange niemand zu diesem Preis kauft." },
      { q: "Was ist der richtige Vergleichspreis?", options: ["Der höchste Angebotspreis im Netz", "Tatsächlich bezahlte Preise für die gleiche Referenz in gleichem Zustand", "Der Listenpreis des Herstellers"], answer: 1, why: "Angebote sind Wünsche der Verkäufer. Was gezahlt wurde, ist der Markt." },
    ],
  },
  {
    key: "markt",
    title: "Referenz, Set und Liquidität",
    track: "start",
    minutes: 6,
    goal: "Du erkennst, was den Wert einer Uhr bestimmt, und vergleichst nur Gleiches mit Gleichem.",
    sections: [
      {
        h: "Die Referenznummer bestimmt den Preis",
        points: [
          "Gleicher Modellname heißt nicht gleiche Uhr: Zifferblatt, Lünette, Material, Größe und Generation stecken in der Referenz – und damit oft große Preisunterschiede.",
          "Dazu Seriennummer (Baujahr bzw. Produktionszeitraum) und das Datum auf Garantiekarte oder Rechnung.",
        ],
      },
      {
        h: "Full Set",
        points: [
          "Box, Papiere bzw. Garantiekarte, Kaufbeleg, Anhänger, Ersatzglieder und Anleitung – bei begehrten Marken bringt ein vollständiges Set spürbar mehr.",
          "Fehlende Papiere senken nicht nur den Preis, sie verkleinern auch die Käufergruppe (mehr Fragen nach Echtheit und Herkunft).",
        ],
      },
      {
        h: "Was sich gut verkauft",
        points: [
          "Klassiker bekannter Marken in Stahl, gängige Größen, guter Zustand – viele Käufer, viele Vergleichspreise.",
          "Schwieriger: ungewöhnliche Größen, Edelsteinbesatz (schwer zu bewerten), stark modische Uhren, Uhren mit Fremdteilen.",
          "Die Nachfrage schwankt – vor Weihnachten ist oft mehr los als im Sommer. Notiere selbst, wie schnell Uhren weggehen.",
        ],
      },
    ],
    practice: { text: "Suche eine Referenz heraus und notiere unter „Marktpreise“ drei Angebote und – wenn du sie findest – drei verkaufte Preise.", href: `${BASE}/preise`, label: "Marktpreise erfassen" },
    quiz: [
      { q: "Zwei Uhren haben denselben Modellnamen, aber unterschiedliche Referenznummern. Was gilt?", options: ["Die Preise sind gleich", "Die Preise können deutlich auseinanderliegen", "Die neuere Referenz ist immer billiger"], answer: 1, why: "Die Referenz steht für die konkrete Ausführung – Zifferblatt, Material, Generation." },
      { q: "Was gehört zu einem Full Set?", options: ["Nur die Uhr und das Band", "Box und Papiere bzw. Garantiekarte, oft auch Rechnung und Zubehör", "Ein Echtheitszertifikat aus dem Internet"], answer: 1, why: "Box und Papiere des Herstellers – Zertifikate Dritter ersetzen sie nicht." },
      { q: "Warum sind fehlende Papiere ein Problem?", options: ["Sie sind gesetzlich vorgeschrieben", "Der Preis sinkt und weniger Käufer trauen sich", "Man darf die Uhr dann nicht verkaufen"], answer: 1, why: "Ohne Papiere fragen Käufer mehr nach Echtheit und Herkunft – das drückt Preis und Tempo." },
    ],
  },
  {
    key: "preise",
    title: "Preisrecherche: Was ist die Uhr wirklich wert?",
    track: "start",
    minutes: 7,
    goal: "Du findest einen belastbaren Verkaufspreis und kennst deine Untergrenze.",
    sections: [
      {
        h: "Verkauft schlägt angeboten",
        points: [
          "Suche verkaufte Preise: bei eBay der Filter „Verkaufte Artikel“, Auktionsergebnisse, eigene Erfahrungen, Händler-Ankaufspreise.",
          "Große Plattformen zeigen vor allem Angebotspreise – die tatsächlich bezahlten liegen meist darunter. Notiere beides getrennt.",
        ],
      },
      {
        h: "Gleiches mit Gleichem",
        points: [
          "Nur gleiche Referenz, ähnlicher Zustand und gleiches Set vergleichen.",
          "Mindestens drei bis fünf Vergleiche, Ausreißer weglassen, den mittleren Wert (Median) nehmen.",
          "Preise immer mit Datum notieren – der Markt bewegt sich. Das Werkzeug „Marktpreise“ rechnet Spanne und Median für dich.",
        ],
      },
      {
        h: "Deine Untergrenze",
        points: [
          "Was zahlt ein Händler sofort (Ankauf)? Das ist dein Notausgang, falls die Uhr nicht privat verkauft wird.",
          "Liegt dein Einkauf nahe am Händler-Ankaufspreis, ist das Risiko klein. Liegt er weit darüber, brauchst du einen Käufer zum vollen Preis.",
        ],
      },
    ],
    practice: { text: "Erfasse für eine Referenz verkaufte Preise, Angebote und einen Händler-Ankaufspreis – und vergleiche die Mediane.", href: `${BASE}/preise`, label: "Zu den Marktpreisen" },
    quiz: [
      { q: "Du findest fünf Angebote zwischen 5.000 und 6.500 €, aber keine verkauften Preise. Was ist sinnvoll?", options: ["Mit 6.500 € rechnen", "Mit dem Median der Angebote rechnen", "Weiter nach verkauften Preisen suchen und vorsichtiger planen"], answer: 2, why: "Angebote sind Obergrenzen. Ohne verkaufte Vergleiche fehlt die wichtigste Zahl." },
      { q: "Wozu dient der Händler-Ankaufspreis?", options: ["Als Verkaufspreis für Privatkunden", "Als Untergrenze bzw. Notausgang", "Er ist für Privatleute uninteressant"], answer: 1, why: "Er zeigt, was du sofort bekommst, wenn sich kein Privatkäufer findet." },
      { q: "Warum Preise mit Datum notieren?", options: ["Weil der Markt sich verändert", "Aus steuerlichen Gründen", "Das ist unnötig"], answer: 0, why: "Ein Preis von vor einem Jahr kann heute deutlich daneben liegen." },
    ],
  },
  {
    key: "zustand",
    title: "Zustand prüfen (gebraucht)",
    track: "gebraucht",
    minutes: 8,
    goal: "Du prüfst eine gebrauchte Uhr systematisch und preist Mängel richtig ein.",
    sections: [
      {
        h: "Äußeres",
        points: [
          "Gehäuse und Kanten: Starkes Polieren rundet Kanten und Fasen ab – bei Sammleruhren wertmindernd; unpolierte Gehäuse sind gefragt.",
          "Glas, Lünette, Zifferblatt (Flecken, Feuchtigkeit), Zeiger und Leuchtmasse, Krone und Drücker.",
          "Band: Spiel zwischen den Gliedern (Längung), Zustand der Schließe, fehlende Glieder – die Bandlänge entscheidet, wem die Uhr passt.",
        ],
      },
      {
        h: "Technik",
        points: [
          "Gangwerte mit Zeitwaage oder App messen, Aufzug prüfen, Datum schalten lassen, Chronograph starten, stoppen, nullstellen.",
          "Wasserdichtigkeit unbekannt = als nicht geprüft behandeln, nie zusichern.",
        ],
      },
      {
        h: "Revision",
        points: [
          "Wann war die letzte Revision, gibt es einen Beleg? Wenn nicht: Revisionskosten beim Einkauf einplanen – je nach Werk und Uhrmacher oft mehrere hundert Euro.",
          "Jeden Mangel in Euro übersetzen und vom Ankaufspreis abziehen – nicht „das mache ich später“.",
        ],
      },
    ],
    practice: { text: "Öffne einen Deal und hake die Ankauf-Prüfliste Punkt für Punkt ab – trage Revisions- und Aufbereitungskosten als Nebenkosten ein.", href: `${BASE}/deals`, label: "Zu den Deals" },
    quiz: [
      { q: "Ein Verkäufer sagt: „Revision weiß ich nicht.“ Wie gehst du vor?", options: ["Ignorieren, läuft ja", "Revisionskosten einplanen und vom Ankaufspreis abziehen", "Die Uhr als revidiert anbieten"], answer: 1, why: "Unbekannt heißt: einplanen. Eine Revision kostet schnell mehrere hundert Euro." },
      { q: "Warum kann eine frisch polierte Uhr weniger wert sein?", options: ["Politur verändert Kanten und Fasen", "Politur macht das Glas brüchig", "Das stimmt nie"], answer: 0, why: "Gerade Sammler achten auf scharfe, originale Kanten." },
      { q: "Die Wasserdichtigkeit ist nicht geprüft. Was schreibst du ins Inserat?", options: ["Wasserdicht bis 100 m", "Wasserdichtigkeit nicht geprüft", "Nichts – verschweigen"], answer: 1, why: "Nie etwas zusichern, was du nicht geprüft hast." },
    ],
  },
  {
    key: "echtheit",
    title: "Echtheit, Diebstahl und Betrug",
    track: "gebraucht",
    minutes: 8,
    goal: "Du schützt dich vor Fälschungen, gestohlenen Uhren und typischen Maschen.",
    sections: [
      {
        h: "Fälschungen und Fremdteile",
        points: [
          "Fälschungen werden immer besser. Achte auf Gewicht, Gravuren, Schrift, Datumslupe, Leuchtmasse – im Zweifel das Werk ansehen lassen.",
          "„Frankenwatch“: echte und falsche oder fremde Teile gemischt (Zifferblatt, Lünette, Werk). Auch Papiere können gefälscht sein – Seriennummer von Uhr und Papieren abgleichen.",
          "Bei teuren Uhren: Prüfung bei Uhrmacher oder Händler vor der Zahlung, am besten Treffen direkt dort.",
        ],
      },
      {
        h: "Gestohlen?",
        points: [
          "Seriennummer prüfen lassen – z. B. über ein Register für gestohlene Uhren oder bei der Polizei nachfragen.",
          "Kaufvertrag mit Name, Anschrift und Ausweisdaten des Verkäufers. Passt die Geschichte (Kaufbeleg, Besitzdauer, Grund)?",
        ],
      },
      {
        h: "Typische Maschen",
        points: [
          "Beim Kauf: Vorkasse an Unbekannte, „Versand nur per Kurier“, Druck („heute noch, andere Interessenten“).",
          "Beim Verkauf: gefälschte Zahlungsbestätigungen, „Zahlung über Link“, Überzahlung mit Rückforderung, Abholer gibt Uhr nicht zurück.",
          "Uhr erst übergeben, wenn das Geld wirklich da ist (Bargeld prüfen bzw. Gutschrift auf dem Konto) – oder Treuhand nutzen.",
        ],
      },
    ],
    practice: { text: "Ergänze in einem Deal die Prüfpunkte „Seriennummer geprüft“ und „Echtheit geprüft“ – und notiere, wer geprüft hat.", href: `${BASE}/deals`, label: "Zu den Deals" },
    quiz: [
      { q: "Was ist eine „Frankenwatch“?", options: ["Eine Uhr aus Franken", "Eine Uhr aus echten und fremden oder falschen Teilen", "Ein Sondermodell"], answer: 1, why: "Gemischte Teile sind schwer zu erkennen und senken den Wert erheblich." },
      { q: "Der Käufer schickt einen Screenshot der Überweisung. Wann übergibst du die Uhr?", options: ["Sofort", "Wenn das Geld auf deinem Konto gutgeschrieben ist", "Nach einem Telefonat"], answer: 1, why: "Screenshots lassen sich fälschen – nur die Gutschrift zählt." },
      { q: "Wie schützt du dich vor gestohlenen Uhren?", options: ["Gar nicht möglich", "Seriennummer prüfen lassen und Kaufvertrag mit Ausweisdaten", "Nur bar bezahlen"], answer: 1, why: "Prüfung der Seriennummer und ein sauberer Kaufvertrag sind Pflichtprogramm." },
    ],
  },
  {
    key: "einkauf",
    title: "Einkaufen und verhandeln",
    track: "gebraucht",
    minutes: 6,
    goal: "Du findest Angebote, stellst die richtigen Fragen und hältst dich an deinen Höchstpreis.",
    sections: [
      {
        h: "Wo du einkaufst",
        points: [
          "Kleinanzeigen, eBay, Foren und Gruppen, Erbschaften und Haushaltsauflösungen, Pfandleiher, Inzahlungnahmen bei Händlern, Auktionen.",
          "Bei Auktionen kommt ein Aufgeld (Käuferprovision) auf den Zuschlag – vorher einrechnen.",
        ],
      },
      {
        h: "Fragen vor dem Treffen",
        points: [
          "Referenz, Fotos von Gehäuseboden/Seriennummer und Papieren, Kaufbeleg, letzte Revision, Bandlänge, Grund des Verkaufs, Besitzdauer.",
          "Je klarer die Antworten, desto geringer dein Risiko – ausweichende Antworten sind ein Warnsignal.",
        ],
      },
      {
        h: "Verhandeln",
        points: [
          "Höchstpreis vorher im Rechner bestimmen und daran halten – Verlieben ist der teuerste Fehler.",
          "Argumente: belegte Vergleichspreise, konkrete Mängel, fehlende Revision, schnelle und sichere Zahlung.",
          "Lieber eine Uhr ziehen lassen als zu teuer kaufen – das nächste Angebot kommt.",
        ],
      },
    ],
    practice: { text: "Bestimme im Rechner deinen Höchstpreis für eine konkrete Anzeige und notiere ihn im Deal, bevor du anfragst.", href: `${BASE}/rechner`, label: "Zum Rechner" },
    quiz: [
      { q: "Wann legst du deinen Höchstpreis fest?", options: ["Vor dem ersten Kontakt", "Während der Verhandlung", "Nach dem Kauf"], answer: 0, why: "In der Verhandlung entscheiden Gefühle – die Zahl muss vorher stehen." },
      { q: "Was kommt bei Auktionen zum Zuschlag dazu?", options: ["Nichts", "Das Aufgeld (Käuferprovision)", "Immer 19 % Umsatzsteuer auf alles"], answer: 1, why: "Das Aufgeld kann einen spürbaren Teil des Zuschlags ausmachen." },
    ],
  },
  {
    key: "neu",
    title: "Neue Uhren: Konzessionär, Graumarkt, Wartelisten",
    track: "neu",
    minutes: 8,
    goal: "Du verstehst, wann sich eine neue Uhr flippen lässt – und wann nicht.",
    sections: [
      {
        h: "Wo neue Uhren herkommen",
        points: [
          "Konzessionär (autorisierter Händler): volle Herstellergarantie, meist Listenpreis; bei sehr gefragten Modellen Zuteilung, oft nach Kaufhistorie.",
          "Graumarkt-Händler: verkaufen neue Uhren außerhalb des offiziellen Vertriebs – Preise über oder unter Liste. Garantiekarte, Datum und Händlerangaben genau prüfen.",
          "Kaufbedingungen lesen: Manche Händler schließen Wiederverkäufer aus oder verlangen Zusagen.",
        ],
      },
      {
        h: "Listenpreis ist nicht Marktpreis",
        points: [
          "Wenige, sehr gefragte Modelle werden über Liste gehandelt; viele andere liegen darunter, Rabatte sind normal.",
          "Flippen lässt sich eine neue Uhr nur, wenn du sicher unter dem Preis einkaufst, zu dem neue bzw. ungetragene Stücke tatsächlich verkauft werden.",
          "Einmal verkauft ist „neu“ nur noch „ungetragen“: Garantiekarte mit Datum, Schutzfolien dran, nicht tragen. Käufer zahlen für lange Restgarantie.",
        ],
      },
      {
        h: "Steuer bei Neuware",
        points: [
          "Kaufst du gewerblich mit Rechnung inkl. ausgewiesener Umsatzsteuer, ziehst du die Vorsteuer ab – verkaufst dann aber mit 19 % auf den vollen Preis (Regelbesteuerung). Differenzbesteuerung ist dann nicht möglich.",
          "Wirtschaftlich zahlst du so Umsatzsteuer auf deinen Aufschlag – im Rechner „Regelbesteuerung“ wählen.",
        ],
      },
    ],
    practice: { text: "Lege einen neuen Deal mit Zustand „neu“ an: Die Prüfliste ändert sich (Rechnung, Garantiekarte, Folien). Rechne ihn mit Regelbesteuerung.", href: `${BASE}/deals#neu`, label: "Neuen Deal anlegen" },
    quiz: [
      { q: "Wann lohnt sich der Flip einer neuen Uhr?", options: ["Immer, neu ist neu", "Wenn du sicher unter dem tatsächlich bezahlten Marktpreis für ungetragene Stücke einkaufst", "Wenn der Listenpreis hoch ist"], answer: 1, why: "Der Listenpreis sagt nichts darüber, was Käufer zahlen." },
      { q: "Du kaufst gewerblich eine neue Uhr für 10.000 € inkl. 19 % USt (mit Rechnung) und verkaufst sie für 11.000 €. Wie viel Umsatzsteuer zahlst du ans Finanzamt?", options: ["1.756,30 €", "159,66 €", "0 €"], answer: 1, why: "Regelbesteuerung: 11.000 × 19/119 = 1.756,30 € Umsatzsteuer minus 10.000 × 19/119 = 1.596,64 € Vorsteuer = 159,66 €." },
      { q: "Was macht eine verkaufte neue Uhr für den nächsten Käufer wertvoll?", options: ["Getragen, aber gepflegt", "Ungetragen mit Folien, vollständigem Set und datierter Garantiekarte", "Möglichst neue Politur"], answer: 1, why: "Ungetragen und mit Restgarantie – dafür wird bezahlt." },
    ],
  },
  {
    key: "kalkulation",
    title: "Kalkulation: alle Kosten, rückwärts rechnen",
    track: "geld",
    minutes: 7,
    goal: "Du rechnest jeden Deal vollständig durch und kennst Break-even und Höchstpreis.",
    sections: [
      {
        h: "Alle Kosten",
        points: [
          "Ankauf, Anreise, Echtheitsprüfung, Revision und Aufbereitung, Band und Glieder, Plattform- und Zahlungsgebühren, versicherter Versand, mögliche Rücksendung, Umsatzsteuer.",
          "Gebühren unterscheiden sich stark nach Plattform, privat oder gewerblich – vor dem Verkauf im Gebührenverzeichnis nachsehen und im Rechner eintragen.",
        ],
      },
      {
        h: "Rückwärts rechnen",
        points: [
          "Realistischer Verkaufspreis − Gebühren − Kosten − Steuer − Ziel-Gewinn = höchster Ankaufspreis.",
          "Den Verkaufspreis eher am unteren Rand der verkauften Vergleiche ansetzen – Puffer für Überraschungen.",
        ],
      },
      {
        h: "Rendite",
        points: [
          "Gewinn ÷ eingesetztes Geld (Ankauf + Kosten) = Rendite. Je Monat Standzeit gerechnet, siehst du, ob schnelles Drehen mehr bringt als die große Marge.",
        ],
      },
    ],
    practice: { text: "Rechne im Rechner einen Deal einmal vorwärts (Gewinn) und einmal rückwärts (Höchstpreis für dein Gewinnziel).", href: `${BASE}/rechner`, label: "Zum Rechner" },
    quiz: [
      { q: "Privatverkauf: Verkaufspreis 6.000 €, Gebühren 390 €, Kosten 210 €, Ziel-Gewinn 500 €. Höchster Ankaufspreis?", options: ["5.400 €", "4.900 €", "5.110 €"], answer: 1, why: "6.000 − 390 − 210 − 500 = 4.900 €." },
      { q: "600 € Gewinn auf 6.000 € eingesetztes Geld in 2 Monaten. Rendite je Monat?", options: ["10 %", "5 %", "1 %"], answer: 1, why: "600 ÷ 6.000 = 10 % insgesamt, verteilt auf 2 Monate = 5 % je Monat." },
      { q: "Mit welchem Verkaufspreis planst du?", options: ["Mit dem höchsten Angebot", "Eher am unteren Rand der verkauften Vergleiche", "Mit dem Listenpreis"], answer: 1, why: "Vorsichtig planen – positive Überraschungen sind willkommen, negative teuer." },
    ],
  },
  {
    key: "steuern",
    title: "Recht und Steuern im Überblick",
    track: "geld",
    minutes: 9,
    goal: "Du kennst die Begriffe und weißt, was du mit Steuerberater und Gewerbeamt klären musst. (Überblick, keine Beratung.)",
    sections: [
      {
        h: "Privat oder gewerblich?",
        points: [
          "Gelegentlich eigene Uhren verkaufen ist meist privat. Wer regelmäßig mit Gewinnabsicht ankauft und weiterverkauft, handelt gewerblich: Gewerbe anmelden, Einkommensteuer, ggf. Gewerbe- und Umsatzsteuer.",
          "Online-Plattformen melden Verkäufer ab 30 Verkäufen oder 2.000 € Einnahmen im Jahr ans Finanzamt (Plattformen-Steuertransparenzgesetz).",
        ],
      },
      {
        h: "Umsatzsteuer",
        points: [
          "Kleinunternehmer (§ 19 UStG): keine Umsatzsteuer, aber Umsatzgrenzen (seit 2025: 25.000 € im Vorjahr, 100.000 € im laufenden Jahr) – bei Uhren schnell erreicht.",
          "Differenzbesteuerung (§ 25a UStG): Händler, die gebrauchte Uhren ohne Vorsteuer kaufen (z. B. von Privat), zahlen Umsatzsteuer nur auf die Differenz Verkauf − Einkauf, herausgerechnet aus dem Bruttobetrag. Reparaturen mindern die Differenz nicht; jede Uhr wird einzeln betrachtet, ein Verlust wird nicht verrechnet.",
          "Auf der Rechnung steht dann „Gebrauchtgegenstände/Sonderregelung“, die Umsatzsteuer wird nicht ausgewiesen.",
          "Regelbesteuerung: mit Vorsteuer gekauft (z. B. neu mit Rechnung) → 19 % auf den vollen Verkaufspreis, Vorsteuer abziehen.",
        ],
      },
      {
        h: "Weitere Pflichten",
        points: [
          "Geldwäschegesetz: Händler müssen bei Barzahlungen ab 10.000 € den Kunden identifizieren und das dokumentieren.",
          "Als Händler gegenüber Verbrauchern: Gewährleistung 2 Jahre, bei Gebrauchtem auf 1 Jahr verkürzbar (ausdrücklich vereinbaren); im Online-Verkauf 14 Tage Widerrufsrecht. Privat lässt sich die Gewährleistung ausschließen – nicht für Zugesichertes oder arglistig Verschwiegenes.",
          "Belege aufbewahren: Kaufverträge, Rechnungen, Gebühren, Versand.",
        ],
      },
    ],
    practice: { text: "Rechne denselben Deal im Rechner einmal „ohne USt“, einmal mit Differenz- und einmal mit Regelbesteuerung und vergleiche den Gewinn.", href: `${BASE}/rechner`, label: "Zum Rechner" },
    quiz: [
      { q: "§ 25a: Ankauf von Privat 4.000 €, Verkauf 5.000 €. Wie viel Umsatzsteuer fällt an (19 %)?", options: ["950,00 €", "190,00 €", "159,66 €"], answer: 2, why: "Differenz 1.000 € ist ein Bruttobetrag: 1.000 × 19/119 = 159,66 €." },
      { q: "Gleicher Deal, aber du zahlst noch 300 € für eine Revision. Ändert sich die Umsatzsteuer nach § 25a?", options: ["Ja, sie sinkt auf 111,76 €", "Nein, Reparaturen mindern die Differenz nicht", "Ja, sie entfällt"], answer: 1, why: "Bemessungsgrundlage ist Verkaufspreis minus Einkaufspreis – Nebenkosten zählen nicht." },
      { q: "Ab wann melden Plattformen Verkäufer ans Finanzamt?", options: ["Ab dem ersten Verkauf", "Ab 30 Verkäufen oder 2.000 € Einnahmen im Jahr", "Nie"], answer: 1, why: "So regelt es das Plattformen-Steuertransparenzgesetz." },
    ],
  },
  {
    key: "verkauf",
    title: "Verkaufen: Fotos, Inserat, Zahlung, Versand",
    track: "verkauf",
    minutes: 7,
    goal: "Du verkaufst schnell, sicher und ohne böse Überraschungen.",
    sections: [
      {
        h: "Fotos und Inserat",
        points: [
          "Tageslicht, ruhiger Hintergrund, alle Seiten: Zifferblatt, Gehäuse, Boden, Schließe, Band, Set. Mängel ehrlich zeigen – das schafft Vertrauen.",
          "Inhalt: Marke, Modell, Referenz, Baujahr, Set, Zustand, letzte Revision, Gangwerte, Bandlänge, Zahlung und Versand.",
          "Seriennummer auf Fotos teilweise abdecken.",
        ],
      },
      {
        h: "Preis und Kanal",
        points: [
          "Etwas über dem Ziel ansetzen, um Verhandlungsspielraum zu haben.",
          "Lokal (Kleinanzeigen) ohne Versandrisiko, große Plattformen mit vielen und internationalen Käufern (Gebühren!), Händler-Ankauf schnell, aber günstiger.",
        ],
      },
      {
        h: "Zahlung und Versand",
        points: [
          "Bargeld bei Übergabe (am besten in der Bank prüfen), Überweisung erst bei Gutschrift, oder Treuhand. Keine „Zahlung über Link“.",
          "Versicherter Versand mit passender Deckung: Standard-Paketversicherungen decken Uhren oft nur bis zu einer Grenze oder gar nicht – Bedingungen prüfen, bei teuren Uhren Wertversand oder Spezialversicherung.",
          "Verpackung neutral, Versand dokumentieren (Fotos, Video vom Verpacken).",
        ],
      },
    ],
    practice: { text: "Trage im Deal den Verkauf ein (Preis, Kanal, Gebühren) und schreibe unter „Was habe ich gelernt?“ eine Erkenntnis auf.", href: `${BASE}/deals`, label: "Zu den Deals" },
    quiz: [
      { q: "Ein Käufer bietet „Zahlung über einen Link“ an. Was tust du?", options: ["Link anklicken", "Ablehnen – nur Gutschrift auf dem Konto, Bargeld oder Treuhand", "Kreditkartendaten eingeben"], answer: 1, why: "Zahlungslinks sind eine verbreitete Betrugsmasche." },
      { q: "Was gilt für den Versand teurer Uhren?", options: ["Einfaches Paket reicht immer", "Versicherungsbedingungen prüfen – Uhren sind oft begrenzt oder ausgeschlossen", "Unversichert ist am günstigsten und sicher"], answer: 1, why: "Ohne passende Deckung trägst du das volle Risiko." },
    ],
  },
  {
    key: "fehler",
    title: "Typische Anfängerfehler und dein Lernsystem",
    track: "verkauf",
    minutes: 5,
    goal: "Du vermeidest die häufigsten Fehler und lernst aus jedem Deal.",
    sections: [
      {
        h: "Die Klassiker",
        points: [
          "In die Uhr verliebt und zu teuer gekauft.",
          "Angebotspreise für den Marktpreis gehalten.",
          "Revision, Bandlänge oder fehlende Glieder vergessen.",
          "Zu viel Geld in einer einzigen Uhr – kein Puffer.",
          "Keinen Ausstieg geplant: Was, wenn sie nicht verkauft wird?",
        ],
      },
      {
        h: "Dein Lernsystem",
        points: [
          "Übungs-Deals auf dem Papier: Schätzen, was eine Anzeige wert ist, und später nachsehen, wofür sie verkauft wurde.",
          "Nach jedem Deal: „Was habe ich gelernt?“ aufschreiben – die Übersicht zeigt deine Lernkurve.",
          "Regelmäßig Marktpreise für deine Referenzen notieren – so entsteht dein eigenes Preisgefühl.",
        ],
      },
    ],
    practice: { text: "Lege drei Übungs-Deals an und verfolge sie zwei Wochen lang.", href: `${BASE}/deals#neu`, label: "Übungs-Deal anlegen" },
    quiz: [
      { q: "Welcher Fehler ist am teuersten?", options: ["Zu teuer einkaufen", "Ein Foto zu wenig", "Einen Tag zu spät inserieren"], answer: 0, why: "Ein zu teurer Einkauf frisst die ganze Marge." },
      { q: "Wofür sind Übungs-Deals gut?", options: ["Für nichts", "Preisgefühl aufbauen, ohne Geld zu riskieren", "Um Steuern zu sparen"], answer: 1, why: "Schätzen und Nachprüfen trainiert genau die Fähigkeit, auf die es ankommt." },
    ],
  },
];

export const lessonByKey = (key: string) => LESSONS.find((l) => l.key === key) ?? null;

/** Auswertung eines Quiz: Anzahl richtig. Fehlende oder ungültige Antworten zählen als falsch. */
export function scoreQuiz(lesson: Lesson, answers: (number | null | undefined)[]): { correct: number; total: number; passed: boolean } {
  const correct = lesson.quiz.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0);
  return { correct, total: lesson.quiz.length, passed: correct === lesson.quiz.length };
}

export type LessonProgress = { lesson: string; done: boolean; bestCorrect: number; total: number };

/** Nächste Lektion: die erste, die noch nicht abgeschlossen ist. */
export function nextLesson(progress: LessonProgress[]): Lesson | null {
  const done = new Set(progress.filter((p) => p.done).map((p) => p.lesson));
  return LESSONS.find((l) => !done.has(l.key)) ?? null;
}
