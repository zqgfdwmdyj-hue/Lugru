import { describe, expect, it } from "vitest";
import { abrechnungAusGespeicherten, TX_DB_PREFIX, type GespeicherteTransaktion } from "@/lib/reports/transaktionen";
import { amazonQuelle } from "@/lib/money/profit-logic";
import { routineArt } from "@/lib/amazon-faelle/logic";
import { BUYBOX_RE } from "@/lib/amazon-todos/mail-muster";
import { fahrzeitSchaetzen, plzAus } from "@/lib/mobil/fahrzeit";
import { intervallText, planAusTakt } from "@/lib/today/abruf-plan";
import { steuerTermineBald } from "@/lib/money/liquiditaet";
import { siehtNachVaAus, zugriffsWarnungen, type Mitglied } from "@/lib/auth/rollen";

// B25 (Browser-Prüfung Teil 4) mit erfundenen Werten.

const tx = (o: Partial<GespeicherteTransaktion>): GespeicherteTransaktion => ({ rowHash: "h", date: "2026-10-20", type: "Bestellung", kind: "sale", settlementId: "777", orderId: "302-1", sku: "TEST-A", description: "Testartikel", quantity: 2, channel: "fba", productSales: 20, shippingCredits: 0, sellingFees: -3, fbaFees: -4.5, total: 16.3, ...o });

describe("B25.1 Abrechnung aus gespeicherten Transaktionen", () => {
  it("Zeilen ergeben genau „Gesamt“, Übertrag wird Auszahlung, Kennung txdb:", () => {
    const r = abrechnungAusGespeicherten(
      [
        tx({ rowHash: "a" }),
        tx({ rowHash: "b", type: "Erstattung", kind: "refund", productSales: -10, sellingFees: 1.2, fbaFees: 0, total: -10.7, quantity: 1 }),
        tx({ rowHash: "c", type: "Servicegebühr", kind: "other", productSales: null, sellingFees: null, fbaFees: null, total: -39, description: "Abo", quantity: 0 }),
        tx({ rowHash: "d", type: "Übertrag", kind: "other", productSales: null, total: -123.45, date: "2026-10-28", quantity: 0 }),
        tx({ rowHash: "e", settlementId: null }),
      ],
      () => false,
    );
    expect(r.abrechnungen).toHaveLength(1);
    expect(r.abrechnungen[0]).toMatchObject({ settlementId: "777", totalAmount: 123.45 });
    expect(r.abrechnungen[0].depositDate?.toISOString().slice(0, 10)).toBe("2026-10-28");
    const summe = r.zeilen.reduce((n, z) => n + z.amount, 0);
    expect(Math.round(summe * 100) / 100).toBe(Math.round((16.3 - 10.7 - 39) * 100) / 100);
    expect(r.zeilen.every((z) => z.rowHash.startsWith(TX_DB_PREFIX) && z.quelle === "transaktionen")).toBe(true);
    expect(r.zeilen.find((z) => z.transactionType === "Order" && z.amountDescription === "Principal")).toMatchObject({ amount: 20, quantity: 2, fulfillmentId: "AFN" });
    expect(r.zeilen.find((z) => z.transactionType === "Refund" && z.amountDescription === "Principal")).toMatchObject({ amount: -10 });
    expect(r.zeilen.some((z) => z.transactionType === "Übertrag")).toBe(false);
  });
  it("Gewinn: Daten bis gestern decken den Zeitraum ab; Name nennt den Transaktionsbericht", () => {
    expect(amazonQuelle({ abrechnungBis: "2026-10-30", bis: "2026-10-31", hatAbrechnung: true, sb: { complete: true }, heute: "2026-10-31", ausTransaktionen: true })).toEqual({ art: "abrechnung", text: "Amazon-Abrechnung/Transaktionsbericht (bis 30.10.)", unvollstaendig: false });
    // ohne „heute“ wie bisher streng
    expect(amazonQuelle({ abrechnungBis: "2026-10-30", bis: "2026-10-31", hatAbrechnung: true, sb: { complete: true } }).art).toBe("sellerboard");
    // abgeschlossener Monat: 31.10. fehlt wirklich
    expect(amazonQuelle({ abrechnungBis: "2026-10-30", bis: "2026-10-31", hatAbrechnung: true, sb: { complete: true }, heute: "2026-11-05" }).art).toBe("sellerboard");
  });
});

describe("B25.4 Fall-Zentrale: Bestell-/Versandstatus, Prime/Business, Buy Box IT", () => {
  it("Status-Betreffs in 8 Sprachen", () => {
    for (const b of ["Bestellt: Testartikel", "Commandé : Testartikel", "Ordinato: Testartikel", "Pedido realizado: Testartikel", "Besteld: Testartikel", "Zamówiono: Testartikel", "Beställt: Testartikel", "Ordered: Testartikel"]) expect(routineArt(b), b).toBe("bestellung");
    for (const b of ["In Zustellung: Ihr Paket", "Versandt: Testartikel", "Livraison prévue aujourd'hui", "Livré : votre colis", "In consegna: Testartikel", "Consegnato: Testartikel", "Enviado: Testartikel", "Entregado: Testartikel", "Verzonden: Testartikel", "Bezorgd: Testartikel", "Wysłano: Testartikel", "Dostarczono: Testartikel", "Skickat: Testartikel", "Levererat: Testartikel", "Arriving today: Testartikel"]) expect(routineArt(b), b).toBe("versand");
  });
  it("Prime/Business-Infos → info (Archiv); echte Fälle bleiben Fälle", () => {
    for (const b of ["Ihr Prime-Business-Abo", "Amazon Business Prime: Ihre Mitgliedschaft", "Neu bei Amazon Business: Mengenrabatte", "Your Prime membership"]) expect(routineArt(b), b).toBe("info");
    expect(routineArt("A-bis-z-Garantieantrag zu Bestellt: Testartikel")).toBeNull();
  });
  it("Buy-Box-Hinweise auch in umgekehrter Wortstellung", () => {
    for (const b of ["Offerta in evidenza: non sei più idoneo", "Hai perso la Buy Box per B0TEST", "Sie haben die Buy Box verloren", "You lost the Buy Box", "Vous avez perdu la Buy Box", "Has perdido la Buy Box"]) expect(BUYBOX_RE.test(b), b).toBe(true);
    expect(BUYBOX_RE.test("Ihre Bestellung wurde versandt")).toBe(false);
  });
});

