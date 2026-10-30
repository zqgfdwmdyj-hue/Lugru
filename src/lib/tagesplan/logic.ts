// Tagesplan – reine Logik: Arbeitszeit je Wochentag minus Sperrzeiten (Familie, Privates, Termine, freie Zeiten)
// = Kapazität; Aufgaben nach Priorität und Frist in die freien Fenster legen; was nicht passt, wird bewusst auf den
// nächsten Tag mit Platz verschoben; Konflikte (z. B. Frist fällt in eine Auszeit) werden gemeldet.

export type Aufwand = "S" | "M" | "L";
export const AUFWAND_MIN: Record<Aufwand, number> = { S: 15, M: 60, L: 240 };
export const AUFWAND_TEXT: Record<Aufwand, string> = { S: "S · 15 Min.", M: "M · 1 Std.", L: "L · halber Tag" };

/** Arbeitszeit je ISO-Wochentag (1 = Mo … 7 = So); null = kein Arbeitstag. */
export type Arbeitszeit = Record<string, { von: string; bis: string } | null>;
export const ARBEITSZEIT_STANDARD: Arbeitszeit = { "1": { von: "09:00", bis: "17:00" }, "2": { von: "09:00", bis: "17:00" }, "3": { von: "09:00", bis: "17:00" }, "4": { von: "09:00", bis: "17:00" }, "5": { von: "09:00", bis: "17:00" }, "6": null, "7": null };

export type Sperre = { von: string; bis: string; titel: string; art: "privat" | "termin" | "frei" | "reserviert"; ganztags?: boolean };
export type PlanAufgabe = { id: string; titel: string; faellig: string | null; prioritaet: "critical" | "normal" | "low"; aufwand: Aufwand; geschaetzt: boolean; link: string | null };
export type Geplant = PlanAufgabe & { von: string; bis: string };
export type Verschoben = PlanAufgabe & { neu: string };
export type Konflikt = { aufgabeId: string; titel: string; text: string };
export type TagPlan = { tag: string; arbeitszeit: { von: string; bis: string } | null; sperren: Sperre[]; kapazitaet: number; geplant: Geplant[]; belegt: number; auslastung: number | null; ampel: "gruen" | "gelb" | "rot" | "frei"; konflikte: Konflikt[] };

const min = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const wochentag = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};
export const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Aufwand vorschätzen, wenn keiner eingetragen ist: kurze Handgriffe S, große Brocken L, sonst M. */
export function schaetzeAufwand(titel: string): Aufwand {
  const t = titel.toLowerCase();
  if (/inventur|buchhaltung|steuererkl|jahresabschluss|umzug|einricht|shooting|recherche|audit|retouren-prüfung|retourenwelle|lager aufräum|workshop|schulung/.test(t)) return "L";
  if (/anruf|anrufen|zurückrufen|mail|antwort|antworten|bestätig|überweis|bezahl|zahlen|nachfass|erinner|weiterleit|kurz|unterschreib|freigeb|hochladen|eintragen|termin (machen|vereinbaren|buchen)/.test(t)) return "S";
  return "M";
}

/** Freie Fenster (Minuten) in der Arbeitszeit nach Abzug der Sperrzeiten. */
export function freieFenster(az: { von: string; bis: string } | null, sperren: Sperre[]): { von: number; bis: number }[] {
  if (!az) return [];
  if (sperren.some((s) => s.ganztags && s.art !== "reserviert")) return [];
  let fenster = [{ von: min(az.von), bis: min(az.bis) }];
  for (const s of sperren.filter((x) => !x.ganztags)) {
    const a = min(s.von);
    const b = min(s.bis);
    fenster = fenster.flatMap((f) => {
      if (b <= f.von || a >= f.bis) return [f];
      const out: { von: number; bis: number }[] = [];
      if (a > f.von) out.push({ von: f.von, bis: a });
      if (b < f.bis) out.push({ von: b, bis: f.bis });
      return out;
    });
  }
  return fenster.filter((f) => f.bis - f.von >= 5);
}

