// B22.2: Eigene Käufe zu Lugru-Deals aus sellerboard-SKUs erkennen (ASIN + Kaufdatum 0–21 Tage nach dem Posten),
// Menge aus der FBA-Sendung, EK netto aus der SKU; Eintrag im Deal-Eingang als „gekauft (automatisch)“ ergänzt;
// Deal-Wert für Lugru mit Vorwissen ≥ 60; Statistik und Monatsbericht zählen die Käufe. Nur erfundene SKUs/ASINs.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const tagCode = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}${MON[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
const plusTage = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

test.describe("B22.2 – Lugru-Lernen: eigene Käufe aus sellerboard-SKUs", () => {
  test("SKU im Fenster → gekauft (automatisch) mit Menge/EK; außerhalb nicht; Deal-Wert ≥ 60; Zahlen in Statistik und Bericht", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke().replace(/[^A-Z0-9]/g, "X");
    const asinA = `B0L${m}A`.padEnd(10, "X").slice(0, 10);
    const asinB = `B0L${m}B`.padEnd(10, "X").slice(0, 10);
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const postA = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 9) - 20 * 86_400_000);
    const postB = plusTage(postA, -20);
    const ins = async (asin: string, am: Date, titel: string) =>
      (await sql<{ id: string }>("insert into lugru_deals_historie (tenant_id, quelle, asin, titel, kanal, gepostet_am, ek_eur, vk_eur, gewinn_eur, marge_prozent, verkaeufe_monat, ek_netto) values ($1, 'app', $2, $3, 'deals', $4, 142.80, 199.00, 45.00, 22.6, 120, false) returning id", [T, asin, titel, am.toISOString()]))[0].id;
    const dA = await ins(asinA, postA, `Testmarke Lugru-Lernen A ${m}`);
    const dB = await ins(asinB, postB, `Testmarke Lugru-Lernen B ${m}`);
    // sellerboard: SKU A 3 Tage nach dem Post (im Fenster), SKU B 25 Tage danach (außerhalb); FBA-Sendung mit 4 Stück für A
    const skuA = `TESTL_${tagCode(plusTage(postA, 3))}_${asinA}_142.80_199.00`;
    const skuB = `TESTL_${tagCode(plusTage(postB, 25))}_${asinB}_142.80_199.00`;
    await sql("insert into sellerboard_products (tenant_id, sb_id, sku, asin, name, synced_at) values ($1, $2, $3, $4, 'Testartikel A', now()), ($1, $5, $6, $7, 'Testartikel B', now())", [T, `b22-a-${m}`, skuA, asinA, `b22-b-${m}`, skuB, asinB]);
    await sql("insert into sellerboard_shipments (tenant_id, sb_id, name, status, created_on, lines, synced_at) values ($1, $2, $3, 'CLOSED', $4::date, $5::jsonb, now())", [T, `b22-s-${m}`, `Testsendung ${m}`, plusTage(postA, 5).toISOString().slice(0, 10), JSON.stringify([{ sku: skuA, fnsku: null, asin: asinA, name: "Testartikel A", units: 4, received: 4 }])]);

    // „Jetzt nachtragen“: Deal-Eingang + eigene Käufe + Deal-Wert in einem Schritt
    await anmelden(page, "inhaber");
    await page.goto("/deal-eingang/lugru");
    await Promise.all([aktion(page), page.getByTestId("lg-nachtragen").click()]);
    await expect(page.getByTestId("lg-meldung")).toContainText("eigene Käufe erkannt");
    await expect(page.getByTestId("lg-gekauft-regel")).toContainText("sellerboard-SKU");

    const zeile = async (id: string) => (await sql<{ erkannt: boolean; ref: string | null; eingang: string | null }>("select gekauft_erkannt as erkannt, gekauft_erkannt_ref as ref, eingang_id as eingang from lugru_deals_historie where id = $1", [id]))[0];
    const a = await zeile(dA);
    expect(a.erkannt).toBe(true);
    expect(a.ref).toBe(`sellerboard-SKU ${skuA}`);
    expect((await zeile(dB)).erkannt).toBe(false);

    // Deal-Eingang A: gekauft mit Menge aus der Sendung, EK netto aus der SKU (142,80 brutto → 120,00 netto), Kaufdatum aus der SKU
    const [e] = await sql<{ status: string; menge: number; preis: string; weg: string; tag: string; wert: number; vorwissen: boolean }>(
      "select status, gekauft_menge as menge, gekauft_preis::text as preis, gekauft_weg as weg, to_char(gekauft_am, 'YYYY-MM-DD') as tag, (zeilen->0->'wert'->>'wert')::int as wert, (zeilen->0->'wert'->'dafuer')::text like '%Vorwissen%' as vorwissen from deal_eingaenge where id = $1",
      [a.eingang],
    );
    expect(e).toMatchObject({ status: "gekauft", menge: 4, weg: "automatisch", tag: plusTage(postA, 3).toISOString().slice(0, 10) });
    expect(Number(e.preis)).toBeCloseTo(120, 2);
    expect(e.wert).toBeGreaterThanOrEqual(60);
    expect(e.vorwissen).toBe(true);
    // Deal B (nicht gekauft) hat trotzdem einen Deal-Wert mit Lugru-Vorwissen
    const [eb] = await sql<{ status: string; wert: number }>("select e.status, (e.zeilen->0->'wert'->>'wert')::int as wert from deal_eingaenge e join lugru_deals_historie l on l.eingang_id = e.id where l.id = $1", [dB]);
    expect(eb.status).toBe("neu");
    expect(eb.wert).toBeGreaterThanOrEqual(60);

    // Detailseite des Eingangs nennt die Herkunft
    await page.goto(`/deal-eingang/${a.eingang}`);
    await expect(page.getByTestId("de-gekauft")).toContainText("automatisch erkannt – sellerboard-SKU");
    await expect(page.getByTestId("de-gekauft")).toContainText("4 Stk");

    // Werkzeuge: Liste/Statistik zählen den eigenen Kauf, Monatsbericht hat den Lugru-Block
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const liste = JSON.parse(await mcp.call("lugru_deals", { suche: m, gekauft: true })) as { deals: { asin: string; gekauft_quelle: string | null }[] };
    expect(liste.deals.map((d) => d.asin)).toEqual([asinA]);
    expect(liste.deals[0].gekauft_quelle).toBe(`automatisch erkannt (sellerboard-SKU ${skuA})`);
    const monat = postA.toISOString().slice(0, 7);
    const bericht = JSON.parse(await mcp.call("deal_lernen_bericht", { monat })) as { lugru_deals: { gekauft: number; mit_deal_wert: number } | null; lugru_history: { selbst_gekauft: number } };
    expect(bericht.lugru_deals?.gekauft).toBeGreaterThanOrEqual(1);
    expect(bericht.lugru_deals?.mit_deal_wert).toBeGreaterThanOrEqual(1);
    expect(bericht.lugru_history.selbst_gekauft).toBeGreaterThanOrEqual(1);
  });
});
