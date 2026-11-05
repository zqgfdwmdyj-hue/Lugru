// B28.2 Preis-Szenario im Deal-Eingang („Was wäre bei VK x?“) – reine Logik, läuft auch im Browser: Gewinn, Marge
// (vom Brutto-VK) und ROI bei einem frei gewählten Verkaufspreis je Land, dazu wie oft sich der Artikel in den letzten
// 12 Monaten bei diesem Preisniveau verkauft hat (Keepa-Verkaufshistorie bzw. Schätzung aus dem Verkaufsrang).

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Gewinn je Stück bei einem Brutto-VK: VK netto − Provision (auf den Bruttopreis) − FBA − EK − Prep. */
export function szenarioRechnen(o: { vkBrutto: number; mwstSatz: number; provision: number; fba: number; prep: number; ekNetto: number }): { gewinn: number; marge: number | null; roi: number | null } {
  const vkNetto = o.vkBrutto / (1 + o.mwstSatz);
  const gebuehren = o.vkBrutto * o.provision + o.fba;
  const kosten = o.ekNetto + o.prep;
  const gewinn = vkNetto - gebuehren - kosten;
  return { gewinn: r2(gewinn), marge: o.vkBrutto > 0 ? r1((gewinn / o.vkBrutto) * 100) : null, roi: kosten > 0 ? r1((gewinn / kosten) * 100) : null };
}

/** Ein Tag aus dem Keepa-Verlauf: [Tag, Buy Box brutto, Verkaufsrang]. */
export type PreisTag = [tag: string, buybox: number | null, rang: number | null];

export type VerkaeufeBeiPreis = {
  /** Verkäufe je Monat (alle Anbieter) in diesem Zeitraum. */
  wert: number;
  /** keepa = „x+ gekauft“-Verlauf; rang = geschätzt (Verhältnis der Verkaufsränge bzw. Rang-Verbesserungen). */
  quelle: "keepa" | "rang";
  von: string;
  bis: string;
  /** Tage mit Buy Box in diesem Preisband. */
  tage: number;
};

const mittel = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null);
const plusTage = (tag: string, n: number) => new Date(Date.parse(`${tag}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Verkäufe je Monat beim letzten Zeitraum (12 Monate) mit Buy Box im Preisband ±toleranz um `preis`: zusammenhängende
 * Tage (Lücken bis 3 Tage zählen mit), mindestens 5 Tage. Reihenfolge der Quellen: Keepa-„gekauft“-Verlauf in diesem
 * Zeitraum → aktuelle Verkäufe × (Ø Rang 30 Tage ÷ Ø Rang im Zeitraum) → Rang-Verbesserungen hochgerechnet auf 30 Tage.
 * null = Preisniveau kam nicht vor bzw. keine Daten.
 */
export function verkaeufeBeiPreis(tage: PreisTag[], preis: number, o: { verkauftVerlauf?: [string, number][] | null; aktuellVerkaeufe?: number | null; toleranz?: number } = {}): VerkaeufeBeiPreis | null {
  if (!(preis > 0) || !tage.length) return null;
  const tol = o.toleranz ?? 0.07;
  const passt = (bb: number | null) => bb !== null && bb >= preis * (1 - tol) && bb <= preis * (1 + tol);
  // Läufe von hinten (neuester zuerst) suchen
  let ende = -1;
  let start = -1;
  let luecke = 0;
  let treffer = 0;
  for (let i = tage.length - 1; i >= 0; i--) {
    if (passt(tage[i][1])) {
      if (ende < 0) ende = i;
      start = i;
      luecke = 0;
      treffer++;
    } else if (ende >= 0) {
      luecke++;
      if (luecke > 3) {
        if (treffer >= 5) break;
        ende = -1;
        start = -1;
        luecke = 0;
        treffer = 0;
      }
    }
  }
  if (ende < 0 || treffer < 5) return null;
  const zeitraum = tage.slice(start, ende + 1);
  const von = zeitraum[0][0];
  const bis = zeitraum[zeitraum.length - 1][0];
  const basis = { von, bis, tage: treffer };

  // 1) Keepa-„gekauft“-Verlauf: Wert je Tag = letzter bekannter Punkt (höchstens 45 Tage alt)
  const hist = (o.verkauftVerlauf ?? []).filter(([, v]) => v > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (hist.length) {
    const werte: number[] = [];
    for (const [tag] of zeitraum) {
      const p = [...hist].reverse().find(([t]) => t <= tag);
      if (p && p[0] >= plusTage(tag, -45)) werte.push(p[1]);
    }
    const m = mittel(werte);
    if (m !== null && werte.length >= Math.min(5, zeitraum.length)) return { wert: Math.round(m), quelle: "keepa", ...basis };
  }
  // 2) Aktuelle Verkäufe über das Verhältnis der Ränge (besserer = kleinerer Rang → mehr Verkäufe)
  const raengeZeitraum = zeitraum.map((z) => z[2]).filter((r): r is number => r !== null && r > 0);
  const raengeJetzt = tage.slice(-30).map((z) => z[2]).filter((r): r is number => r !== null && r > 0);
  const rz = mittel(raengeZeitraum);
  const rj = mittel(raengeJetzt);
  if (o.aktuellVerkaeufe && o.aktuellVerkaeufe > 0 && rz && rj) return { wert: Math.max(1, Math.round((o.aktuellVerkaeufe * rj) / rz)), quelle: "rang", ...basis };
  // 3) Rang-Verbesserungen im Zeitraum, hochgerechnet auf 30 Tage (Untergrenze)
  let drops = 0;
  let paare = 0;
  for (let i = 1; i < zeitraum.length; i++) {
    const a = zeitraum[i - 1][2];
    const b = zeitraum[i][2];
    if (a === null || b === null) continue;
    paare++;
    if (b < a) drops++;
  }
  if (paare >= 4 && drops > 0) return { wert: Math.max(1, Math.round((drops / paare) * 30)), quelle: "rang", ...basis };
  return null;
}

const tm = (tag: string) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;

/** Hinweistext unter dem Szenario: „bei diesem Preis zuletzt 01.07.–30.09. (64 Tage): ca. 120 Verkäufe/Monat (Keepa)“. */
export function verkaeufeHinweis(v: VerkaeufeBeiPreis | null): string {
  if (!v) return "Dieser Preis kam in den letzten 12 Monaten nicht vor (±7 %).";
  return `Bei diesem Preis zuletzt ${tm(v.von)}–${tm(v.bis)} (${v.tage} Tage): ca. ${v.wert} Verkäufe/Monat (${v.quelle === "keepa" ? "Keepa „gekauft“" : "geschätzt aus dem Verkaufsrang"}).`;
}