const RANG = { critical: 0, normal: 1, low: 2 } as const;
/** Reihenfolge: wichtig vor normal vor niedrig, dann frühere Frist, dann ohne Frist. */
export const reihenfolge = (a: PlanAufgabe, b: PlanAufgabe) => RANG[a.prioritaet] - RANG[b.prioritaet] || (a.faellig ?? "9999").localeCompare(b.faellig ?? "9999") || a.titel.localeCompare(b.titel);

/**
 * Einen Tag füllen: Kandidaten in Reihenfolge in die freien Fenster legen (eine Aufgabe darf über eine Pause
 * hinweg weiterlaufen). Reservierte Stunden (z. B. Retouren-Prüfung) kürzen die Kapazität vorab.
 */
export function planeTag(tag: string, kandidaten: PlanAufgabe[], az: { von: string; bis: string } | null, sperren: Sperre[]): { plan: TagPlan; rest: PlanAufgabe[] } {
  const fenster = freieFenster(az, sperren);
  const reserviert = sperren.filter((s) => s.art === "reserviert").reduce((n, s) => n + Math.max(0, min(s.bis) - min(s.von)), 0);
  const roh = fenster.reduce((n, f) => n + f.bis - f.von, 0);
  const kapazitaet = Math.max(0, roh - reserviert);
  let frei = kapazitaet;
  const geplant: Geplant[] = [];
  const rest: PlanAufgabe[] = [];
  let fi = 0;
  let pos = fenster[0]?.von ?? 0;
  for (const a of [...kandidaten].sort(reihenfolge)) {
    const dauer = AUFWAND_MIN[a.aufwand];
    if (dauer > frei) {
      rest.push(a);
      continue;
    }
    let bleibt = dauer;
    // Ist das aktuelle Fenster schon voll, beginnt die Aufgabe im nächsten.
    while (fi < fenster.length && pos >= fenster[fi].bis) {
      fi++;
      pos = fenster[fi]?.von ?? pos;
    }
    const start = pos;
    while (bleibt > 0 && fi < fenster.length) {
      const platz = fenster[fi].bis - pos;
      if (platz <= 0) {
        fi++;
        pos = fenster[fi]?.von ?? pos;
        continue;
      }
      const nimm = Math.min(platz, bleibt);
      pos += nimm;
      bleibt -= nimm;
    }
    frei -= dauer;
    geplant.push({ ...a, von: hhmm(start), bis: hhmm(pos) });
  }
  const belegt = kapazitaet - frei;
  const auslastung = kapazitaet > 0 ? Math.round((belegt / kapazitaet) * 100) : null;
  const ampel = !az || kapazitaet === 0 ? "frei" : rest.length ? "rot" : (auslastung ?? 0) > 80 ? "gelb" : "gruen";
  return { plan: { tag, arbeitszeit: az, sperren, kapazitaet, geplant, belegt, auslastung, ampel, konflikte: [] }, rest };
}

/**
 * Mehrere Tage planen (ab `start`): Aufgaben mit Frist bis zum Tag (überfällige zuerst) und – solange Platz ist – die
 * der nächsten `vorziehen` Tage. Was an einem Tag nicht passt, rutscht in den nächsten Tag mit Platz („verschoben“
 * mit neuem Datum). Konflikte: Frist fällt auf einen Tag ohne Kapazität (z. B. Auszeit) oder wichtige Aufgabe passt
 * heute nicht mehr.
 */
