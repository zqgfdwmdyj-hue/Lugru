// Nachtrag B29 (05.11.2026): sellerboard-Aufruflimit 125/Tag – Budget, Pause, Zeitplan, Nachholen. Erfundene Werte.
import { describe, expect, it } from "vitest";
import {
  budgetEntscheidung,
  faelligeScopes,
  istLimitFehler,
  leererStand,
  naechsterReset,
  pauseText,
  quotaAus,
  SB_SLOTS,
  scopeFaellig,
  tagesSchaetzung,
  tageZuLesen,
  uebersprungenText,
  uhrText,
  verkaufUmfang,
  verkaufVorrang,
  zaehler,
} from "@/lib/sellerboard/budget-logic";
import { ABRUF_PLAN, naechsterLauf, naechsterText } from "@/lib/today/abruf-plan";

/** Berliner Ortszeit im November (UTC+1). */
const nov = (tag: number, hhmm: string) => new Date(`2026-11-${String(tag).padStart(2, "0")}T${hhmm}:00+01:00`);

describe("B29.2 Rücksetzung und Limit-Fehler", () => {
  it("Rücksetzung 00:00 UTC = 01:00 Uhr im Winter, 02:00 Uhr im Sommer", () => {
    const r = naechsterReset(nov(5, "17:52"));
    expect(r.toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(uhrText(r)).toBe("01:00 Uhr");
    expect(uhrText(naechsterReset(new Date("2026-07-10T10:00:00Z")))).toBe("02:00 Uhr");
    // kurz nach Mitternacht Berlin (noch alter UTC-Tag): Rücksetzung in einer Stunde
    expect(naechsterReset(nov(6, "00:30")).toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });

  it("erkennt den Limit-Text von sellerboard, nicht andere Fehler", () => {
    expect(istLimitFehler(new Error("sellerboard (dashboard_period): You have used up today's MCP call limit (125 of 125). It resets at 00:00 UTC."))).toBe(true);
    expect(istLimitFehler("CALL_LIMIT_REACHED")).toBe(true);
    expect(istLimitFehler("sellerboard (dashboard_table): NOT_WARMED")).toBe(false);
    expect(istLimitFehler(null)).toBe(false);
  });

  it("Texte: ein Eintrag „pausiert bis 01:00 Uhr“, Abrufe „übersprungen (Tagesbudget)“", () => {
    const bis = naechsterReset(nov(5, "17:52"));
    expect(pauseText(bis)).toMatch(/^pausiert bis 01:00 Uhr – sellerboard-Tageslimit erreicht; danach automatisch nachholen \(Verkauf → Gewinn je Produkt → Rest\)$/);
    expect(uebersprungenText({ art: "tagesbudget", bis })).toMatch(/^übersprungen \(Tagesbudget\)/);
  });
});

describe("B29.2 Budget-Entscheidung", () => {
  const jetzt = nov(6, "02:30");
  it("frischer Tag: alles darf laufen", () => {
    expect(budgetEntscheidung(leererStand(), "verkauf", jetzt).ok).toBe(true);
    expect(budgetEntscheidung(leererStand(), "normal", jetzt).ok).toBe(true);
  });

  it("Pause gilt für alle, auch von Hand", () => {
    const s = { ...leererStand(), pausiertBis: naechsterReset(jetzt) };
    for (const p of ["verkauf", "normal", "hand"] as const) {
      const e = budgetEntscheidung(s, p, jetzt);
      expect(e.ok).toBe(false);
      if (!e.ok) expect(e.art).toBe("pausiert");
    }
    // nach der Rücksetzung nicht mehr
    expect(budgetEntscheidung(s, "verkauf", new Date(naechsterReset(jetzt).getTime() + 60_000)).ok).toBe(true);
  });

  it("Obergrenze 80: Verkauf hat Vorrang vor den Tagesabrufen", () => {
    // 02:30: noch 9 Verkaufs-Läufe (06–22 Uhr) × 3 = 27 Aufrufe bleiben für Verkauf frei
    expect(verkaufVorrang(jetzt)).toBe(27);
    const s = { ...leererStand(), automatik: 60 };
    const normal = budgetEntscheidung(s, "normal", jetzt);
    expect(normal.ok).toBe(false);
    if (!normal.ok) {
      expect(normal.art).toBe("tagesbudget");
      expect(normal.grund).toContain("bleiben für die restlichen Verkaufs-Abrufe");
    }
    expect(budgetEntscheidung(s, "verkauf", jetzt).ok).toBe(true);
    expect(budgetEntscheidung({ ...s, automatik: 80 }, "verkauf", jetzt).ok).toBe(false);
    // abends (22:30) gibt es keinen Verkaufs-Lauf mehr vor der Rücksetzung
    expect(verkaufVorrang(nov(6, "22:30"))).toBe(0);
  });

  it("künstlich gesetztes Budget 5 → übersprungen (Tagesbudget) statt Fehler", () => {
    const s = { ...leererStand(5), automatik: 5 };
    for (const p of ["verkauf", "normal"] as const) {
      const e = budgetEntscheidung(s, p, jetzt);
      expect(e.ok).toBe(false);
      if (!e.ok) expect(e.art).toBe("tagesbudget");
    }
    expect(budgetEntscheidung({ ...s, automatik: 4 }, "verkauf", jetzt).ok).toBe(true);
  });

  it("von Hand zählt nicht zur Obergrenze der Automatik", () => {
    expect(budgetEntscheidung({ ...leererStand(), automatik: 200 }, "hand", jetzt).ok).toBe(true);
  });

  it("die letzten 10 Aufrufe des Tages bleiben für Claude (Stand laut sellerboard)", () => {
    const s = { ...leererStand(), quotaGenutzt: 110, quotaLimit: 125 };
    expect(budgetEntscheidung(s, "verkauf", jetzt).ok).toBe(true);
    const knapp = budgetEntscheidung({ ...s, quotaGenutzt: 116 }, "verkauf", jetzt);
    expect(knapp.ok).toBe(false);
    if (!knapp.ok) expect(knapp.grund).toContain("bleiben für Claude");
    // Limit 0 = ohne Limit
    expect(budgetEntscheidung({ ...s, quotaGenutzt: 500, quotaLimit: 0 }, "verkauf", jetzt).ok).toBe(true);
  });
});

describe("B29.2 Zähler „sellerboard-Aufrufe heute: n/125 (Automatik n, Reserve n)“", () => {
  it("frischer Tag: Reserve 45", () => {
    expect(zaehler(leererStand()).text).toBe("sellerboard-Aufrufe heute: 0/125 (Automatik 0, Reserve 45)");
  });
  it("mit Stand laut sellerboard: Claude-Aufrufe zählen mit", () => {
    // beim Blick auf usage_quota: 55 genutzt, davon 40 vom System; danach 4 weitere eigene
    const z = zaehler({ ...leererStand(), automatik: 44, quotaGenutzt: 55, quotaLimit: 125, systemBeiQuota: 40 });
    expect(z.gesamt).toBe(59);
    expect(z.andere).toBe(15);
    expect(z.reserve).toBe(125 - 59 - 36);
    expect(z.text).toBe("sellerboard-Aufrufe heute: 59/125 (Automatik 44, Reserve 30)");
  });
  it("von Hand eigens ausgewiesen", () => {
    expect(zaehler({ ...leererStand(), automatik: 10, hand: 30 }).text).toBe("sellerboard-Aufrufe heute: 40/125 (Automatik 10, von Hand 30, Reserve 15)");
  });
});

describe("B29.2 usage_quota lesen", () => {
  it("verschiedene Feldnamen und Text", () => {
    expect(quotaAus({ used: 12, limit: 125, remaining: 113, resets_at: "2026-11-06T00:00:00Z" })).toEqual({ genutzt: 12, limit: 125, reset: "2026-11-06T00:00:00Z" });
    expect(quotaAus({ quota: { calls_remaining: 100, daily_limit: 125 } })).toMatchObject({ genutzt: 25, limit: 125 });
    expect(quotaAus(null, "You have made 12 of 125 MCP calls today.")).toMatchObject({ genutzt: 12, limit: 125 });
    expect(quotaAus({ foo: 1 })).toBeNull();
  });
});

describe("B29.1 Zeitplan und Nachholen", () => {
  it("Verkauf alle 2 Std. 06–22 Uhr, nachts 02:00 = 10 Läufe", () => {
    expect(SB_SLOTS.verkauf).toHaveLength(10);
    expect(SB_SLOTS.tage).toEqual(["04:00", "13:00"]);
    expect(SB_SLOTS.bestand).toEqual(["04:30", "16:30"]);
    expect(ABRUF_PLAN["sellerboard: Verkauf (Amazon + eBay)"].uhrzeiten).toEqual(SB_SLOTS.verkauf);
    expect(ABRUF_PLAN["sellerboard: Gewinn je Produkt und Tag"].uhrzeiten).toEqual(SB_SLOTS.tage);
    expect(ABRUF_PLAN["sellerboard: FBA-Bestand"].uhrzeiten).toEqual(SB_SLOTS.bestand);
    expect(ABRUF_PLAN["sellerboard: Produkte & EK"].uhrzeiten).toEqual(SB_SLOTS.taeglich);
  });

  it("fällig ab der Uhrzeit, nicht dazwischen", () => {
    expect(scopeFaellig("verkauf", nov(6, "06:00"), nov(6, "07:30"))).toBe(false);
    expect(scopeFaellig("verkauf", nov(6, "06:00"), nov(6, "08:01"))).toBe(true);
    expect(scopeFaellig("tage", nov(6, "04:00"), nov(6, "12:59"))).toBe(false);
    expect(scopeFaellig("tage", nov(6, "04:00"), nov(6, "13:00"))).toBe(true);
    expect(scopeFaellig("bestand", null, nov(6, "10:00"))).toBe(true);
  });

  it("nach der Pause: einmal nachholen um 01:00 in der Reihenfolge Verkauf → Gewinn je Produkt → Rest, kein zweiter Lauf um 02:00/04:00/04:30", () => {
    const vorher = { verkauf: nov(5, "16:00"), tage: nov(5, "04:00"), bestand: nov(5, "04:30"), taeglich: nov(4, "02:00") };
    // der Tagesabruf vom 05.11. 02:00 lief schon – nicht noch einmal
    expect(faelligeScopes({ ...vorher, taeglich: nov(5, "02:05") }, nov(6, "01:03"))).toEqual(["verkauf", "tage", "bestand"]);
    expect(faelligeScopes(vorher, nov(6, "01:03"))).toEqual(["verkauf", "tage", "bestand", "taeglich"]);
    const nachgeholt = { verkauf: nov(6, "01:03"), tage: nov(6, "01:04"), bestand: nov(6, "01:06"), taeglich: nov(6, "01:07") };
    expect(faelligeScopes(nachgeholt, nov(6, "02:05"))).toEqual([]);
    expect(faelligeScopes(nachgeholt, nov(6, "04:05"))).toEqual([]);
    expect(faelligeScopes(nachgeholt, nov(6, "04:35"))).toEqual([]);
    expect(faelligeScopes(nachgeholt, nov(6, "06:00"))).toEqual(["verkauf"]);
    expect(faelligeScopes(nachgeholt, nov(6, "13:00"))).toEqual(["verkauf", "tage"]);
  });

  it("übersprungene Gruppe bleibt fällig bis zum Nachholen", () => {
    // 20:00 übersprungen (Budget), letzter Lauf 18:00 → um 22:30 und nach der Rücksetzung weiter fällig
    expect(scopeFaellig("verkauf", nov(6, "18:00"), nov(6, "22:30"))).toBe(true);
    expect(scopeFaellig("verkauf", nov(6, "18:00"), nov(7, "01:05"))).toBe(true);
  });

  it("nächster Lauf nach festen Uhrzeiten", () => {
    const plan = ABRUF_PLAN["sellerboard: Verkauf (Amazon + eBay)"];
    expect(naechsterLauf(plan, nov(6, "14:00"), nov(6, "14:10"))?.toISOString()).toBe(nov(6, "16:00").toISOString());
    expect(naechsterText(plan, nov(6, "22:00"), nov(6, "22:10"))).toBe("07.11. 02:00");
    expect(naechsterText(ABRUF_PLAN["sellerboard: Gewinn je Produkt und Tag"], nov(6, "04:00"), nov(6, "05:00"))).toBe("heute 13:00");
  });

  it("Umfang je Verkaufs-Lauf und Tage je Gewinn-Lauf", () => {
    expect(verkaufUmfang(nov(6, "14:10"))).toEqual({ topHeute: true, ebayGestern: false, ebayHeute: false });
    expect(verkaufUmfang(nov(6, "20:05"))).toEqual({ topHeute: true, ebayGestern: false, ebayHeute: true });
    expect(verkaufUmfang(nov(6, "06:05"))).toEqual({ topHeute: false, ebayGestern: true, ebayHeute: false });
    expect(verkaufUmfang(nov(6, "08:05"))).toEqual({ topHeute: false, ebayGestern: false, ebayHeute: false });
    expect(tageZuLesen(nov(6, "04:10"), new Set([3]))).toEqual([2, 1]);
    expect(tageZuLesen(nov(6, "04:10"), new Set())).toEqual([3, 2, 1]);
    expect(tageZuLesen(nov(6, "13:10"), new Set([2, 3]))).toEqual([1]);
  });

  it("Abnahme 1 + 4 (Rechnung nach Plan): bis 12:00 höchstens 45, Tag höchstens 80, mit Morgenbericht und 3 Nachfragen unter 125", () => {
    // ~2.500 Produkte in sellerboard (Produkte & EK laufen über mehrere Tage), 150 SKUs mit FBA-Bestand
    const groessen = { kanaele: 2, fbaMitBestand: 150, produkte: 2500, skus30: 200, skusTag: 60, sendungenSeiten: 2 };
    const mittag = tagesSchaetzung(groessen, "12:01");
    const tag = tagesSchaetzung(groessen);
    expect(mittag).toBeLessThanOrEqual(45);
    expect(tag).toBeLessThanOrEqual(80);
    expect(tag + 15 + 3 * 5).toBeLessThan(125);
    expect({ mittag, tag }).toEqual({ mittag: 45, tag: 72 });
  });
});
