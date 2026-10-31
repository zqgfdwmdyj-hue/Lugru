// Datei-Import über den Claude-Konnektor (Bauauftrag Datei-Import) mit erfundenen Dateien: import_link → PUT →
// import_status; gleiche Datei noch einmal → „bereits importiert“; Abrechnungen + Auszahlungen aus dem
// Transaktionsbericht; importe(); abgelaufene/benutzte/unbekannte Adresse → klare Fehler; Lagergebühren; USt-Bericht
// je Periode + OSS; falsche Art; nur Inhaber.
import { expect, marke, mcpVerbinden, sql, test } from "./helfer";

type Link = { import_id: string; upload_url: string; gueltig_bis: string; max_mb: number; methode: string; content_type: string };
const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const vor = (n: number) => berlin(new Date(Date.now() - n * 86400_000));
const dmyZeit = (iso: string, uhr: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${uhr} UTC`;

const KOPF = ["Datum/Uhrzeit", "Abrechnungsnummer", "Typ", "Bestellnummer", "SKU", "Beschreibung", "Menge", "Marketplace", "Versand", "Umsätze", "Produktumsatzsteuer", "Gutschrift für Versandkosten", "Rabatte aus Werbeaktionen", "Verkaufsgebühren", "Gebühren zu Versand durch Amazon", "Andere Transaktionsgebühren", "Andere", "Gesamt"];
const z = (...x: string[]) => x.map((v) => `"${v}"`).join(",");
function transaktionen(m: string) {
  const a = `77${m}1`;
  const b = `77${m}2`;
  return [
    '"Enthält Amazon Marketplace-Transaktionen (erfunden)"',
    '"Alle Beträge in Euro, sofern nicht anders angegeben"',
    '"Definitionen:"',
    '"Umsatzsteuer für Verkäufe: erfunden"',
    '"Verkaufsgebühren: erfunden"',
    '"Gebühren zu Versand durch Amazon: erfunden"',
    '"Andere Transaktionsgebühren: erfunden"',
    '"Andere: erfunden"',
    "",
    z(...KOPF),
    z(dmyZeit(vor(9), "08:00:00"), a, "Bestellung", `302-${m}-0000001`, "TEST-SOCKEN", "Testsocken (erfunden)", "2", "amazon.de", "Versand durch Amazon", "20,00", "3,80", "0", "0", "-3,00", "-4,50", "0", "0", "16,30"),
    z(dmyZeit(vor(8), "09:00:00"), a, "Erstattung", `302-${m}-0000001`, "TEST-SOCKEN", "Testsocken (erfunden)", "1", "Amazon.de", "Versand durch Amazon", "-10,00", "-1,90", "0", "0", "1,20", "0", "0", "0", "-10,70"),
    z(dmyZeit(vor(7), "10:00:00"), a, "Servicegebühr", "", "", "Abonnementgebühr (erfunden)", "", "", "", "0", "0", "0", "0", "0", "0", "-39,00", "0", "-39,00"),
    z(dmyZeit(vor(6), "11:00:00"), a, "Übertrag", "", "", "An Bankkonto (erfunden)", "", "", "", "0", "0", "0", "0", "0", "0", "0", "-123,45", "-123,45"),
    z(dmyZeit(vor(3), "08:00:00"), b, "Bestellung", `302-${m}-0000002`, "TEST-SOCKEN", "Testsocken (erfunden)", "1", "amazon.de", "Versand durch Amazon", "12,00", "2,28", "0", "0", "-1,80", "-3,10", "0", "0", "9,38"),
  ].join("\n");
}

const LAGER_KOPF = "asin,fnsku,product_name,fulfillment_center,country_code,longest_side,median_side,shortest_side,measurement_units,weight,weight_units,item_volume,volume_units,product_size_tier,average_quantity_on_hand,average_quantity_pending_removal,estimated_total_item_volume,month_of_charge,storage_utilization_ratio,storage_utilization_ratio_units,base_rate,utilization_surcharge_rate,avg_qty_for_sus,est_vol_for_sus,est_base_msf,est_sus,currency,estimated_monthly_storage_fee,category,eligible_for_inventory_discount,qualifies_for_inventory_discount,total_incentive_fee_amount,breakdown_incentive_fee_amount,average_quantity_customer_orders";
const lager = (asin: string, land: string, fee: string) => `${asin},X00TEST,Testartikel (erfunden),TST1,${land},10,5,2,centimeters,0.2,kilograms,0.0001,cubic meters,Standard,4,0,0.0004,2026-05,1.2,weeks,27.54,0,0,0,0.01,0,EUR,${fee},Testkategorie,N,N,0,,0`;

const UST_KOPF = ["UNIQUE_ACCOUNT_IDENTIFIER", "ACTIVITY_PERIOD", "SALES_CHANNEL", "MARKETPLACE", "PROGRAM_TYPE", "TRANSACTION_TYPE", "TRANSACTION_EVENT_ID", "TRANSACTION_COMPLETE_DATE", "SELLER_SKU", "ASIN", "QTY", "DEPARTURE_COUNTRY", "ARRIVAL_COUNTRY", "TAXABLE_JURISDICTION", "TAX_REPORTING_SCHEME", "TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL", "TOTAL_ACTIVITY_VALUE_VAT_AMT", "TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL", "PRICE_OF_ITEMS_VAT_RATE_PERCENT", "TRANSACTION_CURRENCY_CODE"];
const ust = (p: string, typ: string, d: string, von: string, nach: string, land: string, s: string, n: string, u: string, b: string, satz: string, q = "1") => ["A1", p, "AFN", "amazon.de", "REGULAR", typ, "302-0000000-0000009", d, "TEST-SOCKEN", "B0TEST0001", q, von, nach, land, s, n, u, b, satz, "EUR"].join("\t");

test.describe("Datei-Import über den Konnektor", () => {
  test("Abnahme 1–6: Transaktionsbericht, doppelt, Abrechnungen/Auszahlungen, importe(), Fehler der Adresse", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const tools = await mcp.tools();
    expect(tools).toEqual(expect.arrayContaining(["import_link", "import_status", "importe", "umsatzsteuer", "umsatzsteuer_oss", "lagergebuehren"]));
    const link = async (art: string, dateiname: string, hinweis?: string) => JSON.parse(await mcp.call("import_link", { art, dateiname, hinweis })) as Link;
    const status = async (id: string) => JSON.parse(await mcp.call("import_status", { import_id: id })) as { status: string; ergebnis?: Record<string, unknown>; fehler_text?: string; bereits_importiert?: boolean };
    const fertig = async (id: string) => {
      await expect.poll(async () => (await status(id)).status, { timeout: 60_000 }).toMatch(/fertig|fehler/);
      return status(id);
    };
    const csv = transaktionen(m);

    // 1. import_link → PUT → fertig mit Zeilen, Abrechnungen, Zeitraum, Marktplatz
    const l1 = await link("amazon_transaktionen", "2026Jan1-2026Oct30CustomTransaction.csv", "Marktplatz DE");
    expect(l1).toMatchObject({ methode: "PUT", max_mb: 50 });
    expect(l1.upload_url).toMatch(/\/api\/import\/upload\/[A-Za-z0-9_-]{40,}$/);
    const put = await fetch(l1.upload_url, { method: "PUT", body: csv, headers: { "Content-Type": l1.content_type } });
    expect(put.status).toBe(202);
    const s1 = await fertig(l1.import_id);
    expect(s1.status, s1.fehler_text).toBe("fertig");
    const e1 = s1.ergebnis as { zeilen: number; abrechnungen: number; zeitraum: { von: string; bis: string }; marktplaetze: string[]; auszahlungen: { betrag: number }[]; aenderungen: { transaktionen_neu: number; abrechnungen_neu: number } };
    expect(e1).toMatchObject({ zeilen: 5, abrechnungen: 2, zeitraum: { von: vor(9), bis: vor(3) }, marktplaetze: ["amazon.de"] });
    expect(e1.auszahlungen).toEqual([expect.objectContaining({ betrag: 123.45, abrechnung: `77${m}1` })]);
    expect(e1.aenderungen.transaktionen_neu).toBe(5);
    expect(e1.aenderungen.abrechnungen_neu).toBe(2);

    // 3./4. Abrechnungen für Gewinn-Seite (abgeleitete Zeilen) und Auszahlung (Übertrag) für die Liquidität
    const zeilenVorher = await sql<{ n: number }>("select count(*)::int as n from amazon_settlement_lines where settlement_id in ($1, $2) and quelle = 'transaktionen'", [`77${m}1`, `77${m}2`]);
    expect(zeilenVorher[0].n).toBeGreaterThan(5);
    const [abr] = await sql<{ total_amount: string; deposit_date: Date | null }>("select total_amount, deposit_date from amazon_settlements where settlement_id = $1", [`77${m}1`]);
    expect(Number(abr.total_amount)).toBe(123.45);
    expect(abr.deposit_date).not.toBeNull();
    const summe = await sql<{ s: string }>("select sum(amount)::text as s from amazon_settlement_lines where settlement_id = $1", [`77${m}1`]);
    expect(Number(summe[0].s)).toBeCloseTo(16.3 - 10.7 - 39, 2); // Übertrag ist keine Zeile, nie Umsatz

    // 2. Gleiche Datei noch einmal → „bereits importiert“, keine Doppelbuchung
    const txVorher = (await sql<{ n: number }>("select count(*)::int as n from amazon_transactions where settlement_id in ($1, $2)", [`77${m}1`, `77${m}2`]))[0].n;
    const l2 = await link("amazon_transaktionen", "nochmal.csv");
    const put2 = await fetch(l2.upload_url, { method: "PUT", body: csv });
    expect(put2.status).toBe(200);
    expect(await put2.json()).toMatchObject({ bereits_importiert: true });
    const s2 = await status(l2.import_id);
    expect(s2).toMatchObject({ status: "fertig", bereits_importiert: true });
    expect((await sql<{ n: number }>("select count(*)::int as n from amazon_transactions where settlement_id in ($1, $2)", [`77${m}1`, `77${m}2`]))[0].n).toBe(txVorher);
    expect((await sql<{ n: number }>("select count(*)::int as n from amazon_settlement_lines where settlement_id in ($1, $2) and quelle = 'transaktionen'", [`77${m}1`, `77${m}2`]))[0].n).toBe(zeilenVorher[0].n);

    // 5. importe() listet den Import mit Ergebnis
    const liste = JSON.parse(await mcp.call("importe", { limit: 10 })) as { importe: { import_id: string; status: string; kurz: string | null }[] };
    expect(liste.importe.find((x) => x.import_id === l1.import_id)).toMatchObject({ status: "fertig" });
    expect(liste.importe.find((x) => x.import_id === l1.import_id)!.kurz).toContain("5 neu");

    // 6. Abgelaufene, benutzte und unbekannte Adresse → klare Fehler, kein 500er; kein Download
    const l3 = await link("amazon_transaktionen", "spaet.csv");
    await sql("update datei_importe set gueltig_bis = now() - interval '1 minute' where id = $1", [l3.import_id]);
    const abgelaufen = await fetch(l3.upload_url, { method: "PUT", body: "x" });
    expect(abgelaufen.status).toBe(410);
    expect((await abgelaufen.json()).fehler).toContain("abgelaufen");
    const benutzt = await fetch(l1.upload_url, { method: "PUT", body: "x" });
    expect(benutzt.status).toBe(410);
    expect((await benutzt.json()).fehler).toContain("schon benutzt");
    expect((await fetch(l1.upload_url.replace(/[^/]+$/, "unbekannt-unbekannt-unbekannt-unbekannt-00"), { method: "PUT", body: "x" })).status).toBe(404);
    expect((await fetch(l1.upload_url)).status).toBe(405);
  });

  test("Lagergebühren, falsche Art, USt-Bericht je Periode + OSS, nur Inhaber", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const link = async (art: string, dateiname: string, hinweis?: string) => JSON.parse(await mcp.call("import_link", { art, dateiname, hinweis })) as Link;
    const fertig = async (id: string) => {
      await expect.poll(async () => JSON.parse(await mcp.call("import_status", { import_id: id })).status, { timeout: 60_000 }).toMatch(/fertig|fehler/);
      return JSON.parse(await mcp.call("import_status", { import_id: id })) as { status: string; ergebnis?: Record<string, unknown>; fehler_text?: string };
    };
    const lagerCsv = [LAGER_KOPF, lager("B0TEST0001", "DE", "1.25"), lager("B0TEST0001", "FR", "0.50"), lager("B0TEST0002", "DE", "0.10")].join("\n");

    // Lagergebühren (Monthly Storage Fees)
    const l1 = await link("amazon_lagergebuehren", "1689635020757.csv");
    expect((await fetch(l1.upload_url, { method: "PUT", body: lagerCsv })).status).toBe(202);
    const s1 = await fertig(l1.import_id);
    expect(s1.status, s1.fehler_text).toBe("fertig");
    expect(s1.ergebnis).toMatchObject({ monate: [{ monat: "2026-05", gebuehr: 1.85 }] });
    const lg = JSON.parse(await mcp.call("lagergebuehren", { monat: "2026-05" })) as { asins: { asin: string; gebuehr: number }[] };
    expect(lg.asins[0]).toMatchObject({ asin: "B0TEST0001", gebuehr: 1.75 });

    // Falsche Art: Lagergebühren-Datei als Transaktionsbericht angekündigt
    const l2 = await link("amazon_transaktionen", "falsch.csv");
    await fetch(l2.upload_url, { method: "PUT", body: lagerCsv + "\n" + lager("B0TEST0003", "IT", "0.2") });
    const s2 = await fertig(l2.import_id);
    expect(s2.status).toBe("fehler");
    expect(s2.fehler_text).toContain("Falsche Art");

    // Umsatzsteuer-Transaktionsbericht (Tabulator, Dateiname nur eine Nummer) – Zeilen gehören zur Periode der Zeile
    const txt = [
      UST_KOPF.join("\t"),
      ust("2026-JUL", "SALE", "03-07-2026", "DE", "DE", "DE", "REGULAR", "100.00", "19.00", "119.00", "0.19"),
      ust("2026-JUL", "SALE", "04-07-2026", "DE", "AT", "AT", "UNION-OSS", "50.00", "10.00", "60.00", "0.20"),
      ust("2026-JUL", "FC_TRANSFER", "06-07-2026", "DE", "PL", "", "", "0", "0", "0", "", "5"),
      ust("2026-JUL", "INVOICE", "07-07-2026", "DE", "DE", "", "", "200.00", "38.00", "238.00", ""),
      ust("2026-JUN", "SALE", "30-06-2026", "DE", "FR", "FR", "UNION-OSS", "20.00", "4.00", "24.00", "0.20"),
    ].join("\n");
    const l3 = await link("amazon_umsatzsteuer_transaktionen", "1515387020668.txt");
    expect((await fetch(l3.upload_url, { method: "PUT", body: txt })).status).toBe(202);
    const s3 = await fertig(l3.import_id);
    expect(s3.status, s3.fehler_text).toBe("fertig");
    const perioden = (s3.ergebnis as { perioden: { periode: string }[] }).perioden.map((p) => p.periode).sort();
    expect(perioden).toEqual(["2026-06", "2026-07"]);
    const jul = JSON.parse(await mcp.call("umsatzsteuer", { periode: "2026-07" })) as { umsatz_je_steuerland: { land: string; brutto: number }[]; verbringungen: { von: string; nach: string; stueck: number }[]; invoice_credit_note_ohne_steuerland: { vorgang: string; brutto: number }[] };
    expect(jul.umsatz_je_steuerland.find((l) => l.land === "DE")!.brutto).toBe(119);
    expect(jul.verbringungen).toEqual([expect.objectContaining({ von: "DE", nach: "PL", stueck: 5 })]);
    expect(jul.invoice_credit_note_ohne_steuerland[0]).toMatchObject({ vorgang: "INVOICE", brutto: 238 });
    const oss = JSON.parse(await mcp.call("umsatzsteuer_oss", { quartal: "2026-Q3" })) as { zeilen: { land: string; netto: number }[] };
    expect(oss.zeilen).toEqual([expect.objectContaining({ land: "AT", netto: 50 })]);

    // Nur Inhaber: Büro-Konto (mit Buchhaltung) bekommt das Upload-Werkzeug nicht
    const buero = await mcpVerbinden(browser, baseURL!, "buero", { write: true });
    const bt = await buero.tools();
    expect(bt).not.toContain("import_link");
    expect(bt).not.toContain("importe");
  });
});
