import "server-only";
import type { Session } from "@/lib/auth/session";
import { familyEventTimes } from "./calendar-data";
import { auswertung, einsaetze, type EinsatzEintrag, type Helfer, type TerminKandidat } from "./haushaltshilfe";
import { statusOf, type AppointmentEntry, type DateEntry } from "./logic";
import { loadEntries, privateSettings } from "./service";

// Haushaltshilfe je Monat: Familienkalender + Privat-Termine + gespeicherte Angaben (Privat-Eintrag „haushaltshilfe“).
// Nur mit vollem Privat-Zugang (die Art gehört nicht zu den Familien-Arten) – „nur Familie“ sieht keine Kosten.

const letzterTag = (monat: string) => {
  const [j, m] = monat.split("-").map(Number);
  return `${monat}-${String(new Date(Date.UTC(j, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const monatPlus = (monat: string, n: number) => {
  const [j, m] = monat.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1 + n, 1)).toISOString().slice(0, 7);
};

export async function helferListe(tenantId: string): Promise<Helfer[]> {
  return (await privateSettings(tenantId)).haushaltshilfe?.helfer ?? [];
}

/** Einsätze von–bis (Tage). */
async function einsaetzeZeitraum(session: Session, von: string, bis: string, heute: string) {
  const [helfer, kalender, termine, eintraege] = await Promise.all([
    helferListe(session.tenantId),
    familyEventTimes(session.tenantId, von, bis),
    loadEntries<AppointmentEntry>(session, ["termin"]),
    loadEntries<EinsatzEintrag>(session, ["haushaltshilfe"]),
  ]);
  // Privat-Termine, die schon aus dem Familienkalender stammen (fromEvent), nicht doppelt.
  const ausKalender = new Set(kalender.map((k) => k.ref));
  const kandidaten: TerminKandidat[] = [
    ...kalender.map((k) => ({ ref: k.ref, quelle: "kalender" as const, titel: k.title, day: k.day, from: k.from, to: k.to, kalender: k.calendar })),
    ...termine
      .filter((t) => t.data.day >= von && t.data.day <= bis && !(t.data.fromEvent && ausKalender.has(t.data.fromEvent)))
      .map((t) => ({ ref: `termin:${t.id}`, quelle: "termin" as const, titel: t.data.title ?? "", day: t.data.day, from: t.data.time ?? null, to: t.data.to ?? null, status: statusOf(t.data) })),
  ];
  return { helfer, liste: einsaetze({ helfer, termine: kandidaten, eintraege, von, bis, heute }) };
}

/** Monat: Einsätze, Auswertung, Vormonate (Kosten je Monat) und in „Paarzeit“ eingetragene Babysitter-Kosten. */
export async function haushaltshilfeMonat(session: Session, monat: string, heute: string) {
  const { helfer, liste } = await einsaetzeZeitraum(session, `${monat}-01`, letzterTag(monat), heute);
  const vonJahr = monatPlus(monat, -11);
  const jahr = await einsaetzeZeitraum(session, `${vonJahr}-01`, letzterTag(monat), heute);
  const verlauf = Array.from({ length: 12 }, (_, i) => monatPlus(vonJahr, i)).map((m) => {
    const a = auswertung(jahr.liste.filter((e) => e.day.startsWith(m)));
    return { monat: m, anzahl: a.anzahl, kosten: a.kosten };
  });
  const paarzeit = (await loadEntries<DateEntry>(session, ["paarzeit"])).filter((e) => e.data.day.startsWith(monat) && (e.data.costEur ?? 0) > 0);
  return {
    monat,
    helfer,
    einsaetze: liste,
    auswertung: auswertung(liste),
    verlauf,
    paarzeitKosten: Math.round(paarzeit.reduce((n, e) => n + (e.data.costEur ?? 0), 0) * 100) / 100,
  };
}

/** Kurzfassung für „Privates Geld“, die Privat-Startseite und Claude (privat_finanzen). */
export async function haushaltshilfeKurz(session: Session, monat: string, heute: string) {
  if (session.privateScope === "familie") return null;
  const { liste } = await einsaetzeZeitraum(session, `${monat}-01`, letzterTag(monat), heute);
  const a = auswertung(liste);
  return { monat, anzahl: a.anzahl, stunden: a.stunden, kosten: a.kosten, offen: a.offen, ohneBetrag: a.ohneBetrag, geplant: a.geplant, jeHilfe: a.helfer.map((h) => ({ name: h.name, anzahl: h.anzahl, stunden: h.stunden, kosten: h.kosten })) };
}