describe("B25.8 Fahrzeit aus dem Termin-Ort", () => {
  it("PLZ erkennen, online ohne Fahrzeit, Standard ohne PLZ", () => {
    expect(plzAus("Musterweg 1, 80331 München")).toBe("80331");
    expect(plzAus("Raum 12345678")).toBeNull();
    expect(fahrzeitSchaetzen("Zoom-Meeting", "80331 München", 20)).toEqual({ minuten: 0, grund: "online" });
    expect(fahrzeitSchaetzen("https://teams.example/x", "80331", 20).minuten).toBe(0);
    expect(fahrzeitSchaetzen("Büro Lieferant", "80331", 20)).toMatchObject({ minuten: 20 });
    expect(fahrzeitSchaetzen("80331 München", "", 25)).toMatchObject({ minuten: 25 });
  });
  it("Nähe über die PLZ, Ferne über die Luftlinie", () => {
    expect(fahrzeitSchaetzen("Testweg 1, 80331 München", "80331 München", 20).minuten).toBe(10);
    expect(fahrzeitSchaetzen("Testweg 1, 80337 München", "80331 München", 20).minuten).toBe(20);
    expect(fahrzeitSchaetzen("Testweg 1, 80997 München", "80331 München", 20).minuten).toBe(30);
    // Nachbar-Leitregion (81 = auch München): über die Luftlinie, kurz
    expect(fahrzeitSchaetzen("Testweg 1, 81241 München", "80331 München", 20).minuten).toBeLessThanOrEqual(20);
    const weit = fahrzeitSchaetzen("Testweg 1, 90402 Nürnberg", "80331 München", 20);
    expect(weit.minuten).toBeGreaterThanOrEqual(120);
    expect(weit.minuten).toBeLessThanOrEqual(240);
    expect(weit.grund).toMatch(/ca\. \d+ km/);
  });
});

describe("B25.12 Zeitplan je Abruf, Steuertermine", () => {
  it("Intervall-Texte nach dem 5-Minuten-Takt", () => {
    expect(intervallText(4)).toBe("alle 5 Min.");
    expect(intervallText(14)).toBe("alle 15 Min.");
    expect(intervallText(59)).toBe("stündlich");
    expect(intervallText(179)).toBe("alle 3 Std.");
    expect(intervallText(1435)).toBe("täglich");
    expect(planAusTakt({ minuten: 29 })).toEqual({ ausloeser: "zeitplan", text: "Zeitplan: alle 30 Min.", minuten: 30 });
    expect(planAusTakt({ taeglichUm: "06:00" })).toEqual({ ausloeser: "zeitplan", text: "Zeitplan: täglich 06:00", taeglichUm: "06:00" });
  });
  it("Steuertermine der nächsten 7 Tage – auch ohne Betrag, Wochenende → Montag", () => {
    const t = steuerTermineBald([{ name: "USt-Voranmeldung", betrag: 0, monate: [11], tag: 10 }, { name: "Vorauszahlung", betrag: 2500, monate: [12], tag: 10 }], "2026-11-05", 7);
    expect(t).toEqual([{ datum: "2026-11-10", name: "USt-Voranmeldung", betrag: null }]);
    expect(steuerTermineBald([{ name: "Vorauszahlung", betrag: 2500, monate: [12], tag: 10 }], "2026-12-05", 7)).toEqual([{ datum: "2026-12-10", name: "Vorauszahlung", betrag: 2500 }]);
  });
});

describe("B25.9 VA-Konto erkennen", () => {
  const m = (o: Partial<Mitglied>): Mitglied => ({ userId: "x", email: "x@firma.example", name: null, role: "staff", areas: [], readOnly: false, privateAccess: false, privateScope: "voll", lastLoginAt: null, ...o });
  it("va@… ohne VA-Rolle → Vorschlag-Knopf", () => {
    expect(siehtNachVaAus(m({ email: "va@va.example" }))).toBe(true);
    expect(siehtNachVaAus(m({ email: "eva@firma.example" }))).toBe(false);
    expect(siehtNachVaAus(m({ email: "x@firma.example", name: "VA Manila" }))).toBe(true);
    const w = zugriffsWarnungen([m({ userId: "ich", role: "owner" }), m({ userId: "v", email: "va@va.example" })], "ich", {});
    expect(w.find((x) => x.userId === "v")).toMatchObject({ stufe: "gelb", vaVorschlag: true });
  });
});
