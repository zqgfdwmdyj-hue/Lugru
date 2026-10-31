// Haushaltshilfe (Babysitter, Putzhilfe …) – reine Logik, getestet in tests/haushaltshilfe.test.ts.
// Einsätze kommen aus dem Familienkalender bzw. privaten Terminen (Titel enthält z. B. „Babysitter“ oder
// „Putzfrau“) oder werden von Hand erfasst. Kosten je Stunde: fester Satz, beim Babysitter getrennt nach
// „Kinder wach“ und „Kinder schlafen“ (ab Schlafenszeit, Standard 20:00). Von Hand korrigierte Stunden oder
// Beträge gehen immer vor der Rechnung.

export type HelferArt = "babysitter" | "putzhilfe" | "sonstiges";

export type Helfer = {
  id: string;
  name: string;
  art: HelferArt;
  /** Begriffe im Termintitel (ohne Groß-/Kleinschreibung), z. B. „babysitter“, „putzfrau“, ein Vorname. */
  begriffe: string[];
  /** Fester Stundenlohn (Putzhilfe; beim Babysitter, wenn kein Wach-/Schlaf-Satz gesetzt ist). */
  satz: number | null;
  /** Babysitter: Stundensatz, solange die Kinder wach sind. */
  satzWach?: number | null;
  /** Babysitter: Stundensatz, wenn die Kinder schlafen (ab `schlafAb`). */
  satzSchlaf?: number | null;
  /** Schlafenszeit der Kinder (HH:MM), Standard 20:00. */
  schlafAb?: string;
  /** Aufwachzeit (HH:MM), Standard 06:00 – nur für Einsätze über Nacht. */
  wachAb?: string;
  aktiv?: boolean;
};

export type HaushaltshilfeEinstellungen = { helfer: Helfer[] };

export const HELFER_ART_TEXT: Record<HelferArt, string> = { babysitter: "Babysitter", putzhilfe: "Putzhilfe", sonstiges: "Sonstige Hilfe" };

/** Vorbelegung: Babysitterin 20 €/17 € (wach/schlafend, Schlafenszeit 20:00), Putzfrau ohne Satz (bitte eintragen). */
export const STANDARD_HELFER: Helfer[] = [
  { id: "babysitter", name: "Babysitterin", art: "babysitter", begriffe: ["babysitter", "babysitting", "babysitten"], satz: null, satzWach: 20, satzSchlaf: 17, schlafAb: "20:00", wachAb: "06:00", aktiv: true },
  { id: "putzhilfe", name: "Putzfrau", art: "putzhilfe", begriffe: ["putzfrau", "putzhilfe", "putzen", "reinigungskraft"], satz: null, aktiv: true },
];

export type EinsatzStatus = "geplant" | "stattgefunden" | "ausgefallen";

/** Gespeicherte Angaben zu einem Einsatz (Privat-Eintrag „haushaltshilfe“, verschlüsselt). */
export type EinsatzEintrag = {
  /** Termin-Kennung (UID|Beginn) bei Einsätzen aus dem Kalender; fehlt bei „von Hand“. */
  ref?: string;
  quelle: "kalender" | "termin" | "hand";
  helferId: string;
  day: string;
  from?: string;
  to?: string;
  titel?: string;
  status?: EinsatzStatus;
  /** Von Hand korrigierte Minuten (wach/schlafend) – gehen vor der Rechnung. */
  minWach?: number;
  minSchlaf?: number;
  /** Von Hand korrigierter Betrag in € – geht vor allem anderen. */
  betrag?: number;
  bezahlt?: boolean;
  notiz?: string;
};

/** Ein Termin aus Familienkalender oder Privat-Terminen, der zu einer Hilfe passen könnte. */
export type TerminKandidat = { ref: string; quelle: "kalender" | "termin"; titel: string; day: string; from?: string | null; to?: string | null; kalender?: string; status?: EinsatzStatus };

export type Einsatz = {
  key: string;
  recordId?: string;
  ref?: string;
  quelle: "kalender" | "termin" | "hand";
  quelleText: string;
  helferId: string;
  helferName: string;
  art: HelferArt;
  day: string;
  from?: string;
  to?: string;
  titel?: string;
  status: EinsatzStatus;
  minWach: number;
  minSchlaf: number;
  stunden: number;
  /** Betrag laut Einstellungen (null = Satz fehlt bzw. keine Uhrzeit). */
  berechnet: number | null;
  /** Gilt: von Hand eingetragener Betrag, sonst berechnet. */
  betrag: number | null;
  vonHand: boolean;
  bezahlt: boolean;
  notiz?: string;
  /** Hinweis, z. B. „Uhrzeit fehlt“ oder „nicht mehr im Kalender“. */
  hinweis?: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const minuten = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2])) : null;
};
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

