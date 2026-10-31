// Deal-Eingang Abschnitt 10 („Kaufen mit einem Tap“) und 11 („Lernender Deal-Wert“) gegen die Testdienste – erfundene
// ASINs, Händler und Gruppen-Deals. Abnahmen: Lugru-Deals-History inkl. Reaktionen rückwirkend; neuer Deal zeigt den
// Deal-Wert mit Begründung und ähnlichen früheren Deals; Budget-Grenze → höchstens Gelb; Push mit „Zum Angebot“/„Gekauft“;
// „gekauft“-Knopf → Bestellung bestellt + Wareneingang erwartet; Bestellbestätigungs-Mail → gekauft; 👍/👎 aus Push
// und Discord gespeichert; nach Wareneingang + 30 Tagen reales Ergebnis; Claude-Werkzeuge.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

type Wert = { wert: number; begruendung: string; dafuer: string[]; dagegen: string[]; aehnliche: { quelle: string; titel: string | null }[]; gedeckelt: boolean };
type Zeile = { nr: number; asin: string | null; ampel: string; gruende: string[]; kapitalbedarf: number | null; wert?: Wert | null; merkmale?: Record<string, unknown> | null };
const fertig = (id: string) => expect.poll(async () => (await sql<{ p: string }>("select pruefung p from deal_eingaenge where id = $1", [id]))[0]?.p, { timeout: 60_000 }).toMatch(/fertig|fehler/);
const zeilen = async (id: string) => (await sql<{ zeilen: Zeile[] }>("select zeilen from deal_eingaenge where id = $1", [id]))[0].zeilen;
const eingang = async (id: string) => (await sql<{ status: string; gekauft_menge: number | null; gekauft_preis: string | null; gekauft_weg: string | null; bestellung_id: string | null; daumen: string | null; daumen_grund: string | null; daumen_weg: string | null; ergebnis: { tage: number; verkauft: number; realerRoi: number | null } | null; discord_ref: string | null }>("select status, gekauft_menge, gekauft_preis, gekauft_weg, bestellung_id, daumen, daumen_grund, daumen_weg, ergebnis, discord_ref from deal_eingaenge where id = $1", [id]))[0];

