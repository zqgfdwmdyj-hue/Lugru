import Link from "next/link";
import { requirePrivate } from "@/lib/private/service";
import { PrivatHead } from "../ui";

type Card = { title: string; items: React.ReactNode[]; sources?: { label: string; url: string }[]; tone?: "warn" };

const CARDS: Card[] = [
  {
    title: "Sofort handeln – Warnzeichen bei ADHS-Medikamenten",
    tone: "warn",
    items: [
      <><strong>Sofort 112:</strong> Brustschmerzen, Atemnot, Ohnmacht, Krampfanfall, Zeichen eines Schlaganfalls (hängender Mundwinkel, einseitige Schwäche, verwaschene Sprache), starke allergische Reaktion (Schwellung von Lippen, Zunge, Hals) oder Gedanken, sich oder anderen etwas anzutun.</>,
      <><strong>Zeitnah Ärztin/Arzt anrufen</strong> (nachts und am Wochenende 116 117): schneller oder unregelmäßiger Herzschlag, deutliche Stimmungs- oder Wesensveränderung (Aggression, Reizbarkeit, gedrückte Stimmung, Angst, Anspannung), Halluzinationen, neue Tics.</>,
      <><strong>Seelische Krise:</strong> TelefonSeelsorge 0800 111 0 111 oder 0800 111 0 222 – kostenlos, anonym, rund um die Uhr.</>,
    ],
    sources: [{ label: "NHS: Methylphenidate (Erwachsene) – Nebenwirkungen", url: "https://www.nhs.uk/medicines/methylphenidate-adults/side-effects-of-methylphenidate-for-adults/" }],
  },
  {
    title: "Einstellungsphase: Was ins Tagebuch gehört",
    items: [
      "Jeden Tag: Medikament, Dosis und Uhrzeit der Einnahme – und wann die Wirkung spürbar wird und wann sie nachlässt. Die Wirkdauer ist je nach Präparat und Mensch verschieden.",
      "Konzentration, Stimmung, innere Ruhe bzw. Impulsivität, Energie – kurz mit 1 bis 5 bewerten, möglichst immer zur gleichen Tageszeit (z. B. abends).",
      "Schlaf und Appetit: Einschlafprobleme, weniger Appetit und Gewichtsabnahme gehören zu den häufigsten Nebenwirkungen und treten in der Eindosierungsphase verstärkt auf.",
      "Puls und Blutdruck: laut Fachinformation bei jeder Dosisanpassung kontrollieren. Zuhause in Ruhe messen, immer zur ähnlichen Uhrzeit.",
      "Gewicht regelmäßig festhalten, z. B. einmal pro Woche morgens.",
      "Was die Partnerin beobachtet (unter „Beobachtungen“) – von außen fällt oft mehr auf, z. B. gereizt am Abend, wenn die Wirkung nachlässt.",
      "Dosis nie selbst ändern – Änderungen immer mit der verschreibenden Ärztin absprechen. Das Tagebuch ist die Grundlage dafür.",
    ],
    sources: [
      { label: "Uniklinikum Leipzig: Leitliniengerechte medikamentöse Behandlung von ADHS im Erwachsenenalter (PDF)", url: "https://www.uniklinikum-leipzig.de/einrichtungen/psychiatrie-psychotherapie/Freigegebene%20Dokumente/Leitliniengerechte%20medikament%c3%b6se%20Behandlung%20von%20ADHS%20im%20Erwachsenenalter.pdf" },
      { label: "GPnotebook: Überwachung der Nebenwirkungen von ADHS-Medikamenten", url: "https://gpnotebook.com/de/pages/psychiatrie/verwaltung/uberwachung-der-nebenwirkungen-und-des-missbrauchspotenzials-von-adhs-medikamenten-bei-kindern-jugendlichen-und-erwachsenen" },
    ],
  },
  {
    title: "Häufige Nebenwirkungen – was helfen kann",
    items: [
      "Kopfschmerzen: ausruhen, genug trinken. Wenn sie stark sind oder nicht weggehen: Ärztin fragen.",
      "Schlafprobleme: bei mehreren Einnahmen am Tag die letzte möglichst mehr als 6 Stunden vor dem Schlafengehen – mit der Ärztin abstimmen.",
      "Wenig Appetit: Einnahme mit einer Mahlzeit kann helfen; etwas Gewichtsabnahme in den ersten Monaten ist häufig. Bei deutlicher Abnahme ärztlich besprechen.",
      "Bauchschmerzen oder Übelkeit: kleinere Mahlzeiten, langsam essen, mit oder nach dem Essen einnehmen.",
      "Mundtrockenheit: Wasser in kleinen Schlucken – wird meist schnell besser.",
      "Grundsätzlich: weiter einnehmen, aber der Ärztin sagen, wenn eine Nebenwirkung stört oder nicht nachlässt.",
    ],
    sources: [{ label: "NHS: Methylphenidate (Erwachsene) – Nebenwirkungen", url: "https://www.nhs.uk/medicines/methylphenidate-adults/side-effects-of-methylphenidate-for-adults/" }],
  },
  {
    title: "Arzttermin vorbereiten",
    items: [
      <>Unter <Link href="/privat/tagebuch/bericht">ADHS-Tagebuch → Bericht</Link> die letzten 4 Wochen drucken oder als PDF mitnehmen: Dosis-Phasen, Durchschnittswerte, Nebenwirkungen, Messwerte, Notizen.</>,
      "Fragen vorher in die Notiz-Felder schreiben – im Termin vergisst man sie leicht.",
      "Eigene Ziele benennen: Woran merke ich, dass es hilft? (z. B. Arbeit am Stück, weniger Streit am Abend, pünktlicher).",
    ],
  },
  {
    title: "Paar-Gespräch einmal pro Woche",
    items: [
      "Feste Zeit, etwa eine Stunde, ruhiger Ort, Handys weg.",
      "Zum Einstieg nennt jeder fünf Dinge, die er in der Woche am anderen geschätzt hat – der andere bedankt sich nur.",
      "Dann ein einziges Thema: abwechselnd sprechen (Ich-Botschaften) und zuhören, ohne zu verteidigen.",
      "Lösungen erst suchen, wenn beide sich verstanden fühlen („Ja, genau so geht es mir“).",
      <>Festhalten unter <Link href="/privat/paar#gespraech">Paar → Paar-Gespräch</Link>.</>,
    ],
    sources: [{ label: "The Gottman Institute: State of the Union Meeting", url: "https://www.gottman.com/blog/state-of-the-union-meeting/" }],
  },
  {
    title: "ADHS in der Partnerschaft",
    items: [
      "Vergessene Termine oder Absprachen wirken auf den Partner schnell wie Desinteresse – dahinter steckt meist das ADHS, nicht fehlende Wertschätzung. Das gemeinsam benennen nimmt Druck raus.",
      "Impulsivität zeigt sich oft emotional. Hilfreich: vereinbarte Pausen-Signale („Ich brauche 20 Minuten, dann reden wir weiter“).",
      "Gute Kommunikation ist das A und O: Wünsche konkret machen, Aufgaben klar verteilen, Erinnerungen und gemeinsame Listen nutzen.",
      "Auch das Positive sichtbar machen – das wöchentliche Paar-Gespräch und die Übersichten hier helfen dabei.",
    ],
    sources: [
      { label: "Plattform J: ADHS und Partnerschaft (Spitäler fmi)", url: "https://www.plattformj.ch/artikel/165312/" },
      { label: "WEB.DE Magazin: ADHS in Beziehungen", url: "https://web.de/magazine/liebe-partnerschaft/adhs-beziehungen-expertin-aspekt-immens-41170166" },
    ],
  },
  {
    title: "Wozu die Protokolle gut sind",
    items: [
      "Nähe/Intimität: Das Gefühl („wir haben ja nie …“) täuscht oft – das Protokoll zeigt, wie es wirklich ist, und gibt der Therapie eine Grundlage. Kein Wettbewerb und kein Soll; Initiative und „wie nah“ sind freiwillig.",
      "Kinderzeit: macht sichtbar, wer wie viel allein mit den Kindern unterwegs ist – Grundlage, um Entlastung fair zu planen. Auch Zeit allein mit einem Kind zählt.",
      "Aufgaben: kleine, regelmäßige Übungen wirken mehr als große Vorsätze – deshalb „täglich“/„wöchentlich“ zum Abhaken.",
    ],
  },
];

export default async function WissenPage() {
  const session = await requirePrivate();
  return (
    <>
      <PrivatHead active="wissen" title="Wissen" pin={session.privatePin} />
      <div className="notice notice-info small">Allgemeine Informationen aus seriösen Quellen – sie ersetzen keine ärztliche oder therapeutische Beratung. Bei Fragen zum Medikament: verschreibende Ärztin oder Apotheke.</div>
      <div className="stack" style={{ gap: 12 }}>
        {CARDS.map((c) => (
          <section key={c.title} className={`card card-pad knowledge${c.tone === "warn" ? " notice-warn" : ""}`} style={c.tone === "warn" ? { borderColor: "var(--warn)" } : undefined}>
            <h3>{c.title}</h3>
            <ul>{c.items.map((it, i) => <li key={i} className="small">{it}</li>)}</ul>
            {c.sources && (
              <div className="small muted" style={{ marginTop: 6 }}>
                Quelle{c.sources.length > 1 ? "n" : ""}: {c.sources.map((s, i) => <span key={s.url}>{i > 0 ? " · " : ""}<a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a></span>)}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