/** Welche Hilfe passt zu diesem Titel? Erster aktiver Treffer über Begriffe oder Namen. */
export function helferFuer(titel: string, helfer: Helfer[]): Helfer | null {
  const t = norm(titel);
  for (const h of helfer) {
    if (h.aktiv === false) continue;
    const woerter = [...h.begriffe, h.name].map((w) => norm(w.trim())).filter((w) => w.length >= 3);
    if (woerter.some((w) => t.includes(w))) return h;
  }
  return null;
}

/** Uhrzeit aus dem Titel, z. B. „Babysitterin 17–22 Uhr“ oder „Putzfrau 9:30-12“. */
export function zeitAusTitel(titel: string): { from: string; to: string } | null {
  const m = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|bis)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|h)?/i.exec(titel);
  if (!m) return null;
  const h1 = Number(m[1]);
  const h2 = Number(m[3]);
  if (h1 > 24 || h2 > 24) return null;
  const p = (h: number, mm?: string) => `${String(h).padStart(2, "0")}:${mm ?? "00"}`;
  return { from: p(h1, m[2]), to: p(h2, m[4]) };
}

/**
 * Minuten wach/schlafend zwischen `from` und `to` (über Mitternacht, wenn `to` ≤ `from`). Schlafenszeit von
 * `schlafAb` bis `wachAb` am nächsten Morgen (auch die Nacht davor, z. B. 05:00–08:00).
 */