test.describe("Deal-Eingang: Kaufen mit einem Tap + lernender Deal-Wert", () => {
  test("History-Import, Deal-Wert, Budget, Push, gekauft (Knopf/Mail), 👍/👎, Ergebnis, Claude", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    await sql("insert into push_abos (tenant_id, user_id, endpoint) values ($1, $2, $3)", [T, INH, `${TD}/push/dw-${m}`]);
    await anmelden(page, "inhaber");

    // 1) Lugru-Deals-History rückwirkend inkl. Reaktionen (nur Anzahlen). Verbindungsschlüssel wie in der Anleitung.
    const SCHL = `test-verbindung-${m}-0123456789abcdefghij`;
    await page.goto("/anbindungen?p=lugru_deals#lugru_deals");
    const karte = page.locator("#lugru_deals");
    await karte.locator('input[name="schluessel"]').fill(SCHL);
    await Promise.all([aktion(page), karte.getByRole("button", { name: "Speichern", exact: true }).click()]);
    const ohne = await fetch(`${baseURL}/api/public/lugru-deals/deals`, { method: "POST", body: "{}" });
    expect(ohne.status).toBe(401);
    expect(await ohne.json()).toMatchObject({ ok: false });
    const basisId = Number(Date.now() % 1_000_000_000);
    const tag = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const lugru = [
      { id: basisId + 1, asin: "B0TESTLG01", titel: `Testmarke Gruppenartikel A (${m})`, quellmarkt: "DE", zielmarkt: "DE", ek_eur: 2.5, vk_eur: 12.9, gewinn_eur: 3.2, marge_prozent: 25, verkaeufe_monat: 150, gruppe: "Testgruppe", kanal: "deals", status: "aktiv", kaeufe: 4, nicht_verfuegbar: 1, reaktionen_am: tag(39), gepostet_am: tag(40) },
      { id: basisId + 2, asin: "B0TESTLG02", titel: `Testmarke Gruppenartikel B (${m})`, ek_eur: 9.9, vk_eur: 19.9, gewinn_eur: 1.1, marge_prozent: 6, verkaeufe_monat: 20, kaeufe: 0, nicht_verfuegbar: 3, gepostet_am: tag(30) },
      { id: basisId + 3, asin: "kaputt", gepostet_am: "kein Datum" },
    ];
    const senden = (deals: unknown[]) => fetch(`${baseURL}/api/public/lugru-deals/deals`, { method: "POST", headers: { Authorization: `Bearer ${SCHL}`, "Content-Type": "application/json" }, body: JSON.stringify({ deals }) });
    const imp = await senden(lugru);
    expect(imp.status).toBe(200);
    expect(await imp.json()).toEqual({ ok: true, neu: 2, aktualisiert: 0, ungueltig: 1, eingaenge: 0 });
    lugru[0].kaeufe = 6;
    expect(await (await senden(lugru.slice(0, 2))).json()).toEqual({ ok: true, neu: 0, aktualisiert: 2, ungueltig: 0, eingaenge: 0 });
    const hist = await sql<{ asin: string; kaeufe: number; nicht_verfuegbar: number }>("select asin, kaeufe, nicht_verfuegbar from lugru_deals_historie where tenant_id = $1 and extern_id in ($2, $3) order by extern_id", [T, basisId + 1, basisId + 2]);
    expect(hist).toEqual([{ asin: "B0TESTLG01", kaeufe: 6, nicht_verfuegbar: 1 }, { asin: "B0TESTLG02", kaeufe: 0, nicht_verfuegbar: 3 }]);

    // 2) Budget-Grenzen und Schwelle (nur Inhaber): je Deal 10 € → was sonst Grün wäre, wird höchstens Gelb.
    await page.goto("/deal-eingang");
    const ein = page.getByTestId("de-einstellungen-form");
    await ein.locator('input[name="budgetJeDeal"]').fill("10");
    await ein.locator('input[name="budgetJeWoche"]').fill("5000");
    await ein.locator('input[name="wertSchwelle"]').fill("1");
    await Promise.all([aktion(page), ein.getByRole("button", { name: "Speichern" }).click()]);
    await expect(page.getByRole("status")).toContainText("Einstellungen gespeichert");
    await expect(page.getByTestId("de-einstellungen")).toContainText("5.000");

    // 3) Neuer Deal (geteilt) → Deal-Wert mit Begründung und ähnlichen früheren Deals (hier: Lugru-Gruppe); Push mit Kauf-Knöpfen.
    const r = await page.request.post("/api/deal-eingang", { multipart: { text: `B0TESTDE01 Testsocken 2,10 netto ab 20 Stk https://shop.example.test/socken-${m}`, quelle: `Testhändler ${m}` }, maxRedirects: 0 });
    expect(r.status()).toBe(303);
    const idA = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r.headers().location ?? "")![1];
    await fertig(idA);
    const [zA] = await zeilen(idA);
    expect(zA.asin).toBe("B0TESTDE01");
    expect(zA.merkmale).toBeTruthy();
    expect(zA.wert?.begruendung).toMatch(/^Passt zu dir \(\d+\/100\)/);
    expect(zA.wert?.aehnliche.some((a) => a.quelle === "lugru")).toBe(true);
    expect(zA.wert?.dafuer.join(" ")).toContain("Lugru-Gruppe: 6 Käufe");
    // Budget: über 10 € je Deal (20 × 2,10 €) → nicht Grün, Budget-Hinweis als erster Grund
    if (zA.ampel !== "rot") {
      expect(zA.ampel).toBe("gelb");
      expect(zA.gruende[0]).toMatch(/^Budget: [\d.]+ € über der Grenze je Deal \(10 €\)/);
    }
    await page.goto(`/deal-eingang/${idA}`);
    await expect(page.getByTestId("de-wert").first()).toContainText("Passt zu dir");
    await expect(page.getByTestId("de-aehnliche").first()).toContainText("Lugru-Gruppe");
    await expect(page.getByTestId("de-angebot-link")).toHaveAttribute("href", `https://shop.example.test/socken-${m}`);
    // Push: Kauf-Meldung (Deal-Wert über der Schwelle 1) mit „Zum Angebot“ und „Gekauft …“, Text mit Menge/Budget
    await expect.poll(async () => (await sql<{ c: string }>("select count(*) c from deal_eingaenge where id = $1 and push_am is not null", [idA]))[0].c, { timeout: 30_000 }).toBe("1");
    const neueste = await (await page.request.get("/api/push/neueste")).json();
    if (zA.ampel !== "rot") {
      expect(neueste.aktionen.map((a: { aktion: string }) => a.aktion)).toEqual(["angebot", "gekauft"]);
      expect(neueste.aktionen[0].link).toBe(`https://shop.example.test/socken-${m}`);
      expect(neueste.aktionen[1].link).toBe(`/deal-eingang/${idA}?zeile=${zA.nr}#gekauft`);
      expect(neueste.text).toContain("Budget Woche noch 5.000 €");
    }

    // 4) „Gekauft: Menge, Preis“ → Status gekauft, Bestellung „bestellt“, Aufgabe „Wareneingang buchen“
    const kauf = page.getByTestId("de-gekauft-form");
    await kauf.locator('input[name="menge"]').fill("20");
    await kauf.locator('input[name="preis"]').fill("2,10");
    await Promise.all([aktion(page), page.getByTestId("de-gekauft-knopf").click()]);
    await expect(page.getByRole("status")).toContainText("Als gekauft gespeichert: 20 Stk – Bestellung angelegt");
    const eA = await eingang(idA);
    expect(eA).toMatchObject({ status: "gekauft", gekauft_menge: 20, gekauft_weg: "knopf" });
    expect(Number(eA.gekauft_preis)).toBe(2.1);
    const [po] = await sql<{ status: string; number: string }>("select status, number from purchase_orders where id = $1", [eA.bestellung_id]);
    expect(po.status).toBe("ordered");
    expect((await sql<{ c: string }>("select count(*) c from tasks where tenant_id = $1 and title like $2 and status <> 'done'", [T, `Lieferung ${po.number}%Wareneingang buchen`]))[0].c).toBe("1");
    await page.reload();
    await expect(page.getByTestId("de-gekauft")).toContainText("20");
    // Budget-Verbrauch dieser Woche steht in den Einstellungen
    await page.goto("/deal-eingang");
    await expect(page.getByTestId("de-einstellungen")).toContainText("42");

    // 5) Bestellbestätigungs-Mail (Amazon) zu einem offenen Deal → gekauft (Menge, Preis, Bestellnummer)
    const r2 = await page.request.post("/api/deal-eingang", { multipart: { text: `B0TESTDE02 Testtasse 3,10 netto ab 10 Stk ${m}`, quelle: `Testhändler ${m}` }, maxRedirects: 0 });
    const idB = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r2.headers().location ?? "")![1];
    await fertig(idB);
    const eml = [`From: Amazon.de <bestellbestaetigung@amazon.de>`, `To: ich@example.invalid`, `Subject: Ihre Amazon.de Bestellung von „Testtasse ${m}“`, `Message-ID: <bestellung-${m}@example.invalid>`, `Date: ${new Date().toUTCString()}`, `Content-Type: text/plain; charset=utf-8`, "", "Vielen Dank für Ihre Bestellung.", `Bestellnummer 303-${String(basisId).padStart(7, "0").slice(-7)}-1234567`, "Testtasse https://www.amazon.de/dp/B0TESTDE02/ref=test", "Menge: 12", "Einzelpreis: 3,05 €"].join("\r\n");
    await page.goto("/posteingang");
    const emlForm = page.getByTestId("eml-upload").first();
    await emlForm.locator("input[type=file]").setInputFiles({ name: `bestellung-${m}.eml`, mimeType: "message/rfc822", buffer: Buffer.from(eml) });
    await emlForm.getByRole("button", { name: "Hochladen", exact: true }).click();
    await expect.poll(async () => (await eingang(idB)).status, { timeout: 30_000 }).toBe("gekauft");
    // Die Bestellung entsteht direkt nach dem Status „gekauft“ – darauf warten statt sofort zu lesen.
    await expect.poll(async () => (await eingang(idB)).bestellung_id ?? null, { timeout: 15_000 }).not.toBeNull();
    const eB = await eingang(idB);
    expect(eB).toMatchObject({ gekauft_menge: 12, gekauft_weg: "mail" });
    expect(Number(eB.gekauft_preis)).toBe(3.05);
    const [poB] = await sql<{ status: string; supplier_order_no: string | null }>("select status, supplier_order_no from purchase_orders where id = $1", [eB.bestellung_id]);
    expect(poB).toMatchObject({ status: "ordered", supplier_order_no: expect.stringMatching(/^303-\d{7}-1234567$/) });
    // Die Mail bleibt normal im Posteingang (nur zusätzlich ausgewertet)
    expect((await sql<{ c: string }>("select count(*) c from emails where tenant_id = $1 and subject like $2", [T, `%Testtasse ${m}%`]))[0].c).toBe("1");

    // 6) 👍/👎 aus der Push-Meldung (öffnet die Seite mit vorgewählter Bewertung) mit Kurzgrund
    await page.goto(`/deal-eingang/${idB}?daumen=runter#bewerten`);
    const bew = page.getByTestId("de-bewerten");
    await expect(bew.locator('input[value="runter"]')).toBeChecked();
    await bew.locator('select[name="grund"]').selectOption("Amazon drin");
    await Promise.all([aktion(page), page.getByTestId("de-bewerten-knopf").click()]);
    await expect(page.getByRole("status")).toContainText("👎 gespeichert");
    expect(await eingang(idB)).toMatchObject({ daumen: "runter", daumen_grund: "Amazon drin", daumen_weg: "push" });
    await expect(page.getByTestId("de-daumen")).toContainText("👎 Amazon drin (Push)");

    // 7) 👍 als Reaktion unter der ProfitPath-Nachricht in Discord → gespeichert (Bot-eigene Reaktionen zählen nicht)
    const pp = await (await fetch(`${TD}/__discord-va/profitpath`, { method: "POST", body: JSON.stringify({ kanal: "810000000000000001", name: "dealwatch-drogerie", titel: `Testmarke Haarspray ${m} (erfunden)`, asin: "B0TESTPP02", ek: "€8,99" }) })).json();
    await page.goto("/deal-eingang");
    await Promise.all([aktion(page), page.getByTestId("de-profitpath").click()]);
    await expect(page.getByRole("status")).toContainText("ProfitPath: 1 neu");
    const [ppE] = await sql<{ id: string }>("select id from deal_eingaenge where tenant_id = $1 and discord_ref = $2", [T, `810000000000000001/${pp.id}`]);
    expect(ppE).toBeTruthy();
    await fetch(`${TD}/__discord-va/reaktion`, { method: "POST", body: JSON.stringify({ nachricht: pp.id, emoji: "👍" }) });
    await Promise.all([aktion(page), page.getByTestId("de-profitpath").click()]);
    await expect(page.getByRole("status")).toContainText("1 Bewertung (👍/👎) aus Discord");
    expect(await eingang(ppE.id)).toMatchObject({ daumen: "hoch", daumen_weg: "discord" });

    // 8) Nach Wareneingang + 30 Tagen: reales Ergebnis aus sellerboard zugeordnet
    await sql("update deal_eingaenge set gekauft_am = now() - interval '45 days', created_at = now() - interval '46 days' where id = $1", [idA]);
    await sql("update purchase_orders set status = 'received', received_at = now() - interval '35 days' where id = $1", [eA.bestellung_id]);
    await sql("insert into sellerboard_sku_months (tenant_id, month, sku, asin, name, units, sales, net_profit, synced_at) values ($1, to_char(now() - interval '35 days', 'YYYY-MM'), $2, 'B0TESTDE01', 'Testsocken (erfunden)', 16, 159.84, 22.4, now())", [T, `TEST-DW-${m}`]);
    await page.goto("/deal-eingang/lernen");
    await Promise.all([aktion(page), page.getByTestId("dl-ergebnisse").click()]);
    await expect(page.getByRole("status")).toContainText(/[1-9]\d* Ergebnis/);
    const ergebnis = (await eingang(idA)).ergebnis!;
    expect(ergebnis).toMatchObject({ tage: 30, verkauft: 16 });
    expect(ergebnis.realerRoi).toBe(Math.round((22.4 / (16 * 2.1)) * 100));
    await page.goto(`/deal-eingang/${idA}`);
    await expect(page.getByTestId("de-ergebnis")).toContainText("Ergebnis nach 30 Tagen: 16 verkauft");

    // 9) Monatsbericht: Seite + Lugru-Stand
    const monat = new Date().toISOString().slice(0, 7);
    await page.goto(`/deal-eingang/lernen?monat=${monat}`);
    await expect(page.getByTestId("dl-bericht")).toHaveAttribute("data-monat", monat);
    await expect(page.getByTestId("dl-lugru")).toContainText("Kauf-Reaktionen");

    // 10) Claude: neue Werkzeuge (list_changed), Deal-Wert, Bericht, 👍/👎, gekauft
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    expect(await mcp.tools()).toEqual(expect.arrayContaining(["deal_wert", "deal_lernen_bericht", "deal_bewerten", "deal_gekauft"]));
    const wert = JSON.parse(await mcp.call("deal_wert", { deal_id: idA }));
    expect(wert.angebote[0].begruendung).toMatch(/^Passt zu dir/);
    expect(wert.angebote[0].aehnliche_deals.some((a: { quelle: string }) => a.quelle === "Lugru-Gruppe")).toBe(true);
    const ohneEk = JSON.parse(await mcp.call("deal_wert", { asin: "B0TESTLG09" }));
    expect(ohneEk.ohne_ek).toBe(true);
    const bericht = JSON.parse(await mcp.call("deal_lernen_bericht", { monat }));
    expect(bericht.lugru_history.kauf_reaktionen).toBeGreaterThanOrEqual(6);
    expect(JSON.parse(await mcp.call("deal_bewerten", { deal_id: idB, daumen: "hoch", grund: "sonstiges" })).ok).toBe(true);
    expect(await eingang(idB)).toMatchObject({ daumen: "hoch", daumen_weg: "claude" });
    const r3 = await page.request.post("/api/deal-eingang", { multipart: { text: `B0TESTDE03 Testbecher 1,90 netto ab 30 Stk ${m}` }, maxRedirects: 0 });
    const idC = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r3.headers().location ?? "")![1];
    await fertig(idC);
    const gek = JSON.parse(await mcp.call("deal_gekauft", { deal_id: idC, menge: 30, preis: 1.85 }));
    expect(gek.ok).toBe(true);
    expect(gek.bestellung).toMatch(/\/einkauf\/[0-9a-f-]{36}$/);
    expect(await eingang(idC)).toMatchObject({ status: "gekauft", gekauft_menge: 30, gekauft_weg: "claude" });
  });
});
