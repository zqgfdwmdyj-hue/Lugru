// B13 Handy & Tesla: Widget (401 ohne gültigen Schlüssel), Anrufe in der Fahrzeit + „Anruf erledigt“, Briefing je
// Ziel (Lieferant mit offenen Bestellvorschlägen, Heimweg), SMS mit Antwort-Codes (VA / KAUFEN nur Entwurf / unklar),
// „Ins Auto“, Fahrtenbuch-Vorschlag, Scan mit Satz zum Vorlesen, Claude-Werkzeuge. Erfundene Daten und Dienste.
import { createHmac } from "node:crypto";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

const sign = (url: string, p: Record<string, string>) => createHmac("sha1", "test-twilio-token").update(url + Object.keys(p).sort().map((k) => k + p[k]).join(""), "utf8").digest("base64");

test.describe("Handy & Tesla", () => {
  test("Widget, Anrufe, Briefing, SMS-Codes, Ins Auto, Fahrtenbuch, Scan, Claude", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const B = baseURL!;
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await anmelden(page, "inhaber");

    // Handy-Schlüssel
    await page.goto("/schnell");
    await page.getByTestId("mobil-token-form").locator("input[name=name]").fill(`Tesla-Handy ${m}`);
    await Promise.all([aktion(page), page.getByTestId("mobil-token-form").locator("button[type=submit]").click()]);
    const token = (await page.getByTestId("mobil-token-wert").textContent())!.trim();
    const h = { Authorization: `Bearer ${token}` };

    // 1) Widget
    expect((await fetch(`${B}/api/mobil/kurz`, { headers: { Authorization: "Bearer mk_ungueltig_ungueltig_ungueltig" } })).status).toBe(401);
    const w = await (await fetch(`${B}/api/mobil/kurz`, { headers: h })).json();
    expect(Object.keys(w)).toEqual(expect.arrayContaining(["umsatz_heute", "nettogewinn_gestern", "fbm_frist_heute", "wichtige_todos", "naechster_termin", "gruene_deals_24h"]));

    // 2) Anrufe in der Fahrzeit
    await sql("insert into tasks (tenant_id, title, priority, category, telefon) values ($1, $2, 'critical', 'eigene', '+4930000000099')", [T, `DHL Geschäftskunden ${m} anrufen`]);
    await sql("insert into tasks (tenant_id, title, priority, category, notes) values ($1, $2, 'critical', 'eigene', 'Tel. 0170 0000001')", [T, `Konrad${m} zurückrufen wegen Preisliste`]);
    const f = await (await fetch(`${B}/api/mobil/fahrt?ziel=Kino&minuten=60`, { headers: h })).json();
    expect(f.vorlesen).toMatch(/^60 Minuten Fahrt\. \d+ Anrufe:/);
    expect(f.vorlesen).toContain(`DHL Geschäftskunden ${m}`);
    expect(f.anrufe.find((a: { name: string }) => a.name === `Konrad${m}`).tel_link).toBe("tel:01700000001");
    const e = await (await fetch(`${B}/api/mobil/anruf-erledigt`, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ text: `Anruf erledigt: Konrad${m}, Notiz: nimmt 60 Stück` }) })).json();
    expect(e.ok).toBe(true);
    const [k] = await sql<{ status: string; notes: string }>("select status, notes from tasks where title like $1", [`Konrad${m}%`]);
    expect(k.status).toBe("done");
    expect(k.notes).toContain("nimmt 60 Stück");

    // 3) Briefing je Ziel: Lieferant mit offenem Bestellvorschlag; Heimweg = Feierabend
    const [sup] = await sql<{ id: string }>("insert into suppliers (tenant_id, code, name) values ($1, $2, $3) returning id", [T, `TL-${m}`, `Testlieferant ${m}`]);
    await sql("insert into lieferanten_profile (tenant_id, supplier_id, adresse, telefon) values ($1, $2, $3, '+4930000000077')", [T, sup.id, `Handelsallee 3, 54321 Musterort ${m}`]);
    const [po] = await sql<{ id: string }>("insert into purchase_orders (tenant_id, supplier_id, number, status) values ($1, $2, $3, 'draft') returning id", [T, sup.id, `BV-${m}`]);
    await sql("insert into purchase_order_items (tenant_id, po_id, quantity, unit_cost_gross) values ($1, $2, 48, 8.5)", [T, po.id]);
    const bl = await (await fetch(`${B}/api/mobil/fahrt?ziel=${encodeURIComponent(`Abholung Testlieferant ${m}`)}`, { headers: h })).json();
    expect(bl.ziel_art).toBe("lieferant");
    expect(bl.briefing).toContain("Offene Bestellvorschläge: 48 Stück für 408 Euro");
    const heim = await (await fetch(`${B}/api/mobil/fahrt?ziel=${encodeURIComponent("Wohnweg 9, 12345 Musterstadt")}`, { headers: h })).json();
    expect(heim.briefing).toMatch(/^Feierabend\./);

    // 4) SMS: Test-SMS an die eigene Nummer; Antwort „VA“ → an die VA, „KAUFEN 20“ → nur Entwurf, Unklares → Aufgabe
    const sende = async () => {
      await page.goto("/einstellungen/handy");
      await page.getByRole("button", { name: "Test-SMS senden" }).click();
      await expect(page.getByTestId("handy-meldung")).toContainText("Test-SMS gesendet");
      const liste = (await (await fetch(`${TD}/__sms`)).json()) as { an: string; text: string }[];
      const letzte = liste[liste.length - 1];
      expect(letzte.an).toBe("+4900000000002");
      return /\[(F\d+)\]$/.exec(letzte.text)![1];
    };
    const antworte = async (body: string) => {
      const url = `${B}/api/sms/antwort`;
      const p = { From: "+4900000000002", Body: body };
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sign(url, p) }, body: new URLSearchParams(p) });
      return { status: r.status, text: await r.text() };
    };
    expect((await fetch(`${B}/api/sms/antwort`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "falsch" }, body: new URLSearchParams({ From: "+4900000000002", Body: "OK" }) })).status).toBe(403);
    const r1 = await sende();
    expect((await antworte(`VA [${r1}]`)).text).toMatch(/OK: (an die VA gegeben|Aufgabe angelegt)/);
    const r2 = await sende();
    expect((await antworte(`KAUFEN 20 [${r2}]`)).text).toContain("nichts bestellt");
    expect((await sql("select 1 from tasks where title = 'Einkauf prüfen: 20 Stück (per SMS)'")).length).toBeGreaterThanOrEqual(1);
    await sende();
    expect((await antworte("Was ist damit?")).text).toContain("Aufgabe für Ludwig");

    // 5) Ins Auto (Lieferanten-Profil) → Navi-Ziel im (erfundenen) Tesla
    await page.goto(`/b2b/lieferanten/${sup.id}`);
    await page.getByTestId("ins-auto").getByRole("button").click();
    await expect(page.getByTestId("ins-auto").getByRole("status")).toContainText("Ziel ans Auto geschickt");
    expect(((await (await fetch(`${TD}/__tesla`)).json()) as { navi: string[] }).navi).toContain(`Handelsallee 3, 54321 Musterort ${m}`);

    // 6) Fahrtenbuch: Fahrt zum Lieferanten → Vorschlag geschäftlich mit Zweck
    const beginn = new Date(Date.now() - 2 * 3_600_000).toISOString();
    await fetch(`${TD}/__tesla`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fahrten: [{ id: `f-${m}`, beginn, ende: new Date().toISOString(), start: "Wohnweg 9, 12345 Musterstadt", ziel: `Handelsallee 3, 54321 Musterort ${m}`, km: 22.4 }] }) });
    await page.goto("/kalender/fahrten");
    await page.getByRole("button", { name: "Fahrten holen" }).click();
    const zeile = page.getByTestId("fahrten-liste").locator("tr", { hasText: `Musterort ${m}` });
    await expect(zeile.locator("select[name=art]")).toHaveValue("geschaeftlich");
    await expect(zeile.locator("input[name=zweck]")).toHaveValue(`Fahrt zu Testlieferant ${m}`);

    // 7) Scan mit Satz zum Vorlesen
    const s = await (await fetch(`${B}/api/mobil/scan`, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ ean: "B0TEST0003", preis: 9.99 }) })).json();
    expect(s.vorlesen).toMatch(/^(Grün|Gelb|Rot)\./);

    // 8) Claude: Werkzeuge mit Feld „vorlesen“
    const claude = await mcpVerbinden(browser, B, "inhaber", { write: true });
    expect(await claude.tools()).toEqual(expect.arrayContaining(["fahrt_briefing", "anruf_aufgaben", "anruf_erledigt", "auto_navi", "scan_pruefen"]));
    const fb = JSON.parse(await claude.call("fahrt_briefing", { ziel: `Testlieferant ${m}` }));
    expect(fb.vorlesen).toContain("Offene Bestellvorschläge");
    const aa = JSON.parse(await claude.call("anruf_aufgaben"));
    expect(aa.anrufe.some((a: { name: string }) => a.name === `DHL Geschäftskunden ${m}`)).toBe(true);

    // 9) Modul 12: auto_status (Akku, Reichweite, Standort grob, Fahrtenbuch) und auto_klima an/aus mit Temperatur
    expect(await claude.tools()).toEqual(expect.arrayContaining(["auto_status", "auto_klima"]));
    const as = JSON.parse(await claude.call("auto_status"));
    expect(as).toMatchObject({ verbunden: true, akku: 78, reichweite_km: 350, verriegelt: true, fenster_offen: false });
    expect(as.vorlesen).toMatch(/^Akku 78 Prozent, 350 Kilometer Reichweite\./);
    expect(as.fahrten.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(await claude.call("auto_klima", { an: true, temperatur: 22 }))).toMatchObject({ ok: true, vorlesen: "Klima an, 22 Grad." });
    let st = (await (await fetch(`${TD}/__tesla`)).json()) as { temp: number; klimaAn: boolean };
    expect(st).toMatchObject({ temp: 22, klimaAn: true });
    expect(JSON.parse(await claude.call("auto_klima", { an: false }))).toMatchObject({ ok: true });
    st = (await (await fetch(`${TD}/__tesla`)).json()) as { temp: number; klimaAn: boolean };
    expect(st.klimaAn).toBe(false);
    // Tagesplan: Status erst auf Knopfdruck
    await page.goto("/kalender/tagesplan");
    await page.getByTestId("auto-status").getByRole("button").click();
    await expect(page.getByTestId("auto-status").getByRole("status")).toContainText("Akku 78 Prozent");

    // 10) Öffentlicher Schlüssel für Tesla unter /.well-known (nur ein öffentlicher Schlüssel wird ausgeliefert)
    await sql("update integrations set config = config || $1::jsonb where provider = 'tesla'", [JSON.stringify({ publicKey: "-----BEGIN PUBLIC KEY-----\nTESTSCHLUESSELERFUNDEN\n-----END PUBLIC KEY-----" })]);
    const pem = await fetch(`${B}/.well-known/appspecific/com.tesla.3p.public-key.pem`);
    expect(pem.status).toBe(200);
    expect(await pem.text()).toContain("TESTSCHLUESSELERFUNDEN");
  });

  test("B17: Anruf ohne Nummer – Rückfrage beim Anlegen, Vorschlag aus Mail-Signatur, auf der Startseite übernehmen", async ({ page, browser, baseURL }) => {
    test.setTimeout(90_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const firma = `Paketdienst${m}`;
    // Erfundene Mail mit Signatur (Telefon) – Quelle für den Vorschlag
    await sql("insert into emails (tenant_id, message_key, from_address, from_name, subject, received_at, body_text) values ($1, $2, $3, $4, 'Ihre Anfrage', now() - interval '2 days', $5)", [T, `tel-${m}`, `service@${firma.toLowerCase()}.example`, `${firma} Kundenservice`, "Guten Tag,\nvielen Dank für Ihre Anfrage zu Bestellung 302-1111111-2222222.\n\nMit freundlichen Grüßen\nIhr Team\nTel.: 0228 555 0100\nFax: 0228 555 0199"]);
    const claude = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const neu = JSON.parse(await claude.call("aufgabe_anlegen", { titel: `${firma} Geschäftskunden anrufen` }));
    expect(neu.rueckfrage).toContain("fehlt");
    expect(neu.telefon_vorschlag).toMatchObject({ nummer: "02285550100" });
    const [t] = await sql<{ id: string; telefon: string | null }>("select id, telefon from tasks where tenant_id = $1 and title = $2", [T, `${firma} Geschäftskunden anrufen`]);
    expect(t.telefon).toBeNull(); // Vorschlag wird nicht von selbst gespeichert
    const aa = JSON.parse(await claude.call("anruf_aufgaben", {}));
    const a = aa.anrufe.find((x: { id: string }) => x.id === t.id);
    expect(a.telefon_vorschlag.quelle).toContain("Signatur");
    // Startseite: „Nummer fehlt“ mit Vorschlag → übernehmen
    await anmelden(page, "inhaber");
    await page.goto("/?ansicht=liste");
    const zeile = page.getByTestId("task-row").filter({ hasText: `${firma} Geschäftskunden anrufen` });
    await zeile.getByTestId("anruf-telefon").locator("summary").click();
    await expect(zeile.getByTestId("anruf-telefon-quelle")).toContainText("Signatur");
    await Promise.all([page.waitForURL(/ansicht=liste/), zeile.getByTestId("anruf-telefon-speichern").click()]);
    expect((await sql<{ telefon: string | null }>("select telefon from tasks where id = $1", [t.id]))[0].telefon).toBe("02285550100");
    await expect(page.getByTestId("task-row").filter({ hasText: `${firma} Geschäftskunden anrufen` }).getByTestId("anruf-telefon")).toHaveCount(0);
    // Mit Nummer im Text: direkt gespeichert, keine Rückfrage
    const mit = JSON.parse(await claude.call("aufgabe_anlegen", { titel: `${firma} Lager anrufen`, telefon: "0228 555 0111" }));
    expect(mit.rueckfrage).toBeUndefined();
    expect(mit.aufgabe.telefon).toBe("02285550111");
  });
});
