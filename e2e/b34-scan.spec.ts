// Bauauftrag B34.1 Scan-Modus – Abnahmen 1–5 gegen die Testdienste. Nur erfundene Daten: ASINs B0TESTSCN…,
// Testmarkt Musterstadt, Kassenbon als Test-PNG (KI-Nachbau liest den Text hinter „TESTOCR“).
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
type Zeile = { id: string; ampel: string | null; roi: string | null; roi_pa: string | null; ek_netto: string | null; rueckverguetung: string; offline: boolean; aktion: string | null; liste_menge: number | null; liste_ort: string | null; deal_eingang_id: string | null; belege: { art: string; belegId?: string; key?: string }[]; modus: string; preis: string };
const scans = (code: string) => sql<Zeile>("select id, ampel, roi::text, roi_pa::text, ek_netto::text, rueckverguetung::text, offline, aktion, liste_menge, liste_ort, deal_eingang_id, belege, modus, preis::text from scan_eintraege where code = $1 or asin = $1 order by created_at", [code]);

test.describe("B34.1 Scan-Modus", () => {
  test.afterAll(async () => {
    const ids = (await sql<{ b: string }>("select (x->>'belegId') b from scan_eintraege, jsonb_array_elements(belege) x where code like 'B0TESTSCN%' and x->>'belegId' is not null")).map((r) => r.b);
    if (ids.length) await sql("delete from invoices where id = any($1::uuid[])", [ids]);
    await sql("delete from deal_eingaenge where quelle = 'Scan-Modus' and rohtext like '%B0TESTSCN%'");
    await sql("delete from scan_eintraege where code like 'B0TESTSCN%' or code like '%B0TESTSCN%' or asin like 'B0TESTSCN%'");
  });

  test("Abnahme 1+2: Ergebnis unter 3 s wie scan_pruefen, Rückvergütung 2 % ändert den ROI; Einkaufsliste und Deal", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const code = "B0TESTSCN1";
    await anmelden(page, "inhaber");
    // Keepa-Cache füllen und Vergleichswert holen: Claude-Werkzeug scan_pruefen (gleiche Rechnung)
    const claude = await mcpVerbinden(browser, baseURL!, "inhaber");
    const ref = JSON.parse(await claude.call("scan_pruefen", { ean: code, preis: 9.99 }));
    expect(ref.ampel).toMatch(/gruen|gelb|rot/);
    expect(ref).toHaveProperty("roi_pa");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/scan?modus=laden");
    await expect(page.getByTestId("scan-modus")).toHaveAttribute("data-modus", "laden");
    await page.getByLabel("EAN, ASIN oder Link").fill(code);
    // Ziffernfeld: 9,99
    for (const t of ["9", ",", "9", "9"]) await page.getByRole("button", { name: t, exact: true }).click();
    await expect(page.getByTestId("scan-preis")).toHaveValue("9,99");
    await page.getByTestId("brutto").click();
    const t0 = Date.now();
    await page.getByTestId("scan-pruefen").click();
    await expect(page.getByTestId("scan-ergebnis")).toBeVisible({ timeout: 10_000 });
    const dauer = Date.now() - t0;
    expect(dauer).toBeLessThan(3000);
    await expect(page.getByTestId("scan-ergebnis")).toHaveAttribute("data-ampel", ref.ampel);
    await expect(page.getByTestId("scan-vorlesen")).toHaveText(ref.vorlesen);
    await expect(page.getByTestId("scan-begruendung")).not.toBeEmpty();
    const [ohne] = await scans(code);
    expect(Number(ohne.roi)).toBeCloseTo(ref.roi, 0);

    // Abnahme 2: Rückvergütung 2 % → EK 9,79, ROI steigt (gemerkt für den nächsten Scan)
    await page.getByTestId("scan-rv").fill("2");
    await page.getByTestId("scan-pruefen").click();
    await expect(page.getByTestId("scan-ek")).toContainText("EK nach 2 % Rückvergütung 9,79 €");
    const [, mit] = await scans(code);
    expect(Number(mit.rueckverguetung)).toBe(2);
    expect(Number(mit.roi)).toBeGreaterThan(Number(ohne.roi));
    expect(Number(mit.ek_netto)).toBeLessThan(Number(ohne.ek_netto));
    await page.reload();
    await expect(page.getByTestId("scan-rv")).toHaveValue("2");
    await expect(page.getByTestId("brutto")).toHaveAttribute("aria-pressed", "true");

    // Aktionen: In Einkaufsliste (Menge 5, Ort), dann ein zweiter Scan als Deal speichern
    await page.getByLabel("EAN, ASIN oder Link").fill(code);
    await page.getByTestId("scan-preis").fill("9,99");
    await page.getByTestId("scan-pruefen").click();
    const erg = page.getByTestId("scan-ergebnis");
    await expect(erg).toBeVisible();
    await erg.getByLabel("Menge für die Liste").fill("5");
    await erg.getByLabel("Preis für die Liste").fill("9,79");
    await erg.getByLabel("Shop oder Ort").fill(`Testmarkt Musterstadt ${m}`);
    await Promise.all([aktion(page), erg.getByTestId("aktion-einkaufsliste").click()]);
    await expect(page.getByTestId("scan-meldung")).toContainText(`In der Einkaufsliste: 5 Stück · Testmarkt Musterstadt ${m}`);
    await expect(page.getByTestId("scan-summe")).toContainText("48,95 €");
    const liste = (await scans(code)).find((z) => z.aktion === "einkaufsliste")!;
    expect(liste).toMatchObject({ liste_menge: 5, liste_ort: `Testmarkt Musterstadt ${m}` });
    await expect(page.locator(`[data-testid="scan-zeile"][data-id="${liste.id}"]`)).toHaveAttribute("data-aktion", "einkaufsliste");

    await page.getByLabel("EAN, ASIN oder Link").fill(code);
    await page.getByTestId("scan-preis").fill("9,99");
    await page.getByTestId("scan-pruefen").click();
    await expect(page.getByTestId("scan-ergebnis")).toBeVisible();
    await Promise.all([aktion(page), page.getByTestId("aktion-deal").click()]);
    await expect(page.getByTestId("scan-meldung")).toContainText("Als Deal im Deal-Eingang gespeichert");
    const deal = (await scans(code)).find((z) => z.aktion === "deal")!;
    const [eingang] = await sql<{ weg: string; quelle: string; angebote: { asin: string; ek: number }[] }>("select weg, quelle, angebote from deal_eingaenge where id = $1", [deal.deal_eingang_id]);
    expect(eingang).toMatchObject({ weg: "manuell", quelle: "Scan-Modus" });
    expect(eingang.angebote[0]).toMatchObject({ asin: code, ek: 9.79 });
  });

  test("Abnahme 3: Amazon-Link teilen öffnet das Ergebnis (Online, Kauf vorbereiten)", async ({ page, context }) => {
    test.setTimeout(120_000);
    await anmelden(page, "inhaber");
    const code = "B0TESTSCN3";
    // Teilen aus der Amazon-App: PWA-Teilen-Ziel (multipart, wie das Handy es schickt)
    const r = await page.request.post("/api/deal-eingang", { multipart: { title: "Testprodukt (erfunden)", text: `Schau dir das an https://www.amazon.de/dp/${code}/ref=test`, url: "" }, maxRedirects: 0 });
    expect(r.status()).toBe(303);
    const ziel = new URL(r.headers().location!);
    expect(ziel.pathname).toBe("/scan");
    expect(ziel.searchParams.get("modus")).toBe("online");
    expect(ziel.searchParams.get("code")).toBe(`https://www.amazon.de/dp/${code}`);
    // Deal-Posts bleiben im Deal-Eingang
    const post = await page.request.post("/api/deal-eingang", { multipart: { text: `${code} Testprodukt 12,00 netto ab 20 Stk\nROI 40 %\nBSR 1500\nhttps://www.amazon.de/dp/${code}`, quelle: "Testgruppe" }, maxRedirects: 0 });
    expect(new URL(post.headers().location!).pathname).toMatch(/^\/deal-eingang\//);
    await sql("delete from deal_eingaenge where quelle = 'Testgruppe' and rohtext like $1", [`%${code}%`]);

    await page.goto(`${ziel.pathname}${ziel.search}`);
    await expect(page.getByTestId("scan-modus")).toHaveAttribute("data-modus", "online");
    const erg = page.getByTestId("scan-ergebnis");
    await expect(erg).toBeVisible({ timeout: 15_000 });
    await expect(erg).toContainText("Preis = aktueller Buy-Box-Preis Amazon DE");
    const [z] = await scans(code);
    expect(z.modus).toBe("online");
    expect(Number(z.preis)).toBeGreaterThan(0);

    // Kauf vorbereiten: öffnet den Amazon-Warenkorb-Link (nichts gekauft) – Amazon hier abgefangen
    await context.route("https://www.amazon.de/**", (x) => x.fulfill({ status: 200, body: "Testseite" }));
    await erg.getByLabel("Menge für die Liste").fill("3");
    const [tab] = await Promise.all([context.waitForEvent("page"), erg.getByTestId("aktion-kauf").click()]);
    await expect.poll(() => tab.url()).toContain(`/gp/aws/cart/add.html?ASIN.1=${code}&Quantity.1=3`);
    await expect(page.getByTestId("scan-meldung")).toContainText("Gekauft ist damit nichts");
    expect((await scans(code)).at(-1)).toMatchObject({ aktion: "kauf_vorbereitet", liste_menge: 3 });
  });

  test("Abnahme 4: Offline-Scan wird bei Netz nachgeprüft (mit Push)", async ({ page, context }) => {
    test.setTimeout(120_000);
    await anmelden(page, "inhaber");
    const code = "B0TESTSCN4";
    await page.goto("/scan?modus=laden");
    await expect(page.getByTestId("scan-form")).toBeVisible();
    await context.setOffline(true);
    await page.getByLabel("EAN, ASIN oder Link").fill(code);
    await page.getByTestId("scan-preis").fill("8,49");
    await page.getByTestId("scan-pruefen").click();
    await expect(page.getByTestId("scan-meldung")).toContainText("Kein Netz – Scan gemerkt");
    await expect(page.getByTestId("scan-warteschlange")).toContainText("1 Scan ohne Netz gemerkt");
    expect(await scans(code)).toHaveLength(0);
    const vorher = new Date();
    await context.setOffline(false);
    await expect(page.getByTestId("scan-meldung")).toContainText("Offline-Scans nachgeprüft: 1 geprüft", { timeout: 20_000 });
    await expect(page.getByTestId("scan-warteschlange")).toHaveCount(0);
    const [z] = await scans(code);
    expect(z.offline).toBe(true);
    expect(z.ampel).toMatch(/gruen|gelb|rot/);
    await expect(page.locator(`[data-testid="scan-zeile"][data-id="${z.id}"]`)).toContainText("offline");
    const push = await sql<{ titel: string; link: string; art: string }>("select titel, link, art from meldungen where link = $1 and created_at >= $2", [`/scan?id=${z.id}`, vorher]);
    expect(push[0]).toMatchObject({ art: "deal" });
    expect(push[0].titel).toMatch(/^Offline-Scan geprüft: /);
    // Link aus dem Push zeigt den Scan
    await page.goto(push[0].link);
    await expect(page.getByTestId("scan-ergebnis")).toHaveAttribute("data-id", z.id);
  });

  test("Abnahme 5: Kassenbon-Foto landet in der Rechnungsstation, Preisschild in der Ablage", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    await anmelden(page, "inhaber");
    const code = "B0TESTSCN5";
    await page.goto("/scan?modus=laden");
    await page.getByLabel("EAN, ASIN oder Link").fill(code);
    await page.getByTestId("scan-preis").fill("4,99");
    await page.getByTestId("scan-pruefen").click();
    await expect(page.getByTestId("scan-ergebnis")).toBeVisible();
    const bon = Buffer.concat([PNG, Buffer.from(`TESTOCR\nKassenbon Testmarkt Musterstadt ${m}\nSumme 4,99 EUR`, "utf8")]);
    await Promise.all([aktion(page), page.getByTestId("foto-kassenbon").setInputFiles({ name: "bon.png", mimeType: "image/png", buffer: bon })]);
    await expect(page.getByTestId("scan-meldung")).toContainText("Kassenbon in der Rechnungsstation");
    await Promise.all([aktion(page), page.getByTestId("foto-preisschild").setInputFiles({ name: "schild.png", mimeType: "image/png", buffer: Buffer.concat([PNG, Buffer.from(m)]) })]);
    await expect(page.getByTestId("scan-meldung")).toContainText("Preisschild gespeichert");
    const [z] = await scans(code);
    expect(z.belege.map((b) => b.art)).toEqual(["kassenbon", "preisschild"]);
    const belegId = z.belege[0].belegId!;
    const [inv] = await sql<{ source: string; stapel_id: string | null }>("select source, stapel_id from invoices where id = $1", [belegId]);
    expect(inv.source).toBe("station");
    expect(inv.stapel_id).not.toBeNull();
    expect(z.belege[1].key).toBeTruthy();
    // In der Rechnungsstation im Kamera-Stapel der Person (wie ein Blatt von der Station)
    const [st] = await sql<{ quelle: string }>("select quelle from beleg_stapel where id = $1", [inv.stapel_id]);
    expect(st.quelle).toBe("kamera");
  });
});
