// B20.2 Lugru Deals: Nachtrag ohne Zeitgrenze (ein Deal älter als 12 Monate kommt in den Deal-Eingang), alte
// Historie-Ampeln nach den neuen Regeln neu bewertet (viele Angebote → gelb statt rot), eine Zählbasis überall
// (Lugru-Seite, Kachel mit Zeitraum, Trefferquote, Deal-Eingang, Werkzeuge), Marge gerundet. Deals erfunden.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const zahl = (t: string) => Number(t.replace(/\./g, ""));

test.describe("Lugru Deals (B20.2)", () => {
  test("Nachtrag vollständig, Neubewertung nach neuen Regeln, eine Zählbasis, Marge gerundet", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await anmelden(page, "inhaber");
    const SCHL = `test-b20-${m}-0123456789abcdefghij`;
    await page.goto("/anbindungen?p=lugru_deals#lugru_deals");
    const karte = page.locator("#lugru_deals");
    await karte.locator('input[name="schluessel"]').fill(SCHL);
    await Promise.all([aktion(page), karte.getByRole("button", { name: "Speichern", exact: true }).click()]);

    const basis = Number(Date.now() % 1_000_000_000) + 7000;
    const vor = (tage: number) => new Date(Date.now() - tage * 86_400_000).toISOString();
    const gemein = { quellmarkt: "DE", zielmarkt: "DE", verkaeufe_monat: 200, status: "aktiv", ek_art: "netto", shop: "testshop.example", kaeufe: 0, nicht_verfuegbar: 0, kanal: "B20 Kanal" };
    const deals = [
      { ...gemein, id: basis, asin: "B0TESTB201", titel: `B20 alt ${m}`, ek_eur: 6, vk_eur: 29.9, gewinn_eur: 11.5, marge_prozent: 11.136491, gepostet_am: vor(400) },
      { ...gemein, id: basis + 1, asin: "B0TESTB202", titel: `B20 Angebote ${m}`, ek_eur: 6, vk_eur: 29.9, gewinn_eur: 11.5, marge_prozent: 46, gepostet_am: vor(10) },
    ];
    const r = await (await fetch(`${baseURL}/api/public/lugru-deals/deals`, { method: "POST", headers: { Authorization: `Bearer ${SCHL}`, "Content-Type": "application/json" }, body: JSON.stringify({ deals }) })).json();
    expect(r).toMatchObject({ ok: true, neu: 2 });

    // 1. Nachtrag: auch der Deal von vor 400 Tagen (älter als die Aufbewahrungsfrist von 12 Monaten) kommt hinein
    await page.goto("/deal-eingang/lugru");
    await Promise.all([aktion(page), page.getByTestId("lg-nachtragen").click()]);
    await expect(page.getByTestId("lg-meldung")).toContainText("in den Deal-Eingang nachgetragen");
    const eing = async (id: number) => (await sql<{ id: string; historisch: boolean; ampel: string; tage: number; regeln: number | null; gruende: string; hinweise: string }>("select id, historisch, ampel, round(extract(epoch from now() - created_at) / 86400)::int as tage, (zeilen->0->>'regeln')::int as regeln, zeilen->0->>'gruende' as gruende, zeilen->0->>'hinweise' as hinweise from deal_eingaenge where tenant_id = $1 and quelle_ref = $2", [T, `lugru-app:${id}`]))[0];
    const alt = await eing(basis);
    expect(alt).toMatchObject({ historisch: true, tage: 400, regeln: 2 });
    // Marge aus dem Post gerundet (11,1 % statt 11,136491 %)
    expect(alt.hinweise).toContain("Marge 11,1 %");
    expect(alt.hinweise).not.toContain("11,136491");

    // 2. Alte Regel simulieren: Eingang „rot wegen 30 Angeboten“ nach Regel-Stand 1 → Neubewertung macht ihn gelb
    const b = await eing(basis + 1);
    await sql(`update lugru_deals_historie set keepa = '{"angebote": 30, "amazonAnteil": 10, "buyBox": 29.9, "buyBox90": 29.9, "gekauftImMonat": 200}'::jsonb, ampel = 'rot' where tenant_id = $1 and extern_id = $2`, [T, basis + 1]);
    await sql(`update deal_eingaenge set ampel = 'rot', zeilen = jsonb_set(zeilen, '{0,regeln}', '1'::jsonb) where id = $1`, [b.id]);
    await page.goto("/deal-eingang/lugru");
    await expect(page.getByTestId("lg-eingang-stand")).toContainText("nach den neuen Regeln neu bewertet");
    await Promise.all([aktion(page), page.getByTestId("lg-nachtragen").click()]);
    await expect(page.getByTestId("lg-meldung")).toContainText("neu bewertet");
    const b2 = await eing(basis + 1);
    expect(b2).toMatchObject({ ampel: "gelb", regeln: 2 });
    expect(b2.gruende).toMatch(/30 Angebote/);
    expect((await sql<{ ampel: string }>("select ampel from lugru_deals_historie where tenant_id = $1 and extern_id = $2", [T, basis + 1]))[0].ampel).toBe("gelb");

    // 3. Fortschritt „x / gesamt“ mit Zeitpunkt; dieselbe Zahl in Werkzeug, Trefferquote und Deal-Eingang
    await page.goto("/deal-eingang/lugru");
    const [x, gesamt] = (await page.getByTestId("lg-fortschritt").innerText()).split("/").map((t) => zahl(t.trim()));
    expect(x).toBeGreaterThanOrEqual(2);
    expect(x).toBeLessThanOrEqual(gesamt);
    await expect(page.getByTestId("lg-fortschritt-stand")).toContainText(/Stand \d{2}\.\d{2}\.\d{2}/);
    await expect(page.getByTestId("lg-kachel-gruen")).toContainText("Deals im Deal-Eingang mit Ampel");
    await expect(page.getByTestId("lg-kachel-gruen")).toContainText(/Anteil grün \(\d{2}\.\d{2}\.\d{4}–\d{2}\.\d{2}\.\d{4}\)/);
    // Marge in der Liste gerundet
    await page.goto(`/deal-eingang/lugru?suche=${m}`);
    await expect(page.getByTestId("lg-liste")).toContainText("11,1 %");
    await expect(page.getByTestId("lg-liste")).not.toContainText("11,136491");

    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const liste = JSON.parse(await mcp.call("lugru_deals", { suche: m })) as { import: { im_deal_eingang_mit_ampel: number; ohne_testkanaele: number; fortschritt: string; fortschritt_stand: string | null }; deals: { asin: string; marge: number }[] };
    expect(liste.import).toMatchObject({ im_deal_eingang_mit_ampel: x, ohne_testkanaele: gesamt, fortschritt: `${x} / ${gesamt}` });
    expect(liste.import.fortschritt_stand).toBeTruthy();
    expect(liste.deals.find((d) => d.asin === "B0TESTB201")!.marge).toBe(11.1);
    const q = JSON.parse(await mcp.call("deal_quellen", {})) as { quellen: { quelle: string; gemeldet: number; gepostet?: number }[] };
    expect(q.quellen.find((z) => z.quelle === "Lugru Deals")).toMatchObject({ gemeldet: x, gepostet: gesamt });
    const st = JSON.parse(await mcp.call("lugru_statistik", {})) as { mitAmpel: number; zaehlbasis: string };
    expect(st.zaehlbasis).toBe("Deals im Deal-Eingang mit Ampel");
    expect(st.mitAmpel).toBeLessThanOrEqual(x); // 90 Tage ⊂ alle

    await page.goto(`/deal-eingang?quelle=${encodeURIComponent("Lugru Deals")}`);
    await expect(page.getByTestId("de-lugru-zaehlung")).toContainText(`Lugru Deals im Deal-Eingang mit Ampel: ${x.toLocaleString("de-DE")}`);
    await expect(page.getByTestId("de-quellen").locator("tr", { hasText: /^Lugru Deals/ }).locator("td").nth(1)).toContainText(String(x));
  });
});
