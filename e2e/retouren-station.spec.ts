// Retouren-Station: ein Remissionspaket mit 4 Artikeln komplett per Sprache (eingespeist wie die Spracherkennung)
// und Handscanner – ohne Tastatur/Maus nach dem Start. Kamera ist die Test-Kamera von Chromium, die KI der
// Testdienst. Geprüft: Zuordnung über Etikett/Lieferschein/LPN, Entscheidung (Fall, OK, unter Schwelle, schon
// erstattet), KI-Warnung, Netz weg → Warteschlange, Video, Fall-Paket (Text, Fotos in Reihenfolge, ZIP),
// Anspruch mit Frist, „Eingereicht“ mit Fallnummer, RET-SKU mit EK aus der Charge, Claude-Werkzeug.
import { anmelden, expect, mcpVerbinden, sql, test } from "./helfer";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, permissions: ["camera", "microphone"] });

const posId = async (lpn: string) => (await sql<{ id: string }>("select id from retouren_positionen where lpn = $1 order by created_at desc limit 1", [lpn]))[0]?.id;

test.describe("Remissionen – Retouren-Station", () => {
  test("Paket mit 4 Artikeln nur per Sprache: Fall, OK + RET-SKU, unter Schwelle, schon erstattet; Fall-Paket und Eingereicht", async ({ page, baseURL, browser, context }) => {
    test.setTimeout(120_000);
    await anmelden(page, "inhaber");
    await page.goto("/remissionen/station");
    await page.getByTestId("station-start").click();
    await expect(page.getByTestId("station-kamera")).toContainText("Kamera an");
    const ansagen = () => page.evaluate(() => window.__station?.ansagen ?? []);
    const letzte = async () => (await ansagen()).at(-1) ?? "";
    let n = 0;
    /** Satz sagen und auf die nächste Ansage warten. */
    const sage = async (text: string, erwartet: string | RegExp) => {
      n = (await ansagen()).length;
      await page.evaluate((t) => window.__station!.sage(t), text);
      await expect.poll(async () => ((await ansagen()).length > n ? await letzte() : ""), { timeout: 20_000 }).toMatch(erwartet);
    };
    const scanne = async (code: string, erwartet: string | RegExp) => {
      n = (await ansagen()).length;
      await page.evaluate((c) => window.__station!.scanne(c), code);
      await expect.poll(async () => ((await ansagen()).length > n ? await letzte() : ""), { timeout: 20_000 }).toMatch(erwartet);
    };

    await sage("Neues Paket", /Neues Paket/);
    await expect(page.getByTestId("station-naechster")).toContainText("Etikett");
    await sage("Etikett", "Remission ZtestRem01, 2 Positionen erwartet.");
    await expect(page.getByTestId("station-remission")).toHaveText("ZtestRem01");
    await sage("Packzettel", "Lieferschein passt, 2 Positionen.");
    await sage("wo ist der Kaffee", "Nicht verstanden.");

    // Artikel 1: leer → Fall über 34,99 €
    await scanne("LPNTE000000001", "Testsocken (erfunden), Grund: defekt, erstattet 34,99 €.");
    await expect(page.getByTestId("station-lpn")).toHaveText("LPNTE000000001");
    await sage("Foto", "Foto 1 gespeichert.");
    await sage("noch ein Foto", "Foto 2 gespeichert.");
    await sage("leer", "leer gespeichert. Fall über 34,99 €.");
    await sage("Notiz Karton war offen", "Notiz zu Artikel 1 gespeichert.");

    // Artikel 2: OK, aber die KI sieht ein anderes Produkt → Warnung
    await scanne("LPNTE000000002", /^Testtasse \(erfunden\), Grund: nicht mehr gewollt, erstattet 14,90 €\./);
    await sage("Foto", "Foto 1 gespeichert.");
    await sage("Zustand OK", /^OK gespeichert\./);
    await expect(page.getByTestId("station-kiwarnung")).toContainText("anderes Produkt", { timeout: 20_000 });
    await expect.poll(async () => (await ansagen()).some((a) => a.includes("Bild zeigt anderes Produkt"))).toBe(true);

    // Artikel 3: benutzt, nur 9,99 € erstattet → kein Fall
    await scanne("LPNTE000000003", /erstattet 9,99 €\./);
    await sage("Foto", "Foto 1 gespeichert.");
    await sage("benutzt", "benutzt gespeichert. unter der Schwelle – nur dokumentiert. Vorschlag: über eBay verkaufen.");

    // Artikel 4: Amazon hat schon gezahlt → kein zweiter Fall
    await scanne("LPNTE000000004", /Amazon hat schon gezahlt/);
    await sage("kaputt", /beschädigt gespeichert\. Amazon hat schon erstattet\./);

    // Netz weg: die Notiz wartet im Browser und geht danach raus
    await context.setOffline(true);
    await page.evaluate(() => window.__station!.sage("Notiz Klebeband aufgeschnitten"));
    await expect(page.getByTestId("station-warteschlange")).toContainText("Netz weg", { timeout: 15_000 });
    await context.setOffline(false);
    await expect.poll(letzte, { timeout: 40_000 }).toBe("Notiz zu Artikel 4 gespeichert.");

    await sage("Fertig", "Paket fertig. 1 OK, 1 Fall über 34,99 €, 2 ohne Fall.");

    // Im Hintergrund: Anspruch, Falltext, RET-SKU mit EK aus der Charge
    const p1 = await posId("LPNTE000000001");
    await expect.poll(async () => (await sql<{ n: number }>("select count(*)::int n from claims where detection_key = $1", [`station:${p1}`]))[0].n, { timeout: 30_000 }).toBe(1);
    const [c] = await sql<{ type: string; expected_amount: string; deadline: string; status: string }>("select type, expected_amount::text, deadline::text, status from claims where detection_key = $1", [`station:${p1}`]);
    expect(c).toMatchObject({ type: "return_condition", status: "detected" });
    expect(Number(c.expected_amount)).toBeCloseTo(34.99, 2);
    const [{ frist }] = await sql<{ frist: string }>("select (return_date + 60)::text frist from amazon_customer_returns where lpn = 'LPNTE000000001'");
    expect(c.deadline).toBe(frist);
    await expect.poll(async () => (await sql<{ t: string | null }>("select fall_text_de t from retouren_positionen where id = $1", [p1]))[0].t ?? "", { timeout: 30_000 }).toContain("LPNTE000000001");
    const [ret] = await sql<{ ret_sku: string; ek: string; quelle: string }>("select p.ret_sku, l.unit_cost_net::text ek, l.unit_cost_source quelle from retouren_positionen p join lots l on l.id = p.ret_charge_id where p.lpn = 'LPNTE000000002'");
    expect(ret.ret_sku).toMatch(/^RET_\d+_LPNTE000000002_\d{2}[A-Z]{3}\d{2}_FBA$/);
    expect(Number(ret.ek)).toBeCloseTo(3.4, 2);
    expect(ret.quelle).toBe("inherited");
    expect((await sql<{ n: number }>("select count(*)::int n from claims where reference in ('302-0000000-0000103', '302-0000000-0000104') and detection_key like 'station:%'"))[0].n).toBe(0);

    // Video des Pakets ist da und abspielbar (verschlüsselt abgelegt, entschlüsselt ausgeliefert)
    const [v] = await sql<{ id: string; teile: number }>("select m.id, m.teile from retouren_medien m join retouren_positionen p on p.pruefung_id = m.pruefung_id where p.id = $1 and m.art = 'video'", [p1]);
    expect(v.teile).toBeGreaterThanOrEqual(1);
    const vr = await page.request.get(`/remissionen/pruefungen/medien/${v.id}`);
    expect(vr.status()).toBe(200);
    expect(vr.headers()["content-type"]).toContain("video/webm");

    // Claude-Werkzeug: offener Fall mit Frist und Link
    const k = await mcpVerbinden(browser, baseURL!, "inhaber");
    const w = JSON.parse(await k.call("retouren_pruefungen", {}));
    expect(w.summen).toMatchObject({ offene_faelle: 1, offene_faelle_euro: 34.99 });
    expect(w.eintraege[0]).toMatchObject({ lpn: "LPNTE000000001", befund: "leer", frist: frist, link: `${baseURL}/remissionen/pruefungen/fall/${p1}` });

    // Laufende Chats erfahren über den Ereignis-Kanal, dass sich die Werkzeugliste geändert hat
    const sse = await fetch(`${baseURL}/api/mcp`, { headers: { Authorization: `Bearer ${k.token}`, Accept: "text/event-stream" } });
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const leser = sse.body!.getReader();
    const { value } = await leser.read();
    expect(new TextDecoder().decode(value)).toContain('"method":"notifications/tools/list_changed"');
    await leser.cancel();

    // Fall-Paket: Text, Fotos in fester Reihenfolge, ZIP, Eingereicht mit Fallnummer
    await page.goto(`/remissionen/pruefungen/fall/${p1}`);
    await expect(page.getByTestId("fall-text-de")).toContainText("LPNTE000000001");
    await expect(page.getByTestId("fall-text-en")).toContainText("302-0000000-0000101");
    expect(await page.getByTestId("fall-foto-name").allTextContents()).toEqual(["1_Versandetikett.jpg", "2_Lieferschein.jpg", "3_Produkt_LPN.jpg", "4_Inhalt_1.jpg", "4_Inhalt_2.jpg"]);
    await expect(page.getByTestId("fall-fotos-fehlen")).toHaveCount(0);
    const zip = await page.request.get(`/remissionen/pruefungen/fall/${p1}/zip`);
    expect(zip.headers()["content-type"]).toBe("application/zip");
    const bytes = (await zip.body()).toString("latin1");
    for (const name of ["1_Versandetikett.jpg", "2_Lieferschein.jpg", "3_Produkt_LPN.jpg", "4_Inhalt_2.jpg", "Falltext_DE.txt", "Falltext_EN.txt"]) expect(bytes).toContain(name);
    await page.fill("#fallnummer", "12345678901");
    await Promise.all([page.waitForURL(/meldung=eingereicht/), page.getByTestId("fall-eingereicht").click()]);
    await expect(page.getByTestId("fall-status")).toHaveText("EINGEREICHT");
    await expect(page.getByTestId("fall-nummer")).toHaveText("12345678901");
    const ev = await sql<{ action: string }>("select e.action from claim_events e join claims c on c.id = e.claim_id where c.detection_key = $1 order by e.created_at desc limit 1", [`station:${p1}`]);
    expect(ev[0].action).toBe("eingereicht (Fall 12345678901) – über Fall-Paket der Retouren-Station");

    // Liste „Fälle bereit“ ist jetzt leer, unter „Eingereicht“ steht der Fall
    await page.goto("/remissionen/pruefungen");
    await expect(page.getByTestId("faelle-liste")).toContainText("Keine Einträge");
    await page.goto("/remissionen/pruefungen?ansicht=eingereicht");
    await expect(page.getByTestId("faelle-liste")).toContainText("LPNTE000000001");
  });

  test("Rechte: Büro-Konto (ohne Amazon) kommt nicht an Station, Schnittstelle und Fotos", async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await anmelden(p, "buero");
    const r = await p.request.post("/remissionen/station/api", { data: { befehl: { befehl: "neues_paket" } } });
    expect(r.status()).toBe(403);
    const [m] = await sql<{ id: string }>("select id from retouren_medien limit 1");
    if (m) expect([302, 303, 307, 403]).toContain((await p.request.get(`/remissionen/pruefungen/medien/${m.id}`, { maxRedirects: 0 })).status());
    await p.goto("/remissionen/station");
    await expect(p).not.toHaveURL(/\/remissionen\/station/);
    await ctx.close();
  });
});
