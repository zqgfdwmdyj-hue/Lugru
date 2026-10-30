// Keepa-Werkzeuge für Claude: keepa_produkt und keepa_vergleich – gegen den Keepa-Nachbau der Testdienste.
// Geprüft: Inhalt, Zwischenspeicher (zweiter Aufruf fragt Keepa nicht erneut), Länder-Sortierung, UK in EUR,
// unbekannte ASIN, Rechte (Lager-Konto bekommt die Werkzeuge nicht).
import { alsPerson, expect, marke, mcpVerbinden, test, testdienste } from "./helfer";

const ASIN = "B0TEST0001";
const keepaAufrufe = async () => (await testdienste.log()).filter((c) => c.path === "/keepa/product").length;

test.describe("Claude & KI-Assistent – Keepa-Werkzeuge", () => {
  test("keepa_produkt: aktuelle Werte, Kennzahlen 30/90/180, Buy-Box-Anteile, Tagesverlauf; Zwischenspeicher", async ({ browser, baseURL }) => {
    const c = await mcpVerbinden(browser, baseURL!, "inhaber");
    expect(await c.tools()).toEqual(expect.arrayContaining(["keepa_produkt", "keepa_vergleich"]));
    const n0 = await keepaAufrufe();
    const d = JSON.parse(await c.call("keepa_produkt", { asin: ASIN.toLowerCase(), marktplatz: "DE", tage: 30 }));
    expect(await keepaAufrufe()).toBe(n0 + 1);
    expect(d).toMatchObject({ asin: ASIN, marktplatz: "DE", gefunden: true, waehrung: "EUR" });
    expect(typeof d.aktuell.buybox_preis).toBe("number");
    expect(d.aktuell).toMatchObject({ monatlich_verkauft: 50, angebote_fbm: 4 });
    expect(["auf Lager", "nicht auf Lager"]).toContain(d.aktuell.amazon_status);
    for (const z of ["30_tage", "90_tage", "180_tage"]) {
      const k = d.kennzahlen[z];
      expect(k.buybox.min).toBeLessThanOrEqual(k.buybox.max);
      expect(k.rang.min).toBeLessThanOrEqual(k.rang.max);
      expect(k.amazon_nicht_auf_lager_prozent).toBe(17);
    }
    const a = d.buybox_anteile;
    expect(a.zeitraum_tage).toBe(30);
    expect(a.amazon_prozent + a.fba_prozent + a.fbm_prozent + a.unbekannt_prozent + a.keine_buybox_prozent).toBeCloseTo(100, 0);
    expect(a.amazon_prozent).toBeGreaterThan(0);
    expect(d.verlauf.spalten).toEqual(["datum", "buybox", "amazon", "angebote", "rang"]);
    expect(d.verlauf.zeilen).toHaveLength(30);
    expect(d.link).toBe(`${baseURL}/lieferanten/abfrage?q=${ASIN}`);
    expect(d.amazon_seite).toBe(`https://www.amazon.de/dp/${ASIN}`);
    expect(d.datenstand.quelle).toContain("Keepa");
    expect(d.datenstand.stand).toContain("gerade bei Keepa abgerufen");
    expect(d.datenstand.tokens_uebrig).toBeGreaterThan(0);

    // Zweiter Aufruf (auch mit anderem Zeitraum): aus dem Zwischenspeicher, keine neue Keepa-Abfrage
    const d2 = JSON.parse(await c.call("keepa_produkt", { asin: ASIN, marktplatz: "DE", tage: 365 }));
    expect(await keepaAufrufe()).toBe(n0 + 1);
    expect(d2.datenstand.stand).toContain("Zwischenspeicher");
    expect(d2.verlauf.zeilen).toHaveLength(365);
    expect(d2.buybox_anteile.zeitraum_tage).toBe(365);

    // Unbekannte ASIN: klare Antwort statt Fehler; falsche Eingabe wird abgewiesen
    const f = JSON.parse(await c.call("keepa_produkt", { asin: "B0FEHLT001", marktplatz: "FR" }));
    expect(f).toMatchObject({ gefunden: false });
    expect(f.hinweis).toContain("amazon.fr");
    expect(await c.call("keepa_produkt", { asin: "123" })).toMatch(/ASIN/);

    // Keepa-Stand älter als 48 Std.: Abruf mit „update“ → frische Werte, kein Hinweis; bleibt er alt → Hinweis
    const frisch = JSON.parse(await c.call("keepa_produkt", { asin: "B0ALT00001", marktplatz: "DE" }));
    expect(frisch.hinweis).toBeUndefined();
    expect(frisch.datenstand.keepa_veraltet).toBeUndefined();
    const alt = JSON.parse(await c.call("keepa_produkt", { asin: "B0ALTFEST1", marktplatz: "DE" }));
    expect(alt.hinweis).toContain("älter als 48 Std.");
    expect(alt.datenstand.keepa_veraltet).toContain("Tage alt");
  });

  test("keepa_vergleich: 5 Länder nach Verkäufen sortiert, UK auch in EUR, NL/BE/PL/SE als nicht erfasst", async ({ browser, baseURL }) => {
    const c = await mcpVerbinden(browser, baseURL!, "inhaber");
    // DE ist aus dem vorigen Test im Zwischenspeicher → nur 4 neue Abfragen
    const n0 = await keepaAufrufe();
    const d = JSON.parse(await c.call("keepa_vergleich", { asin: ASIN }));
    expect((await keepaAufrufe()) - n0).toBeLessThanOrEqual(5);
    expect(d.maerkte.map((m: { marktplatz: string }) => m.marktplatz)).toEqual(["UK", "DE", "ES", "FR", "IT"]);
    const uk = d.maerkte[0];
    expect(uk).toMatchObject({ waehrung: "GBP", monatlich_verkauft: 100 });
    expect(uk.buybox_preis_eur).toBeCloseTo(uk.buybox_preis / 0.85, 1);
    expect(d.maerkte.at(-1)).toMatchObject({ marktplatz: "IT", monatlich_verkauft: null });
    expect(d.nicht_bei_keepa.map((m: { marktplatz: string }) => m.marktplatz)).toEqual(["NL", "BE", "PL", "SE"]);
    expect(d.datenstand.quelle).toContain("Keepa");
    expect(d.link).toContain("/lieferanten/abfrage?q=");
    // Sofort noch einmal: alles aus dem Zwischenspeicher
    const n1 = await keepaAufrufe();
    const d2 = JSON.parse(await c.call("keepa_vergleich", { asin: ASIN }));
    expect(await keepaAufrufe()).toBe(n1);
    expect(d2.datenstand.stand).toContain("alle aus dem Zwischenspeicher");
  });

  test("Rechte: Lager-Konto bekommt die Keepa-Werkzeuge im Fragefeld nicht, direkter Aufruf wird abgewiesen", async ({ browser }) => {
    const m = marke();
    const lp = await alsPerson(browser, "lager");
    const antworten = () => lp.locator('[data-testid="asst-msg-assistant"]').count();
    const n = await antworten();
    await lp.fill('[data-testid="asst-input"]', `werkzeug:keepa_produkt {"asin":"${ASIN}"} ${m}-KP`);
    await lp.keyboard.press("Enter");
    await expect.poll(antworten).toBeGreaterThan(n);
    await expect(lp.locator('[data-testid="asst-status"]')).toHaveCount(0);
    expect((await lp.locator('[data-testid="asst-msg-assistant"]').allTextContents()).at(-1)).toContain("nicht freigegeben");
    expect((await testdienste.kiZu(`${m}-KP`))!.tools).not.toContain("keepa_produkt");
  });
});
