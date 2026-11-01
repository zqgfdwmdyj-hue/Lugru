// Kaufen mit einem Tap · Shop-Profile · Payback (Abnahmen 1–4 und 6) gegen die Testdienste – erfundene ASINs, Shops und
// Codes. Das System bereitet nur den Link vor (Warenkorb bei Amazon, sonst Produktseite); gekauft wird nie automatisch.
import { createHash } from "node:crypto";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const tagCode = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}${MON[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;

test.describe("Kaufen mit einem Tap", () => {
  test("Push mit Warenkorb-Link bzw. Produktseite + Code, Kurzlink markiert „Kauf vorbereitet“, „Kaufen 17“, 24-Std.-Abgleich, Shop-Profile, Payback", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    await sql("insert into push_abos (tenant_id, user_id, endpoint) values ($1, $2, $3)", [T, INH, `${TD}/push/kt-${m}`]);
    // Ausgangslage: keine Budgetgrenze (Standard), Payback-Hinweis an
    await sql(`update tenants set settings = jsonb_set(settings, '{dealEingang}', (coalesce(settings->'dealEingang', '{}'::jsonb) - 'budgetJeDeal' - 'budgetJeTag' - 'budgetJeWoche') || '{"paybackEingerichtet": false}'::jsonb) where id = $1`, [T]);
    const skuId = `kt-${m}`;
    try {
      await anmelden(page, "inhaber");
      const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
      const pruefen = async (text: string) => JSON.parse(await mcp.call("deal_eingang_pruefen", { text, asin: "B0TESTDE01", ek: 2.1, menge: 20, quelle: `KT-Test ${m}` })) as { id: string; pruefung: string; ampel: string | null };
      // Meldung zu genau diesem Deal (über seine Kauf-Nummer) – parallele Tests schicken an dasselbe Konto
      type Meldung = { titel: string; text: string; link: string; aktionen: { aktion: string; titel: string; link: string }[] | null };
      const meldungZu = async (eingangId: string): Promise<Meldung | undefined> => {
        const [e] = await sql<{ nr: number | null }>("select kauf_nr as nr from deal_eingaenge where id = $1", [eingangId]);
        if (!e?.nr) return undefined;
        return (await sql<Meldung>("select titel, text, link, aktionen from meldungen where tenant_id = $1 and user_id = $2 and aktionen::text like $3 order by created_at desc limit 1", [T, INH, `%"/k/${e.nr}"%`]))[0];
      };

      // Abnahme 2: Nicht-Amazon-Deal → Push öffnet die Produktseite, nennt Shop und Gutschein, Code kopierbar
      const produkt = `https://www.mediamarkt.de/de/product/_testartikel-${m.toLowerCase()}.html`;
      const a = await pruefen(`Testdeal ${m} bei MediaMarkt ${produkt} – Code: BLACK${m} im Warenkorb`);
      expect(a.pruefung).toBe("fertig");
      test.skip(a.ampel === "rot", "Testdienste liefern Rot – Kauf-Meldung nur für nicht rote Deals");
      const pa = (await meldungZu(a.id))!;
      const nrA = Number(/\/k\/(\d+)$/.exec(pa.aktionen?.[0]?.link ?? "")?.[1]);
      expect(nrA).toBeGreaterThan(0);
      expect(pa.titel).toContain(`Nr. ${nrA}`);
      expect(pa.aktionen!.map((x) => [x.aktion, x.titel])).toEqual([["produkt", "Produktseite öffnen"], ["code", "Code kopieren"]]);
      expect(pa.aktionen![1].link).toBe(`/k/${nrA}?code=1`);
      expect(pa.text).toContain(`Deal ${nrA}:`);
      expect(pa.text).toContain("MediaMarkt: Produktseite öffnen – Menge");
      expect(pa.text).toContain(`Code: BLACK${m}`);
      expect(pa.text).not.toContain("Warenkorb vorbereitet");
      expect(pa.text).toContain("diesen Monat eingekauft:");
      // Kurzlink: 302 zur Produktseite, Deal „Kauf vorbereitet (Menge)“ – gekauft ist damit nichts
      const ka = await page.request.get(`/k/${nrA}`, { maxRedirects: 0 });
      expect(ka.status()).toBe(302);
      expect(ka.headers().location).toBe(produkt);
      const [ea] = await sql<{ status: string; menge: number | null; vorbereitet: boolean }>("select status, kauf_vorbereitet_menge as menge, kauf_vorbereitet_am is not null as vorbereitet from deal_eingaenge where id = $1", [a.id]);
      expect(ea).toMatchObject({ status: "neu", vorbereitet: true });
      expect(ea.menge).toBeGreaterThanOrEqual(1);
      // „Code kopieren“ → Detailseite mit Code und Knopf
      const kc = await page.request.get(`/k/${nrA}?code=1`, { maxRedirects: 0 });
      expect(kc.headers().location).toContain(`/deal-eingang/${a.id}?code=1#gekauft`);
      await page.goto(`/deal-eingang/${a.id}?code=1#gekauft`);
      await expect(page.getByTestId("de-gutschein")).toContainText(`BLACK${m}`);
      await expect(page.getByTestId("de-gutschein").getByRole("button", { name: "Code kopieren" })).toBeVisible();
      await expect(page.getByTestId("de-warenkorb")).toHaveText("Produktseite öffnen");
      await expect(page.getByTestId("de-kauf-vorbereitet")).toContainText("Kauf vorbereitet");

      // Abnahme 1: Lugru-Deal aus Amazon.FR → Push „In den Warenkorb (n)“ mit Warenkorb-Link amazon.fr, Menge ≤ max. Stück
      const b = await pruefen(`Lugru-Testdeal ${m}`);
      // Post-Zeit nach früheren Test-Bestellungen derselben Test-ASIN (sonst zählt der Lugru-Abgleich diese als Kauf)
      await sql("insert into lugru_deals_historie (tenant_id, quelle, asin, titel, kanal, gepostet_am, shop, quellmarkt, zielmarkt, max_menge, ek_eur, gewinn_eur, eingang_id) values ($1, 'app', 'B0TESTDE01', $2, 'deals', now() + interval '30 minutes', 'Amazon.FR', 'FR', 'DE', 3, 2.10, 3.00, $3)", [T, `Testartikel KT ${m}`, b.id]);
      // Erst-Meldung lief ohne Shop (kein Link im Text) – nach dem Verknüpfen neu prüfen und neu melden
      await sql("update deal_eingaenge set push_am = null where id = $1", [b.id]);
      await page.goto(`/deal-eingang/${b.id}`);
      await Promise.all([aktion(page), page.getByRole("button", { name: "Neu prüfen" }).click()]);
      await expect.poll(async () => (await meldungZu(b.id))?.aktionen?.[0]?.aktion, { timeout: 30_000 }).toBe("warenkorb");
      const pb = (await meldungZu(b.id))!;
      const nrB = Number(/\/k\/(\d+)$/.exec(pb.aktionen![0].link)?.[1]);
      expect(nrB).not.toBe(nrA);
      expect(pb.aktionen!.map((x) => [x.aktion, x.titel])).toEqual([["warenkorb", "In den Warenkorb (3)"], ["details", "Details"]]);
      expect(pb.text).toContain("Amazon.FR: Warenkorb vorbereitet (3 Stk)");
      const kb = await page.request.get(`/k/${nrB}`, { maxRedirects: 0 });
      expect(kb.headers().location).toBe("https://www.amazon.fr/gp/aws/cart/add.html?ASIN.1=B0TESTDE01&Quantity.1=3");
      // Rückfall: Produktseite mit Menge selbst wählen
      expect((await page.request.get(`/k/${nrB}?produkt=1`, { maxRedirects: 0 })).headers().location).toBe("https://www.amazon.fr/dp/B0TESTDE01");
      await page.reload();
      await expect(page.getByTestId("de-warenkorb")).toHaveText("In den Warenkorb (3)");
      await expect(page.getByTestId("de-produktseite")).toContainText("Menge 3 wählen");

      // Abnahme 3: „Kaufen 17“ (Watch/Siri-Kurzbefehl) → derselbe Warenkorb-Link, nur mit Handy-Schlüssel
      const token = `mk_kt${m}${"x".repeat(24)}`;
      await sql("insert into api_tokens (tenant_id, user_id, name, zweck, token_hash, anfang) values ($1, $2, $3, 'mobil', $4, $5)", [T, INH, `Watch ${m}`, createHash("sha256").update(token).digest("hex"), token.slice(0, 7)]);
      const kaufen = (body: unknown, t = token) => page.request.post("/api/mobil/kaufen", { data: body, headers: { Authorization: `Bearer ${t}` } });
      expect((await kaufen({ text: `Kaufen ${nrB}` }, "mk_falsch_00000000000000000000")).status()).toBe(401);
      const kr = await kaufen({ text: `Kaufen ${nrB}` });
      expect(kr.status()).toBe(200);
      expect(await kr.json()).toMatchObject({ ok: true, url: "https://www.amazon.fr/gp/aws/cart/add.html?ASIN.1=B0TESTDE01&Quantity.1=3", nr: nrB, menge: 3, warenkorb: true });
      expect((await (await kaufen({ nr: nrB })).json()).antwort).toContain("Warenkorb mit 3 Stück");
      // Nummer nach 24 Std. abgelaufen
      await sql("update deal_eingaenge set kauf = jsonb_set(kauf, '{am}', to_jsonb((now() - interval '25 hours')::text)) where id = $1", [b.id]);
      const alt = await kaufen({ nr: nrB });
      expect(alt.status()).toBe(404);
      expect((await alt.json()).antwort).toContain("abgelaufen");

      // Abnahme 4: 24 Std. nach „Kauf vorbereitet“ → sellerboard-SKU mit ASIN + Kaufdatum → „gekauft (automatisch: SKU)“;
      // Deal ohne passende SKU → einmal Erinnerung „Deal n noch offen?“
      await sql("update deal_eingaenge set kauf_vorbereitet_am = now() - interval '25 hours' where id = any($1::uuid[])", [[a.id, b.id]]);
      const sku = `TESTK_${tagCode(new Date())}_B0TESTDE01_2.50_9.99`;
      await sql("insert into sellerboard_products (tenant_id, sb_id, sku, asin, name, synced_at) values ($1, $2, $3, 'B0TESTDE01', 'Testartikel KT', now())", [T, skuId, sku]);
      // A ist ebenfalls B0TESTDE01 – damit A „offen“ bleibt, A zuerst vom Abgleich ausnehmen (verworfen), dann wieder neu.
      // Lugru-Verknüpfung von B lösen: sonst nimmt der Lugru-Abgleich ggf. eine Test-Bestellung paralleler Tests (gleiche
      // Test-ASIN) – hier geht es um die 24-Std.-Prüfung über die sellerboard-SKU.
      await sql("update deal_eingaenge set status = 'verworfen' where id = $1", [a.id]);
      await sql("update lugru_deals_historie set eingang_id = null where eingang_id = $1", [b.id]);
      await page.goto("/deal-eingang/lugru");
      await Promise.all([aktion(page), page.getByTestId("lg-kauf-abgleich").click()]);
      await expect(page.getByRole("status")).toContainText("Kauf vorbereitet: 1 als gekauft erkannt (sellerboard-SKU)");
      const [eb] = await sql<{ status: string; weg: string; ref: string; menge: number; preis: string }>("select status, gekauft_weg as weg, gekauft_ref as ref, gekauft_menge as menge, gekauft_preis::text as preis from deal_eingaenge where id = $1", [b.id]);
      expect(eb).toMatchObject({ status: "gekauft", weg: "automatisch", ref: `sellerboard-SKU ${sku}`, menge: 3 });
      await page.goto(`/deal-eingang/${b.id}`);
      await expect(page.getByTestId("de-gekauft")).toContainText("automatisch erkannt – sellerboard-SKU");
      // Erinnerung für A (andere ASIN gibt es nicht → SKU-Datum vor dem Vorbereiten zählt nicht): SKU entfernen, A wieder offen
      await sql("delete from sellerboard_products where tenant_id = $1 and sb_id = $2", [T, skuId]);
      await sql("update deal_eingaenge set status = 'neu' where id = $1", [a.id]);
      await page.goto("/deal-eingang/lugru");
      await Promise.all([aktion(page), page.getByTestId("lg-kauf-abgleich").click()]);
      await expect(page.getByRole("status")).toContainText("1 Erinnerung(en) „noch offen?“");
      const [er] = await sql<Meldung>("select titel, text, link, aktionen from meldungen where tenant_id = $1 and user_id = $2 and titel = $3 order by created_at desc limit 1", [T, INH, `Deal ${nrA} noch offen?`]);
      expect(er?.titel).toBe(`Deal ${nrA} noch offen?`);
      expect(er.aktionen!.map((x) => x.aktion)).toEqual(["gekauft", "details"]);
      // nur einmal
      await page.goto("/deal-eingang/lugru");
      await Promise.all([aktion(page), page.getByTestId("lg-kauf-abgleich").click()]);
      await expect(page.getByRole("status")).not.toContainText("Erinnerung");

      // §4: keine Budgetgrenze, Monatsrahmen nur als Orientierung (Standard 150.000 €). Standard direkt vorher
      // herstellen – ein paralleler Test (deal-wert) setzt zwischendurch eigene Budget-Werte.
      await sql(`update tenants set settings = jsonb_set(settings, '{dealEingang}', coalesce(settings->'dealEingang', '{}'::jsonb) - 'budgetJeDeal' - 'budgetJeTag' - 'budgetJeWoche' - 'monatsrahmen') where id = $1`, [T]);
      await page.goto("/deal-eingang");
      await expect(page.getByTestId("de-monatsrahmen")).toContainText("von ~150.000 €");
      await expect(page.getByTestId("de-einstellungen-form").locator('input[name="budgetJeDeal"]')).toHaveValue("0");
      await expect(page.getByTestId("de-einstellungen-form").locator('input[name="budgetJeDeal"]')).not.toHaveAttribute("placeholder", "3");

      // Abnahme 6 + §2: Shop-Profile und Payback in den Einstellungen; Anleitung im Wissen
      await page.goto("/einstellungen/shop-profile");
      await expect(page.getByTestId("sp-profil")).toHaveCount(12); // 11 Start-Profile + „neu“
      const neu = page.locator('[data-testid="sp-profil"][data-kuerzel="neu"]');
      await neu.locator('input[name="kuerzel"]').fill(`T${m}`.slice(0, 8));
      await neu.locator('input[name="name"]').fill(`Testshop ${m}`);
      await neu.locator('input[name="domains"]').fill(`kt-${m.toLowerCase()}.example.test`);
      await neu.locator('select[name="linkArt"]').selectOption("warenkorb_link");
      await neu.locator('input[name="linkMuster"]').fill("javascript:alert(1)");
      await Promise.all([aktion(page), neu.getByRole("button", { name: "Neu anlegen" }).click()]);
      await expect(page.getByTestId("sp-meldung")).toContainText("muss mit https:// beginnen");
      const neu2 = page.locator('[data-testid="sp-profil"][data-kuerzel="neu"]');
      await neu2.locator('input[name="kuerzel"]').fill(`T${m}`.slice(0, 8));
      await neu2.locator('input[name="name"]').fill(`Testshop ${m}`);
      await neu2.locator('input[name="domains"]').fill(`kt-${m.toLowerCase()}.example.test`);
      await neu2.locator('input[name="hinweis"]').fill("Gutschein im Warenkorb");
      await neu2.locator('input[name="payback"]').fill("Kundenkonto verknüpfen");
      await Promise.all([aktion(page), neu2.getByRole("button", { name: "Neu anlegen" }).click()]);
      await expect(page.getByTestId("sp-meldung")).toContainText("gespeichert");
      await expect(page.locator(`[data-testid="sp-profil"][data-kuerzel="${`T${m}`.slice(0, 8)}"]`)).toHaveCount(1);
      expect((await sql<{ c: string }>("select count(*) c from shop_profil where tenant_id = $1 and name = $2 and payback = 'Kundenkonto verknüpfen'", [T, `Testshop ${m}`]))[0].c).toBe("1");
      await expect(page.getByTestId("sp-payback")).toContainText("feste Payback-Verknüpfung im Amazon-Konto gibt es nicht");
      await page.getByTestId("sp-payback-schalter").check();
      await Promise.all([aktion(page), page.getByTestId("sp-payback-speichern").click()]);
      await expect(page.getByTestId("sp-meldung")).toContainText("Payback als eingerichtet markiert");
      expect((await sql<{ p: boolean }>("select (settings->'dealEingang'->>'paybackEingerichtet')::boolean as p from tenants where id = $1", [T]))[0].p).toBe(true);

      // Claude: deal_eingang_detail nennt den vorbereiteten Kauf
      const det = JSON.parse(await mcp.call("deal_eingang_detail", { id: a.id })) as { kauf?: { shop: string; gutschein?: string; link_zum_selbst_kaufen: string; warenkorb_vorbereitet: boolean } };
      expect(det.kauf).toMatchObject({ shop: "MediaMarkt", gutschein: `BLACK${m}`, warenkorb_vorbereitet: false });
      expect(det.kauf!.link_zum_selbst_kaufen).toContain(`/k/${a.id}`);
    } finally {
      await sql("delete from sellerboard_products where tenant_id = $1 and sb_id = $2", [T, skuId]);
      await sql("delete from shop_profil where tenant_id = $1 and name like $2", [T, `Testshop ${m}%`]);
      await sql("update tenants set settings = jsonb_set(settings, '{dealEingang,paybackEingerichtet}', 'false'::jsonb) where id = $1 and settings ? 'dealEingang'", [T]);
    }
  });
});
