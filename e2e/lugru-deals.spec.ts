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
    const q = JSON.parse(await mcp.call("deal_quellen", {})) as { quellen: { quelle: string; gemeldet: number; gepostet?: number; gruen: number; gekauft: number; gruppen_kaeufe?: number }[] };
    const lq = q.quellen.find((x) => x.quelle === "Lugru Deals");
    expect(lq).toBeTruthy();
    // B20.2: gemeldet = Zählbasis (im Deal-Eingang mit Ampel), gepostet = alle Posts; eine Zeile für die ganze Gruppe
    expect(lq!.gepostet).toBeGreaterThanOrEqual(6);
    expect(lq!.gemeldet).toBeGreaterThanOrEqual(1);
    expect(lq!.gemeldet).toBeLessThanOrEqual(lq!.gepostet!);
    expect(lq!.gruppen_kaeufe).toBeGreaterThanOrEqual(5);
    expect(q.quellen.some((x) => x.quelle.startsWith("Lugru Deals · "))).toBe(false);

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

  test("Direkt von der Lugru-Deals-Seite: frischer Deal sofort im Deal-Eingang mit Ampel, keine Doppelung", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await anmelden(page, "inhaber");
    const SCHL = `test-direkt-${m}-0123456789abcdefghij`;
    await page.goto("/anbindungen?p=lugru_deals#lugru_deals");
    const karte = page.locator("#lugru_deals");
    await karte.locator('input[name="schluessel"]').fill(SCHL);
    await Promise.all([aktion(page), karte.getByRole("button", { name: "Speichern", exact: true }).click()]);
    const id = Number(Date.now() % 1_000_000_000) + 7;
    const nachricht = `84${String(Date.now()).padStart(16, "0")}`;
    const deal = { id, asin: "B0TESTDI01", titel: `Testmarke Direktdeal (${m})`, quellmarkt: "DE", zielmarkt: "DE", ek_eur: 4.2, vk_eur: 24.9, gewinn_eur: 8.1, marge_prozent: 32.5, verkaeufe_monat: 300, kanal: "lugru-direkt", status: "aktiv", kaeufe: 0, nicht_verfuegbar: 0, gepostet_am: new Date(Date.now() - 60_000).toISOString(), discord_kanal_id: "830000000000000077", discord_nachricht_id: nachricht, shop: "testshop.example", einkaufslink: "https://www.testshop.example/p/1", ek_art: "netto", max_menge: 5 };
    const senden = (deals: unknown[]) => fetch(`${baseURL}/api/public/lugru-deals/deals`, { method: "POST", headers: { Authorization: `Bearer ${SCHL}`, "Content-Type": "application/json" }, body: JSON.stringify({ deals }) });
    const r1 = await (await senden([deal])).json();
    expect(r1).toMatchObject({ ok: true, neu: 1, eingaenge: 1 });
    const [e] = await sql<{ id: string; weg: string; quelle: string; quelle_ref: string; pruefung: string }>("select id, weg, quelle, quelle_ref, pruefung from deal_eingaenge where tenant_id = $1 and quelle_ref = $2", [T, `lugru:${nachricht}`]);
    expect(e).toMatchObject({ weg: "lugru", quelle: "Lugru Deals · #lugru-direkt" });
    const [z] = await sql<{ eingang_id: string; ampel: string | null; shop: string; shop_url: string; ek_netto: boolean; max_menge: number; quelle: string }>("select eingang_id, ampel, shop, shop_url, ek_netto, max_menge, quelle from lugru_deals_historie where tenant_id = $1 and extern_id = $2", [T, id]);
    expect(z).toMatchObject({ eingang_id: e.id, shop: "testshop.example", shop_url: "https://www.testshop.example/p/1", ek_netto: true, max_menge: 5, quelle: "app" });
    expect(["gruen", "gelb", "rot"]).toContain(z.ampel);
    // Zweites Senden (stündlicher Abgleich, neue Reaktionen): aktualisiert, kein zweiter Eingang
    const r2 = await (await senden([{ ...deal, kaeufe: 2 }])).json();
    expect(r2).toMatchObject({ ok: true, neu: 0, aktualisiert: 1, eingaenge: 0 });
    expect((await sql<{ n: string }>("select count(*) n from deal_eingaenge where tenant_id = $1 and quelle_ref = $2", [T, `lugru:${nachricht}`]))[0].n).toBe("1");
    // Alter Deal (History) geht nicht in den Deal-Eingang
    const r3 = await (await senden([{ ...deal, id: id + 1, asin: "B0TESTDI02", discord_nachricht_id: undefined, gepostet_am: new Date(Date.now() - 5 * 86_400_000).toISOString() }])).json();
    expect(r3).toMatchObject({ ok: true, neu: 1, eingaenge: 0 });
    await page.goto(`/deal-eingang/${e.id}`);
    await expect(page.locator("body")).toContainText("direkt von der Lugru-Deals-Seite");
  });

  // B19.1: alte Deals (Weg A) bekommen Ampel + Eingang „Historie“ (ohne Push), Kanäle getrimmt, Testkanäle ausgeblendet,
  // Reaktionen ✅/❌ statt {}, Gesamtzahl neben dem Zeitraum, Weg A klar angezeigt, Deal-Wert-Schwelle je Quelle.
  test("History in den Deal-Eingang: Ampel, Historie ohne Push, Testkanal draußen, Reaktionen ehrlich, Weg A", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await anmelden(page, "inhaber");
    const SCHL = `test-historie-${m}-0123456789abcdefghij`;
    await page.goto("/anbindungen?p=lugru_deals#lugru_deals");
    const karte = page.locator("#lugru_deals");
    await karte.locator('input[name="schluessel"]').fill(SCHL);
    await Promise.all([aktion(page), karte.getByRole("button", { name: "Speichern", exact: true }).click()]);
    const basis = Number(Date.now() % 1_000_000_000) + 1000;
    const vor = (tage: number) => new Date(Date.now() - tage * 86_400_000).toISOString();
    const gemein = { quellmarkt: "DE", zielmarkt: "DE", verkaeufe_monat: 200, status: "aktiv", ek_art: "netto", shop: "testshop.example" };
    const deals = [
      { ...gemein, id: basis, asin: "B0TESTHI01", titel: `Testmarke Historie gut ${m}`, ek_eur: 6, vk_eur: 29.9, gewinn_eur: 11.5, marge_prozent: 46, kanal: "B low Marge ", kaeufe: 2, nicht_verfuegbar: 1, gepostet_am: vor(5) },
      { ...gemein, id: basis + 1, asin: "B0TESTHI02", titel: `Testmarke Historie duenn ${m}`, ek_eur: 20, vk_eur: 25, gewinn_eur: 0.8, marge_prozent: 4, kanal: "B low Marge ", kaeufe: 0, nicht_verfuegbar: 0, gepostet_am: vor(6) },
      { ...gemein, id: basis + 2, asin: "B0TESTHI03", titel: `Testmarke Historie Testkanal ${m}`, ek_eur: 6, vk_eur: 29.9, gewinn_eur: 11.5, marge_prozent: 46, kanal: "test1", kaeufe: 0, nicht_verfuegbar: 0, gepostet_am: vor(7) },
    ];
    const r = await (await fetch(`${baseURL}/api/public/lugru-deals/deals`, { method: "POST", headers: { Authorization: `Bearer ${SCHL}`, "Content-Type": "application/json" }, body: JSON.stringify({ deals }) })).json();
    expect(r).toMatchObject({ ok: true, neu: 3, eingaenge: 0 });
    // Kanalname ohne Leerzeichen am Ende
    expect((await sql<{ kanal: string }>("select kanal from lugru_deals_historie where tenant_id = $1 and extern_id = $2", [T, basis]))[0].kanal).toBe("B low Marge");

    // Lugru-Seite: Weg A klar, kein „Noch nicht eingerichtet“, Gesamtzahl neben dem Zeitraum, Testkanal ausgeblendet
    await page.goto("/deal-eingang/lugru");
    await expect(page.getByTestId("lg-weg-a")).toContainText("Weg A aktiv");
    await expect(page.getByTestId("lg-einrichten")).toHaveCount(0);
    await expect(page.getByTestId("lg-gesamt")).toContainText("insgesamt");
    await expect(page.getByTestId("lg-kachel-deals")).toContainText("Deals im Zeitraum");
    const optionen = await page.locator('select[name="kanal"] option').allTextContents();
    expect(optionen).toContain("#B low Marge");
    expect(optionen).not.toContain("#test1");
    await page.goto("/deal-eingang/lugru?test=1");
    expect(await page.locator('select[name="kanal"] option').allTextContents()).toContain("#test1");

    // Nachtragen (sonst alle 5 Min. im Hintergrund): Eingang „Historie“ mit Ampel, ohne Push, Datum = Posten
    await page.goto("/deal-eingang/lugru");
    await Promise.all([aktion(page), page.getByTestId("lg-nachtragen").click()]);
    await expect(page.getByTestId("lg-meldung")).toContainText("in den Deal-Eingang nachgetragen");
    const eing = async (id: number) => (await sql<{ id: string; historisch: boolean; pruefung: string; push_am: Date | null; ampel: string; quelle: string; tage: number }>("select id, historisch, pruefung, push_am, ampel, quelle, round(extract(epoch from now() - created_at) / 86400)::int as tage from deal_eingaenge where tenant_id = $1 and quelle_ref = $2", [T, `lugru-app:${id}`]))[0];
    const gut = await eing(basis);
    expect(gut).toMatchObject({ historisch: true, pruefung: "fertig", push_am: null, quelle: "Lugru Deals · #B low Marge", tage: 5 });
    expect(gut.ampel).toBe("gelb"); // ohne Keepa-Stand höchstens gelb
    expect((await eing(basis + 1)).ampel).toBe("rot"); // 4 % Marge
    expect(await eing(basis + 2)).toBeUndefined(); // Testkanal
    const [lh] = await sql<{ eingang_id: string; ampel: string }>("select eingang_id, ampel from lugru_deals_historie where tenant_id = $1 and extern_id = $2", [T, basis]);
    expect(lh).toEqual({ eingang_id: gut.id, ampel: "gelb" });

    // Deal-Eingang: Historie nicht im normalen Posteingang, aber mit Filter „Lugru Deals“ (mit Kennzeichnung)
    await page.goto("/deal-eingang");
    await expect(page.getByTestId("de-liste")).not.toContainText(`Historie gut ${m}`);
    await page.goto(`/deal-eingang?quelle=${encodeURIComponent("Lugru Deals")}`);
    const zeile = page.getByTestId("de-eintrag").filter({ hasText: `Historie gut ${m}` });
    await expect(zeile).toHaveCount(1);
    await expect(zeile.getByTestId("de-historie")).toBeVisible();
    await expect(page.getByTestId("de-quellen").getByTestId("de-quelle-link").filter({ hasText: /^Lugru Deals$/ })).toHaveAttribute("href", /quelle=Lugru%20Deals/);

    // Werkzeuge: Reaktionen ✅/❌ statt {}, Gesamtzahl und Zeitraum, Testkanal nur auf Wunsch, Eingänge mit historisch
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const liste = JSON.parse(await mcp.call("lugru_deals", { suche: m, limit: 50 })) as { gesamt: number; deals: { asin: string; reaktionen: Record<string, number>; reaktionen_hinweis?: string; ampel: string; eingang_id: string | null }[]; import: { weg: string } };
    expect(liste.gesamt).toBe(2);
    const lg = liste.deals.find((d) => d.asin === "B0TESTHI01")!;
    expect(lg.reaktionen).toEqual({ "✅": 2, "❌": 1 });
    expect(lg.reaktionen_hinweis).toMatch(/nur ✅/);
    expect(lg).toMatchObject({ ampel: "gelb", eingang_id: gut.id });
    expect(liste.import.weg).toMatch(/^A/);
    expect((JSON.parse(await mcp.call("lugru_deals", { suche: m, mit_test: true })) as { gesamt: number }).gesamt).toBe(3);
    const st = JSON.parse(await mcp.call("lugru_statistik", {})) as { zeitraum: { von: string; bis: string }; gesamt: { deals: number }; emojis: { emoji: string }[] };
    expect(st.zeitraum.von).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(st.gesamt.deals).toBeGreaterThanOrEqual(2);
    expect(st.emojis.map((e) => e.emoji)).toContain("✅");
    const de = JSON.parse(await mcp.call("deal_eingang", { quelle: "Lugru Deals", limit: 100 })) as { eingaenge: { id: string; historisch?: boolean }[] };
    expect(de.eingaenge.find((x) => x.id === gut.id)?.historisch).toBe(true);
    const normal = JSON.parse(await mcp.call("deal_eingang", { limit: 100 })) as { eingaenge: { id: string }[] };
    expect(normal.eingaenge.some((x) => x.id === gut.id)).toBe(false);

    // Deal-Wert-Schwelle je Quelle (Ludwig entscheidet; hier nur Speichern und Zurücksetzen geprüft)
    await page.goto("/deal-eingang");
    const form = page.getByTestId("de-einstellungen-form");
    await form.getByTestId("de-schwelle-je").fill("Lugru Deals=60");
    await Promise.all([aktion(page), form.getByRole("button", { name: "Speichern" }).click()]);
    await expect.poll(async () => (await sql<{ s: unknown }>("select settings -> 'dealEingang' -> 'wertSchwelleJe' as s from tenants where id = $1", [T]))[0].s).toEqual({ "Lugru Deals": 60 });
    await page.goto("/deal-eingang");
    await page.getByTestId("de-einstellungen-form").getByTestId("de-schwelle-je").fill("");
    await Promise.all([aktion(page), page.getByTestId("de-einstellungen-form").getByRole("button", { name: "Speichern" }).click()]);
    await expect.poll(async () => (await sql<{ s: unknown }>("select settings -> 'dealEingang' -> 'wertSchwelleJe' as s from tenants where id = $1", [T]))[0].s).toEqual({});
  });
});
