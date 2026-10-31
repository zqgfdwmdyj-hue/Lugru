// Modul 9: Paarzeit-Rhythmus (Vorschlag aus Date-Ideen + freie Abende + Betreuung) und Geburtstage/Jahrestage mit
// Erinnerung 14 Tage vorher (Geschenkidee) und 3 Tage vorher (Karte/Anruf). Nur Privatbereich. Reine Logik.

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const plus = (iso: string, n: number) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
const tage = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

// ---- Paarzeit-Rhythmus -------------------------------------------------------------------------------

export type PaarzeitVorschlag = {
  /** Tage seit dem letzten stattgefundenen Date. */
  seitTagen: number;
  /** Nächstes geplantes Date (dann keine Erinnerung). */
  geplant: string | null;
  idee: string | null;
  /** Freie Abende in den nächsten 14 Tagen (Fr/Sa zuerst), höchstens 3. */
  abende: string[];
  hinweis: string;
};

/**
 * Ist der Zielabstand überschritten (und nichts geplant), Vorschlag: eine offene Date-Idee (die älteste zuerst,
 * damit alle drankommen), freie Abende ohne andere Privat-Termine und „Betreuung für die Kinder organisieren“.
 */
export function paarzeitVorschlag(
  o: { letztes: string | null; geplant: string[]; heute: string; zielTage: number; ideen: { text: string; done?: boolean; angelegt: number }[]; belegt: Set<string>; kinder: boolean },
): PaarzeitVorschlag | null {
  if (!o.zielTage || !o.letztes) return null;
  const seit = tage(o.letztes, o.heute);
  const naechstes = o.geplant.filter((d) => d >= o.heute).sort()[0] ?? null;
  if (naechstes || seit < o.zielTage) return null;
  const idee = o.ideen.filter((i) => !i.done && i.text.trim()).sort((a, b) => a.angelegt - b.angelegt)[0]?.text ?? null;
  const frei: string[] = [];
  for (let n = 1; n <= 14; n++) {
    const d = plus(o.heute, n);
    if (!o.belegt.has(d)) frei.push(d);
  }
  const wt = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const abende = [...frei.filter((d) => wt(d) === 5 || wt(d) === 6), ...frei.filter((d) => wt(d) !== 5 && wt(d) !== 6)].slice(0, 3).sort();
  return { seitTagen: seit, geplant: null, idee, abende, hinweis: o.kinder ? "Betreuung für die Kinder organisieren" : "" };
}

// ---- Geburtstage & Jahrestage -----------------------------------------------------------------------

export type Jahrestag = {
  name: string;
  /** „MM-TT“ oder „JJJJ-MM-TT“ (mit Jahr → Alter bzw. Jahre). */
  datum: string;
  art: "geburtstag" | "jahrestag";
  beziehung?: string;
  /** Geschenkideen, frei notiert (eine je Zeile). */
  ideen?: string;
};

export const ART_TEXT = { geburtstag: "Geburtstag", jahrestag: "Jahrestag" } as const;

/** Gültiges Datum? „MM-TT“ oder „JJJJ-MM-TT“. */
export function datumOk(d: string): boolean {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const mo = Number(m[2]);
  const t = Number(m[3]);
  return mo >= 1 && mo <= 12 && t >= 1 && t <= 31;
}

/** Nächster Termin (heute oder später); 29.02. in Nicht-Schaltjahren am 28.02. */
export function naechstesMal(datum: string, heute: string): { tag: string; jahre: number | null } {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(datum)!;
  const jahr = Number(heute.slice(0, 4));
  const fuer = (j: number) => {
    let iso = `${j}-${m[2]}-${m[3]}`;
    if (Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) || new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) !== iso) iso = `${j}-${m[2]}-28`;
    return iso;
  };
  let tag = fuer(jahr);
  if (tag < heute) tag = fuer(jahr + 1);
  return { tag, jahre: m[1] ? Number(tag.slice(0, 4)) - Number(m[1]) : null };
}

export type Erinnerung = { stufe: 14 | 3 | 0; text: string; tag: string; inTagen: number };

/** Erinnerung für heute: 14 Tage vorher mit Geschenkidee, 3 Tage vorher Karte/Anruf, am Tag selbst. Sonst null. */
export function erinnerungHeute(j: Jahrestag, heute: string): Erinnerung | null {
  const { tag, jahre } = naechstesMal(j.datum, heute);
  const n = tage(heute, tag);
  const was = `${ART_TEXT[j.art]} ${j.name}${jahre ? ` (${jahre}${j.art === "geburtstag" ? "" : " Jahre"})` : ""}`;
  const idee = (j.ideen ?? "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (n === 14) return { stufe: 14, tag, inTagen: n, text: `${was} in 14 Tagen.${idee ? ` Geschenkidee: ${idee}.` : " Noch keine Geschenkidee notiert."}` };
  if (n === 3) return { stufe: 3, tag, inTagen: n, text: `${was} in 3 Tagen – Karte schreiben oder Anruf einplanen.` };
  if (n === 0) return { stufe: 0, tag, inTagen: 0, text: `Heute: ${was}.` };
  return null;
}

/** Die nächsten Jahrestage (sortiert), z. B. für die Privat-Startseite. */
export function demnaechst<T extends { data: Jahrestag }>(liste: T[], heute: string, tageVoraus = 30): (T & { tag: string; inTagen: number; jahre: number | null })[] {
  return liste
    .filter((e) => datumOk(e.data.datum))
    .map((e) => {
      const n = naechstesMal(e.data.datum, heute);
      return { ...e, tag: n.tag, jahre: n.jahre, inTagen: tage(heute, n.tag) };
    })
    .filter((e) => e.inTagen <= tageVoraus)
    .sort((a, b) => a.inTagen - b.inTagen);
}