export function planeTage(o: { start: string; tage: number; aufgaben: PlanAufgabe[]; arbeitszeit: Arbeitszeit; sperrenAm: (tag: string) => Sperre[]; vorziehen?: number }): { tage: TagPlan[]; verschoben: Verschoben[]; ohneFrist: PlanAufgabe[] } {
  const vorziehen = o.vorziehen ?? 2;
  const offen = new Map(o.aufgaben.filter((a) => a.faellig).map((a) => [a.id, a]));
  const tage: TagPlan[] = [];
  const verschoben = new Map<string, Verschoben>();
  const sperrenCache = new Map<string, Sperre[]>();
  const sperren = (t: string) => sperrenCache.get(t) ?? (sperrenCache.set(t, o.sperrenAm(t)), sperrenCache.get(t)!);
  // Konflikte „Frist in Sperrzeit“ für alle Aufgaben im Zeitraum.
  const ende = plusTage(o.start, o.tage - 1);
  const konfliktAm = new Map<string, Konflikt[]>();
  for (const a of offen.values()) {
    if (!a.faellig || a.faellig < o.start || a.faellig > ende) continue;
    const az = o.arbeitszeit[String(wochentag(a.faellig))] ?? null;
    const s = sperren(a.faellig);
    const ganz = s.find((x) => x.ganztags && x.art !== "reserviert");
    if (ganz || !az || !freieFenster(az, s).length) {
      const grund = ganz ? `Frist fällt in „${ganz.titel}“` : !az ? "Frist fällt auf einen freien Tag" : "Frist fällt auf einen Tag ohne freie Zeit";
      konfliktAm.set(a.faellig, [...(konfliktAm.get(a.faellig) ?? []), { aufgabeId: a.id, titel: a.titel, text: grund }]);
    }
  }
  for (let i = 0; i < o.tage; i++) {
    const tag = plusTage(o.start, i);
    const az = o.arbeitszeit[String(wochentag(tag))] ?? null;
    const faellig = [...offen.values()].filter((a) => a.faellig! <= tag);
    const vor = [...offen.values()].filter((a) => a.faellig! > tag && a.faellig! <= plusTage(tag, vorziehen));
    const { plan, rest } = planeTag(tag, faellig, az, sperren(tag));
    // Mit dem restlichen Platz die nächsten Tage vorziehen (nur, was ganz passt).
    let frei = plan.kapazitaet - plan.belegt;
    for (const a of [...vor].sort(reihenfolge)) {
      if (AUFWAND_MIN[a.aufwand] > frei || rest.length) continue;
      const letzte = plan.geplant[plan.geplant.length - 1];
      const von = letzte ? letzte.bis : (freieFenster(az, sperren(tag))[0] ? hhmm(freieFenster(az, sperren(tag))[0].von) : "00:00");
      const bis = hhmm(min(von) + AUFWAND_MIN[a.aufwand]);
      plan.geplant.push({ ...a, von, bis });
      plan.belegt += AUFWAND_MIN[a.aufwand];
      frei -= AUFWAND_MIN[a.aufwand];
    }
    if (plan.kapazitaet > 0) plan.auslastung = Math.round((plan.belegt / plan.kapazitaet) * 100);
    for (const g of plan.geplant) offen.delete(g.id);
    for (const r of rest) {
      if (!verschoben.has(r.id)) verschoben.set(r.id, { ...r, neu: plusTage(tag, 1) });
      if (r.prioritaet === "critical" && r.faellig === tag) plan.konflikte.push({ aufgabeId: r.id, titel: r.titel, text: "Wichtig und heute fällig, passt aber nicht mehr in den Tag" });
    }
    plan.konflikte.push(...(konfliktAm.get(tag) ?? []));
    tages(plan);
    tage.push(plan);
  }
  // Endgültiges neues Datum = der Tag, an dem die Aufgabe dann eingeplant wurde (sonst nach dem Zeitraum).
  const eingeplantAm = new Map<string, string>();
  for (const t of tage) for (const g of t.geplant) eingeplantAm.set(g.id, t.tag);
  const vers = [...verschoben.values()].map((v) => ({ ...v, neu: eingeplantAm.get(v.id) ?? plusTage(ende, 1) })).filter((v) => v.neu !== v.faellig);
  return { tage, verschoben: vers, ohneFrist: o.aufgaben.filter((a) => !a.faellig) };
}

/** Ampel nach Vorziehen neu bestimmen. */
function tages(p: TagPlan) {
  if (!p.arbeitszeit || p.kapazitaet === 0) p.ampel = "frei";
  else if (p.konflikte.some((k) => k.text.startsWith("Wichtig"))) p.ampel = "rot";
  else if ((p.auslastung ?? 0) > 80) p.ampel = p.ampel === "rot" ? "rot" : "gelb";
}