export function aufteilen(from: string, to: string, schlafAb = "20:00", wachAb = "06:00"): { wach: number; schlaf: number; gesamt: number } | null {
  const a = minuten(from);
  let b = minuten(to);
  if (a === null || b === null) return null;
  if (b <= a) b += 24 * 60;
  const s = minuten(schlafAb) ?? 20 * 60;
  const w = minuten(wachAb) ?? 6 * 60;
  // Schlaf-Fenster relativ zum Tagesbeginn: Nacht davor, diese Nacht, nächste Nacht.
  const fenster: [number, number][] = w < s ? [[s - 1440, w], [s, w + 1440], [s + 1440, w + 2880]] : [[s, w], [s + 1440, w + 1440]];
  const schlaf = fenster.reduce((n, [x, y]) => n + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
  return { wach: b - a - schlaf, schlaf, gesamt: b - a };
}

/** Kosten aus Minuten: Babysitter mit Wach-/Schlaf-Satz, sonst fester Satz. null = kein Satz hinterlegt. */
export function kosten(h: Pick<Helfer, "satz" | "satzWach" | "satzSchlaf">, min: { wach: number; schlaf: number }): number | null {
  if (h.satzWach !== null && h.satzWach !== undefined) {
    const schlafSatz = h.satzSchlaf ?? h.satzWach;
    return r2((min.wach / 60) * h.satzWach + (min.schlaf / 60) * schlafSatz);
  }
  if (h.satz === null || h.satz === undefined) return null;
  return r2(((min.wach + min.schlaf) / 60) * h.satz);
}

/** Satz als Text („20 € wach / 17 € schlafend ab 20:00“ bzw. „15 €/Std.“). */
export function satzText(h: Helfer): string {
  const e = (n: number) => `${String(n).replace(".", ",")} €`;
  if (h.satzWach !== null && h.satzWach !== undefined) return `${e(h.satzWach)}/Std. wach · ${e(h.satzSchlaf ?? h.satzWach)}/Std. schlafend ab ${h.schlafAb ?? "20:00"}`;
  return h.satz !== null && h.satz !== undefined ? `${e(h.satz)}/Std.` : "Stundenlohn fehlt";
}

const QUELLE_TEXT = { kalender: "Familienkalender", termin: "Privat-Termin", hand: "von Hand" } as const;

/**
 * Einsätze eines Zeitraums: passende Termine (Kalender, Privat-Termine) zusammen mit gespeicherten Angaben
 * (gleiche Termin-Kennung) und den von Hand erfassten Einsätzen.
 */
export function einsaetze(o: { helfer: Helfer[]; termine: TerminKandidat[]; eintraege: { id: string; data: EinsatzEintrag }[]; von: string; bis: string; heute: string }): Einsatz[] {
  const byId = new Map(o.helfer.map((h) => [h.id, h]));
  const zuRef = new Map(o.eintraege.filter((e) => e.data.ref).map((e) => [e.data.ref!, e]));
  const genutzt = new Set<string>();
  const out: Einsatz[] = [];
  const bauen = (h: Helfer, basis: { key: string; ref?: string; quelle: Einsatz["quelle"]; quelleText: string; day: string; from?: string; to?: string; titel?: string; status?: EinsatzStatus }, rec?: { id: string; data: EinsatzEintrag }, hinweis?: string): Einsatz => {
    const d = rec?.data;
    const from = d?.from ?? basis.from;
    const to = d?.to ?? basis.to;
    const geteilt = from && to ? aufteilen(from, to, h.schlafAb, h.wachAb) : null;
    const babysitter = h.satzWach !== null && h.satzWach !== undefined;
    const minWach = d?.minWach ?? (geteilt ? (babysitter ? geteilt.wach : geteilt.gesamt) : 0);
    const minSchlaf = d?.minSchlaf ?? (geteilt && babysitter ? geteilt.schlaf : 0);
    const hatZeit = Boolean(geteilt) || d?.minWach !== undefined || d?.minSchlaf !== undefined;
    const berechnet = hatZeit ? kosten(h, { wach: minWach, schlaf: minSchlaf }) : null;
    const status: EinsatzStatus = d?.status ?? basis.status ?? (basis.day > o.heute ? "geplant" : "stattgefunden");
    const betrag = d?.betrag ?? berechnet;
    const hinweise = [hinweis, !hatZeit && d?.betrag === undefined ? "Uhrzeit fehlt – von/bis oder Betrag eintragen" : null, hatZeit && berechnet === null && d?.betrag === undefined ? "Stundenlohn fehlt" : null].filter(Boolean);
    return {
      key: basis.key,
      recordId: rec?.id,
      ref: basis.ref,
      quelle: basis.quelle,
      quelleText: basis.quelleText,
      helferId: h.id,
      helferName: h.name,
      art: h.art,
      day: d?.day ?? basis.day,
      from,
      to,
      titel: basis.titel ?? d?.titel,
      status,
      minWach,
      minSchlaf,
      stunden: r2((minWach + minSchlaf) / 60),
      berechnet,
      betrag,
      vonHand: d?.betrag !== undefined || d?.minWach !== undefined || d?.minSchlaf !== undefined || d?.from !== undefined || d?.to !== undefined,
      bezahlt: Boolean(d?.bezahlt),
      notiz: d?.notiz,
      hinweis: hinweise.length ? hinweise.join(" · ") : undefined,
    };
  };

  for (const t of o.termine) {
    if (t.day < o.von || t.day > o.bis) continue;
    const rec = zuRef.get(t.ref);
    const h = (rec ? byId.get(rec.data.helferId) : null) ?? helferFuer(t.titel, o.helfer);
    if (!h) continue;
    if (rec) genutzt.add(rec.id);
    const zeit = t.from && t.to ? { from: t.from, to: t.to } : zeitAusTitel(t.titel) ?? (t.from ? { from: t.from, to: undefined } : null);
    out.push(bauen(h, { key: `t:${t.ref}`, ref: t.ref, quelle: t.quelle, quelleText: t.kalender ? `${QUELLE_TEXT[t.quelle]} „${t.kalender}“` : QUELLE_TEXT[t.quelle], day: t.day, from: zeit?.from ?? undefined, to: zeit?.to ?? undefined, titel: t.titel, status: t.status }, rec));
  }
  for (const rec of o.eintraege) {
    if (genutzt.has(rec.id) || rec.data.day < o.von || rec.data.day > o.bis) continue;
    const h = byId.get(rec.data.helferId);
    if (!h) continue;
    const ausKalender = rec.data.quelle !== "hand";
    out.push(bauen(h, { key: `e:${rec.id}`, ref: rec.data.ref, quelle: rec.data.quelle, quelleText: QUELLE_TEXT[rec.data.quelle], day: rec.data.day, titel: rec.data.titel }, rec, ausKalender ? "nicht mehr im Kalender – Angaben von Hand bleiben" : undefined));
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.from ?? "").localeCompare(b.from ?? ""));
}

export type HelferSumme = { helferId: string; name: string; art: HelferArt; anzahl: number; stunden: number; stundenWach: number; stundenSchlaf: number; kosten: number; ohneBetrag: number; bezahlt: number; offen: number };

