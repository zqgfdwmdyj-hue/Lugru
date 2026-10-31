// Lugru Deals → Seller-System (Weg B: Discord-Kanäle lesen). Abnahmen aus Bauauftrag_LugruDeals-Anbindung:
// History mit Reaktionen, Live-Post → Deal-Eingang mit Ampel (Push nur Grün/Gelb), Reaktion → Statistik aktualisiert,
// deal_quellen zeigt „Lugru Deals“, Deal-Wert mit Begründung je Deal, keine Mitglieder-Namen/IDs gespeichert.
// Discord ist der Nachbau in den Testdiensten; Produkte und ASINs erfunden.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const TD = process.env.TESTDIENSTE_URL || "http://127.0.0.1:4010";
const K1 = "830000000000000001";
const K2 = "830000000000000002";

const post = (titel: string, asin: string, ek: string, vk: string, gewinn: string, marge: string, shop = "testshop.de") =>
  [`🛒 ${titel} @everyone`, `🏬 [${shop}](https://www.${shop}/p/${asin.toLowerCase()})`, `💰 EK: ${ek} € Brutto inkl. Versand`, `💸 VK: ${vk} €  [Amazon.DE](https://www.amazon.de/dp/${asin}?tag=x)`, "ℹ️ Amazon.DE: 50+ Verkäufe", `🤑 Gewinn: ${gewinn} € / ${marge} % Marge`].join("\n");

async function senden(kanal: string, name: string, text: string, alt?: number): Promise<string> {
  const r = await fetch(`${TD}/__discord-va/lugru`, { method: "POST", body: JSON.stringify({ kanal, name, text, alt }) });
  return ((await r.json()) as { id: string }).id;
}
const reagieren = (nachricht: string, emoji: string) => fetch(`${TD}/__discord-va/reaktion`, { method: "POST", body: JSON.stringify({ nachricht, emoji }) });

