// Deal-Eingang Abschnitt 4 „Risiken“ – reine Logik: Gefahrgut, Rechteinhaber-/IP-Beschwerden (Amazon-Fall-Zentrale),
// Echtheits-Ordner und selektiver Vertrieb (Vertriebsfreigaben im Lieferanten-Profil). Rot nur, wenn es die ASIN selbst
// bzw. den Lieferanten des Angebots betrifft; Marken-Treffer sind Gelb, Vermutungen nur ein Hinweis.

export type IpVorgang = { asins: string[]; marke: string | null; offen: boolean; fallnummer: string | null };
export type VertriebsProfil = { lieferant: string; marken: string[]; wiederverkaufErlaubt: boolean | null; marktplatzErlaubt: boolean | null };
export type EchtheitMarke = { marke: string; aliase: string[]; belege: number };
export type RisikoDaten = { hazmat: Set<string>; ip: IpVorgang[]; echtheit: EchtheitMarke[]; vertrieb: VertriebsProfil[] };
export type RisikoErgebnis = { rot: string[]; gelb: string[]; hinweise: string[]; marke: string | null };

export const markeKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");

/** Typische Gefahrgut-Hinweise im Titel (Aerosole, Lithium-Akkus, Parfum, entzündliche Stoffe). Nur Vermutung. */
const GEFAHRGUT = /\b(aerosol|spr[uü]hdose|haarspray|deospray|deodorant ?spray|trockenshampoo|lithium|li-?ion|akku|powerbank|batterie|parf[uü]m|eau de (toilette|parfum|cologne)|nagellack(entferner)?|feuerzeug|gaskartusche|entz[uü]ndlich|brennbar|l[oö]sungsmittel|spiritus|duftkerze)\b/i;

/** Marke des Angebots: Angabe aus der Nachricht, sonst eine bekannte Marke (Echtheits-Ordner, Vertrieb, Fälle) im Titel. */
export function markeErkennen(angabe: string | null, titel: string | null, bekannte: string[]): string | null {
  if (angabe?.trim()) return angabe.trim();
  if (!titel) return null;
  const woerter = titel.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").split(/[^a-z0-9]+/).filter(Boolean);
  let beste: string | null = null;
  for (const m of bekannte) {
    const k = markeKey(m);
    if (k.length < 3) continue;
    // Marke aus 1–3 aufeinanderfolgenden Wörtern („L'Oréal“ → „l“ + „oreal“ = „loreal“)
    let treffer = false;
    for (let i = 0; i < woerter.length && !treffer; i++) for (let n = 1; n <= 3 && i + n <= woerter.length && !treffer; n++) treffer = woerter.slice(i, i + n).join("") === k;
    if (treffer && (!beste || k.length > markeKey(beste).length)) beste = m;
  }
  return beste;
}

const gleicheMarke = (a: string | null, b: string | null) => !!a && !!b && markeKey(a) === markeKey(b);

export function risikoPruefen(z: { asin: string; titel: string | null; marke: string | null; quelle: string | null }, d: RisikoDaten): RisikoErgebnis {
  const rot: string[] = [];
  const gelb: string[] = [];
  const hinweise: string[] = [];
  const bekannte = [...d.echtheit.flatMap((e) => [e.marke, ...e.aliase]), ...d.vertrieb.flatMap((v) => v.marken), ...d.ip.map((i) => i.marke).filter((m): m is string => !!m)];
  const marke = markeErkennen(z.marke, z.titel, bekannte);

  // Gefahrgut: sicher aus dem eigenen Produktstamm, sonst nur ein Hinweis aus dem Titel
  if (d.hazmat.has(z.asin)) gelb.push("Gefahrgut (laut Produktstamm) – FBA-Freigabe für Gefahrgut nötig.");
  else if (z.titel && GEFAHRGUT.test(z.titel)) hinweise.push(`Gefahrgut möglich („${z.titel.match(GEFAHRGUT)![0]}“) – Hazmat-Einstufung in Seller Central prüfen.`);

  // Rechteinhaber-/IP-Beschwerden aus der Amazon-Fall-Zentrale
  const zurAsin = d.ip.filter((i) => i.asins.includes(z.asin));
  const zurMarke = d.ip.filter((i) => !i.asins.includes(z.asin) && gleicheMarke(i.marke, marke));
  if (zurAsin.some((i) => i.offen)) rot.push(`Offene Rechteinhaber-Beschwerde zu dieser ASIN${zurAsin.find((i) => i.offen)?.fallnummer ? ` (Fall ${zurAsin.find((i) => i.offen)!.fallnummer})` : ""}.`);
  else if (zurAsin.length) gelb.push("Frühere Rechteinhaber-Beschwerde zu dieser ASIN (Fall-Zentrale).");
  if (zurMarke.length) gelb.push(`Marke ${marke}: ${zurMarke.length === 1 ? "Rechteinhaber-Beschwerde" : `${zurMarke.length} Rechteinhaber-Beschwerden`} bekannt (Fall-Zentrale).`);

  // Echtheits-Ordner: Marke angelegt, aber noch keine Rechnung als Nachweis
  const ordner = marke ? d.echtheit.find((e) => gleicheMarke(e.marke, marke) || e.aliase.some((a) => gleicheMarke(a, marke))) : null;
  if (ordner && ordner.belege === 0) hinweise.push(`Echtheits-Ordner ${ordner.marke}: noch keine Rechnung als Nachweis hinterlegt.`);

  // Selektiver Vertrieb: Vertriebsfreigaben im Lieferanten-Profil (Quelle = Lieferant) bzw. je Marke
  const lieferant = z.quelle ? d.vertrieb.find((v) => gleicheMarke(v.lieferant, z.quelle)) : null;
  if (lieferant?.marktplatzErlaubt === false) rot.push(`Lieferant ${lieferant.lieferant} erlaubt keinen Verkauf auf Marktplätzen (selektiver Vertrieb).`);
  else if (lieferant?.wiederverkaufErlaubt === false) rot.push(`Lieferant ${lieferant.lieferant} erlaubt keinen Wiederverkauf.`);
  else if (lieferant && lieferant.marktplatzErlaubt === null) hinweise.push(`Vertriebsfreigabe bei ${lieferant.lieferant} ungeklärt (B2B → Lieferanten-Freigaben).`);
  const gesperrt = marke ? d.vertrieb.filter((v) => v !== lieferant && v.marktplatzErlaubt === false && v.marken.some((m) => gleicheMarke(m, marke))) : [];
  if (gesperrt.length) gelb.push(`Marke ${marke}: selektiver Vertrieb – laut ${gesperrt[0].lieferant} kein Verkauf auf Marktplätzen.`);

  return { rot, gelb, hinweise, marke };
}