/** Monatsauswertung: nur stattgefundene Einsätze zählen; geplante gesondert; ausgefallene nicht. */
export function auswertung(e: Einsatz[]) {
  const zaehlt = e.filter((x) => x.status === "stattgefunden");
  const je = new Map<string, HelferSumme>();
  for (const x of zaehlt) {
    const s = je.get(x.helferId) ?? { helferId: x.helferId, name: x.helferName, art: x.art, anzahl: 0, stunden: 0, stundenWach: 0, stundenSchlaf: 0, kosten: 0, ohneBetrag: 0, bezahlt: 0, offen: 0 };
    s.anzahl++;
    s.stunden += x.stunden;
    s.stundenWach += x.minWach / 60;
    s.stundenSchlaf += x.minSchlaf / 60;
    if (x.betrag === null) s.ohneBetrag++;
    else {
      s.kosten += x.betrag;
      if (x.bezahlt) s.bezahlt += x.betrag;
      else s.offen += x.betrag;
    }
    je.set(x.helferId, s);
  }
  const helfer = [...je.values()].map((s) => ({ ...s, stunden: r2(s.stunden), stundenWach: r2(s.stundenWach), stundenSchlaf: r2(s.stundenSchlaf), kosten: r2(s.kosten), bezahlt: r2(s.bezahlt), offen: r2(s.offen) })).sort((a, b) => b.kosten - a.kosten);
  const geplant = e.filter((x) => x.status === "geplant");
  return {
    anzahl: zaehlt.length,
    stunden: r2(helfer.reduce((n, s) => n + s.stunden, 0)),
    kosten: r2(helfer.reduce((n, s) => n + s.kosten, 0)),
    offen: r2(helfer.reduce((n, s) => n + s.offen, 0)),
    ohneBetrag: helfer.reduce((n, s) => n + s.ohneBetrag, 0),
    ausgefallen: e.filter((x) => x.status === "ausgefallen").length,
    geplant: { anzahl: geplant.length, kosten: r2(geplant.reduce((n, x) => n + (x.betrag ?? 0), 0)) },
    helfer,
  };
}

const zahl = (n: number) => n.toFixed(2).replace(".", ",");
const csvFeld = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** CSV für den Monat (Semikolon, deutsche Zahlen, mit Summen je Hilfe). */
export function einsaetzeCsv(e: Einsatz[], monat: string): string {
  const kopf = ["Datum", "Wochentag", "Hilfe", "von", "bis", "Std. wach", "Std. schlafend", "Std. gesamt", "Betrag €", "Rechnung", "Status", "bezahlt", "Quelle", "Notiz"];
  const zeilen = e.map((x) => [
    `${x.day.slice(8, 10)}.${x.day.slice(5, 7)}.${x.day.slice(0, 4)}`,
    WT[new Date(`${x.day}T12:00:00Z`).getUTCDay()],
    x.helferName,
    x.from ?? "",
    x.to ?? "",
    zahl(x.minWach / 60),
    zahl(x.minSchlaf / 60),
    zahl(x.stunden),
    x.betrag === null ? "" : zahl(x.betrag),
    x.vonHand ? "von Hand" : x.betrag === null ? "fehlt" : "berechnet",
    x.status,
    x.bezahlt ? "ja" : "nein",
    x.quelleText,
    x.notiz ?? "",
  ]);
  const a = auswertung(e);
  const summen = [[], [`Summe ${monat} (nur stattgefunden)`, "", "", "", "", "", "", zahl(a.stunden), zahl(a.kosten)], ...a.helfer.map((s) => [`  ${s.name}`, `${s.anzahl}×`, "", "", "", zahl(s.stundenWach), zahl(s.stundenSchlaf), zahl(s.stunden), zahl(s.kosten), "", "", `offen ${zahl(s.offen)}`])];
  return `﻿${[kopf, ...zeilen, ...summen].map((r) => r.map((f) => csvFeld(String(f))).join(";")).join("\r\n")}\r\n`;
}

/** Einstellungen bereinigen (Satz ≥ 0, Uhrzeiten HH:MM, Begriffe kleingeschrieben, eindeutige IDs). */
export function helferBereinigen(h: Helfer[]): Helfer[] {
  const zeit = (v: string | undefined, d: string) => (v && /^\d{2}:\d{2}$/.test(v) ? v : d);
  const satz = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) || v < 0 ? null : r2(v));
  const ids = new Set<string>();
  return h
    .filter((x) => x.name.trim())
    .map((x) => {
      let id = x.id.trim() || norm(x.name.trim()).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "hilfe";
      while (ids.has(id)) id = `${id}-2`;
      ids.add(id);
      return {
        id,
        name: x.name.trim().slice(0, 60),
        art: x.art,
        begriffe: [...new Set(x.begriffe.map((b) => b.trim().toLowerCase()).filter((b) => b.length >= 3))].slice(0, 10),
        satz: satz(x.satz),
        satzWach: x.art === "babysitter" ? satz(x.satzWach) : null,
        satzSchlaf: x.art === "babysitter" ? satz(x.satzSchlaf) : null,
        schlafAb: zeit(x.schlafAb, "20:00"),
        wachAb: zeit(x.wachAb, "06:00"),
        aktiv: x.aktiv !== false,
      };
    });
}