test.describe("Lugru Deals über Discord", () => {
  test("History, Live-Post mit Ampel, Reaktionen, Statistik, deal_quellen, Deal-Wert, keine Namen", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    await sql("insert into push_abos (tenant_id, user_id, endpoint) values ($1, $2, $3)", [T, INH, `${TD}/push/lg-${m}`]);

    // History im Kanal (älter als 2 Std. → nicht in den Deal-Eingang): drei Deals in K1, einer in K2, eine Unterhaltung.
    const alt10 = await senden(K1, "lugru-deals-test", post(`Testmarke Akkuschrauber ${m}`, "B0TESTLA01", "39,99", "79,90", "18,40", "23"), 10);
    await senden(K1, "lugru-deals-test", "Hat jemand noch Versandkartons übrig?", 15);
    const alt20 = await senden(K1, "lugru-deals-test", post(`Testmarke Kopfhörer ${m}`, "B0TESTLA02", "24,99", "49,90", "9,80", "20"), 20);
    await senden(K1, "lugru-deals-test", post(`Testmarke Mixer ${m}`, "B0TESTLA03", "15,00", "34,90", "8,10", "23"), 40);
    await senden(K2, "lugru-pan-eu", post(`Testmarke Lampe ${m}`, "B0TESTLA04", "12,00", "29,90", "7,00", "23", "zweitshop.de"), 5);
    for (let i = 0; i < 3; i++) await reagieren(alt10, "✅");
    await reagieren(alt10, "🔥");
    await reagieren(alt20, "❌");
    // Frischer Post (live)
    const live = await senden(K1, "lugru-deals-test", post(`Testmarke Haarschneider ${m}`, "B0TESTPP01", "9,99", "29,90", "8,20", "27"));

    // Anbindung: Deal-Kanäle eintragen (Bot = derselbe wie beim VA-Kanal), Verbindung testen
    await anmelden(page, "inhaber");
    await page.goto("/anbindungen?p=lugru_deals#lugru_deals");
    const karte = page.locator("#lugru_deals");
    await karte.locator('textarea[name="kanalIds"]').fill(`${K1}\n${K2}`);
    await Promise.all([aktion(page), karte.getByRole("button", { name: "Speichern", exact: true }).click()]);
    await karte.getByRole("button", { name: /Verbindung testen/ }).click();
    await expect(karte).toContainText(`Testmarke Haarschneider ${m}`, { timeout: 20_000 });

    // Live: „Jetzt abrufen“ (sonst jede Minute) → frischer Post im Deal-Eingang mit Ampel; ältere nur in der Liste
    await page.goto("/deal-eingang/lugru");
    await Promise.all([aktion(page), page.getByTestId("lg-abrufen").click()]);
    await expect(page.getByTestId("lg-meldung")).toContainText("in den Deal-Eingang");
    await expect.poll(async () => (await sql<{ ampel: string | null }>("select ampel from deal_eingaenge where tenant_id = $1 and quelle_ref = $2", [T, `lugru:${live}`]))[0]?.ampel ?? null, { timeout: 60_000 }).not.toBeNull();
    const [e] = await sql<{ id: string; weg: string; quelle: string; ampel: string; push_am: Date | null }>("select id, weg, quelle, ampel, push_am from deal_eingaenge where tenant_id = $1 and quelle_ref = $2", [T, `lugru:${live}`]);
    expect(e).toMatchObject({ weg: "lugru", quelle: "Lugru Deals · #lugru-deals-test" });
    // Push nur bei Grün/Gelb
    if (e.ampel === "rot") expect(e.push_am).toBeNull();
    else expect(e.push_am).not.toBeNull();
    expect((await sql("select 1 from deal_eingaenge where tenant_id = $1 and quelle_ref = $2", [T, `lugru:${alt10}`])).length).toBe(0);
    const [lv] = await sql<{ eingang_id: string; ampel: string | null; kanal: string; reaktionen: Record<string, number> }>("select eingang_id, ampel, kanal, reaktionen from lugru_deals_historie where tenant_id = $1 and discord_nachricht_id = $2", [T, live]);
    expect(lv).toMatchObject({ eingang_id: e.id, ampel: e.ampel, kanal: "lugru-deals-test", reaktionen: {} });

    // Doppelt gepostet (gleiche ASIN + Shop < 24 Std.) → kein zweiter Eingang
    const doppel = await senden(K1, "lugru-deals-test", post(`Testmarke Haarschneider ${m}`, "B0TESTPP01", "9,79", "29,90", "8,40", "28"));
    await Promise.all([aktion(page), page.getByTestId("lg-abrufen").click()]);
    await expect(page.getByTestId("lg-meldung")).toContainText("zusammengefasst");
    const [dp] = await sql<{ eingang_id: string }>("select eingang_id from lugru_deals_historie where tenant_id = $1 and discord_nachricht_id = $2", [T, doppel]);
    expect(dp.eingang_id).toBe(e.id);

    // Reaktion in Discord → Statistik im Seller-System (frische Posts alle 5 Min.; hier „Jetzt abrufen“)
    await reagieren(live, "✅");
    await reagieren(live, "✅");
    await Promise.all([aktion(page), page.getByTestId("lg-abrufen").click()]);
    await expect.poll(async () => (await sql<{ kaeufe: number; reaktionen: Record<string, number> }>("select kaeufe, reaktionen from lugru_deals_historie where tenant_id = $1 and discord_nachricht_id = $2", [T, live]))[0]).toMatchObject({ kaeufe: 2, reaktionen: { "✅": 2 } });

    // History importieren: alle älteren Deals beider Kanäle mit Reaktionen; Unterhaltung übersprungen
    await Promise.all([aktion(page), page.getByTestId("lg-historie").click()]);
    await expect(page.getByTestId("lg-meldung")).toContainText("fertig");
    const hist = await sql<{ asin: string; kaeufe: number; nicht_verfuegbar: number; reaktionen: Record<string, number>; eingang_id: string | null }>("select asin, kaeufe, nicht_verfuegbar, reaktionen, eingang_id from lugru_deals_historie where tenant_id = $1 and asin like 'B0TESTLA0%' order by asin", [T]);
    expect(hist.map((h) => h.asin)).toEqual(["B0TESTLA01", "B0TESTLA02", "B0TESTLA03", "B0TESTLA04"]);
    expect(hist[0]).toMatchObject({ kaeufe: 3, reaktionen: { "✅": 3, "🔥": 1 }, eingang_id: null });
    expect(hist[1]).toMatchObject({ nicht_verfuegbar: 1 });
    await page.reload();
    await expect(page.getByTestId("lg-zeile").filter({ hasText: `Testmarke Akkuschrauber ${m}` })).toContainText("✅ 3");
    await expect(page.getByTestId("lg-stand")).toContainText("History vollständig");
    // Filter: Kanal
    await page.goto(`/deal-eingang/lugru?kanal=lugru-pan-eu`);
    await expect(page.getByTestId("lg-zeile")).toHaveCount(1);

    // Detail: Reaktionen, Deal-Wert mit Begründung, ähnliche frühere Deals, Link zum Eingang
    const [{ id: lid }] = await sql<{ id: string }>("select id from lugru_deals_historie where tenant_id = $1 and discord_nachricht_id = $2", [T, live]);
    await page.goto(`/deal-eingang/lugru/${lid}`);
    await expect(page.getByTestId("lgd-reaktionen")).toContainText("✅ 2");
    await expect(page.getByTestId("lgd-wert")).toContainText("Deal-Wert");
    await expect(page.getByTestId("lgd-eingang")).toHaveAttribute("href", `/deal-eingang/${e.id}`);

    // MCP: lugru_deals (jeder Deal mit Deal-Wert), lugru_deal, lugru_statistik, deal_quellen mit „Lugru Deals“
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    expect(await mcp.tools()).toEqual(expect.arrayContaining(["lugru_deals", "lugru_deal", "lugru_statistik", "deal_quellen"]));
    const liste = JSON.parse(await mcp.call("lugru_deals", { suche: m, limit: 50 })) as { gesamt: number; deals: { id: string; deal_wert: number | null; reaktionen: Record<string, number> }[] };
    expect(liste.gesamt).toBe(6);
    expect(liste.deals.every((d) => typeof d.deal_wert === "number")).toBe(true);
    const det = JSON.parse(await mcp.call("lugru_deal", { id: lid })) as { deal_wert_begruendung: { begruendung: string; dafuer: string[] } | null; aehnliche: unknown[]; gruppen_kaeufe: number };
    expect(det.deal_wert_begruendung?.begruendung).toBeTruthy();
    expect(det.aehnliche.length).toBeGreaterThan(0);
    expect(det.gruppen_kaeufe).toBe(2);
    const st = JSON.parse(await mcp.call("lugru_statistik", {})) as { deals: number; gruppenKaeufe: number; reaktionenSumme: number; kanaele: { kanal: string; anzahl: number }[] };
    expect(st.deals).toBeGreaterThanOrEqual(6);
    expect(st.gruppenKaeufe).toBeGreaterThanOrEqual(5);
    expect(st.kanaele.map((k) => k.kanal)).toEqual(expect.arrayContaining(["lugru-deals-test", "lugru-pan-eu"]));
    const q = JSON.parse(await mcp.call("deal_quellen", {})) as { quellen: { quelle: string; gemeldet: number; gruen: number; gekauft: number; gruppen_kaeufe?: number }[] };
    const lq = q.quellen.find((x) => x.quelle === "Lugru Deals");
    expect(lq).toBeTruthy();
    expect(lq!.gemeldet).toBeGreaterThanOrEqual(6);
    expect(lq!.gruppen_kaeufe).toBeGreaterThanOrEqual(5);
    expect(q.quellen.some((x) => x.quelle === "Lugru Deals · #lugru-deals-test")).toBe(true);

    // Eigener Kauf erkannt: Bestellung mit gleicher ASIN wenige Tage nach dem Posten → „gekauft (automatisch erkannt)“
    const [po] = await sql<{ id: string }>("insert into purchase_orders (tenant_id, number, status, created_at) values ($1, $2, 'ordered', now() - interval '18 days') returning id", [T, `EK-LG-${m}`]);
    await sql("insert into purchase_order_items (tenant_id, po_id, asin, quantity, unit_cost_gross) values ($1, $2, 'B0TESTLA02', 5, 29.74)", [T, po.id]);
    await page.goto("/deal-eingang/lugru");
    await Promise.all([aktion(page), page.getByTestId("lg-historie").click()]);
    await expect(page.getByTestId("lg-meldung")).toContainText("eigene Käufe erkannt");
    expect((await sql<{ gekauft_erkannt: boolean; gekauft_erkannt_ref: string }>("select gekauft_erkannt, gekauft_erkannt_ref from lugru_deals_historie where tenant_id = $1 and asin = 'B0TESTLA02'", [T]))[0]).toMatchObject({ gekauft_erkannt: true, gekauft_erkannt_ref: `Bestellung EK-LG-${m}` });

    // Keine Mitglieder-Namen oder -IDs gespeichert: nur Zahlen je Emoji, kein Absender
    const roh = await sql<{ t: string }>("select row_to_json(l)::text as t from lugru_deals_historie l where tenant_id = $1 and asin like 'B0TEST%'", [T]);
    for (const r of roh) {
      expect(r.t).not.toContain("Lugru Deals (Test)");
      expect(r.t).not.toContain("660000000000000001");
      expect(r.t).not.toContain("700000000000000001");
    }
  });
});
