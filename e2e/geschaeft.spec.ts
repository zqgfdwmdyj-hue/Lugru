// Neue Claude-Werkzeuge: Antwort-Entwurf (gesendet wird nur nach Prüfung im Seller-System), Mails archivieren,
// Anspruch als eingereicht markieren, BQool-Export + Werkzeug „repricer“, Amazon je Land (Buy Box, Listung,
// Lageralter über Berichte; Angebote live) – gegen die Testdienste. Dazu die Rechte im Fragefeld.
import { aktion, alsPerson, expect, marke, mcpVerbinden, sql, test, testdienste } from "./helfer";

const mailId = async (key: string) => (await sql<{ id: string }>("select id from emails where message_key = $1", [key]))[0].id;
const ANFRAGE = "<testanfrage-1@example.invalid>";

test.describe("Claude & KI-Assistent – Posteingang und Ansprüche", () => {
  test("Antwort-Entwurf über Claude: erscheint an der Mail, Senden nur mit Häkchen, landet in den Test-Mails", async ({ page, browser, baseURL }) => {
    const m = marke();
    const id = await mailId(ANFRAGE);
    const c = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });

    // Ganze Mail lesen
    const mail = JSON.parse(await c.call("mail", { id }));
    expect(mail.text).toContain("200 Stück ab KW 46");
    expect(mail.link).toBe(`${baseURL}/posteingang/${id}`);

    // Entwurf anlegen – nichts wird gesendet
    const d = JSON.parse(await c.call("posteingang_entwurf", { id, text: `Hallo, KW 46 passt. Gruß ${m}` }));
    expect(d).toMatchObject({ ok: true, an: "lieferant@example.invalid", betreff: "Re: Testanfrage: Lieferzeit Testsocken", link: `${baseURL}/posteingang/${id}#entwurf` });
    expect(d.meldung).toContain("nicht gesendet");
    const [row] = await sql<{ via: string; sent_at: Date | null }>("select via, sent_at from email_drafts where id = $1", [d.entwurf_id]);
    expect(row).toEqual({ via: "claude", sent_at: null });
    // Text der Test-Mails ist verschlüsselt gespeichert → nach Empfänger, Betreff und Zeitpunkt zählen
    const [{ t0 }] = await sql<{ t0: Date }>("select now() t0");
    const gesendet = async () => (await sql<{ n: number }>("select count(*)::int n from test_mails where \"to\" = 'lieferant@example.invalid' and subject = 'Re: Testanfrage: Lieferzeit Testsocken' and created_at >= $1", [t0]))[0].n;
    expect(await gesendet()).toBe(0);

    // Im Seller-System: Entwurf sichtbar; ohne Häkchen wird nicht gesendet
    const { anmelden } = await import("./helfer");
    await anmelden(page, "inhaber");
    await page.goto(`/posteingang/${id}`);
    const form = page.locator('[data-testid="draft-form"]').filter({ has: page.locator(`textarea:has-text("${m}")`) });
    await expect(form).toBeVisible();
    await Promise.all([page.waitForURL(/entwurf=nicht-bestaetigt/), form.locator('[data-testid="draft-send"]').click()]);
    await expect(page.locator('[data-testid="draft-msg"]')).toBeVisible();
    expect(await gesendet()).toBe(0);

    // Mit Häkchen: gesendet (Testumgebung → Test-Mails), als gesendet markiert, Formular weg
    const form2 = page.locator('[data-testid="draft-form"]').filter({ has: page.locator(`textarea:has-text("${m}")`) });
    await form2.locator('input[name="geprueft"]').check();
    await Promise.all([page.waitForURL(/entwurf=gesendet/), form2.locator('[data-testid="draft-send"]').click()]);
    await expect(page.locator('[data-testid="draft-sent"]').filter({ hasText: "lieferant@example.invalid" }).first()).toBeVisible();
    expect(await gesendet()).toBe(1);
    const [dr] = await sql<{ sent_at: Date | null; body: string }>("select sent_at, body from email_drafts where id = $1", [d.entwurf_id]);
    expect(dr.sent_at).not.toBeNull();
    expect(dr.body).toContain(m);
    // Gesendeter Entwurf lässt sich nicht noch einmal senden (kein Formular mehr)
    await expect(page.locator('[data-testid="draft-form"]').filter({ has: page.locator(`textarea:has-text("${m}")`) })).toHaveCount(0);
  });

  test("Archivieren und „Anspruch eingereicht“ über Claude; ohne Freigabe „ändern“ abgewiesen; Protokoll am Anspruch", async ({ browser, baseURL }) => {
    const m = marke();
    // Testanspruch aus den Testdaten – Importe in früheren Prüfungen (Nachbearbeitung „Ansprüche“) können ihn entfernen.
    await sql(
      "insert into claims (tenant_id, type, status, detection_key, title, sku, fnsku, asin, quantity, unit_cost, expected_amount, event_date, deadline) select tenant_id, 'lost_warehouse', 'detected', 'test-verloren-1', 'Testanspruch: 3 Testsocken im Lager verloren (erfunden)', 'TEST-SOCKEN', 'X00TEST0001', 'B0TEST0001', 3, 2.1, 29.97, current_date - 20, current_date + 5 from lots where sku = 'TEST-SOCKEN' and not exists (select 1 from claims where detection_key = 'test-verloren-1') limit 1",
    );
    const [claim] = await sql<{ id: string }>("select id from claims where detection_key = 'test-verloren-1'");
    const lesen = await mcpVerbinden(browser, baseURL!, "inhaber");
    expect(await lesen.tools()).not.toContain("anspruch_eingereicht");
    expect(await lesen.call("anspruch_eingereicht", { id: claim.id })).toMatch(/ändern|freigegeben|nicht/i);
    expect((await sql<{ status: string }>("select status from claims where id = $1", [claim.id]))[0].status).toBe("detected");

    // Anspruch mit Link je Anspruch im Lese-Werkzeug
    const liste = JSON.parse(await lesen.call("ansprueche", {}));
    expect(JSON.stringify(liste)).toContain(`${baseURL}/ansprueche/${claim.id}`);

    const c = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const r = JSON.parse(await c.call("anspruch_eingereicht", { id: claim.id, fallnummer: `TEST${m}`, notiz: "Testnotiz" }));
    expect(r).toMatchObject({ ok: true, status: "eingereicht", fallnummer: `TEST${m}`, link: `${baseURL}/ansprueche/${claim.id}` });
    const [db] = await sql<{ status: string; amazon_case_id: string; submitted_at: Date | null }>("select status, amazon_case_id, submitted_at from claims where id = $1", [claim.id]);
    expect(db.status).toBe("submitted");
    expect(db.amazon_case_id).toBe(`TEST${m}`);
    expect(db.submitted_at).not.toBeNull();
    const ev = await sql<{ action: string; note: string }>("select action, note from claim_events where claim_id = $1 order by created_at desc limit 1", [claim.id]);
    expect(ev[0]).toEqual({ action: `eingereicht (Fall TEST${m}) – über Claude`, note: "Testnotiz" });
    // Zweimal: bleibt eingereicht, Hinweis statt Fehler
    expect(JSON.parse(await c.call("anspruch_eingereicht", { id: claim.id })).meldung).toContain("schon eingereicht");

    // Archivieren
    const news = await mailId("<testnewsletter-1@example.invalid>");
    const a = JSON.parse(await c.call("posteingang_archivieren", { ids: [news] }));
    expect(a).toMatchObject({ ok: true, archiviert: 1 });
    expect((await sql<{ archived: boolean }>("select archived from emails where id = $1", [news]))[0].archived).toBe(true);
    expect(JSON.parse(await c.call("posteingang_archivieren", { ids: [news] }))).toMatchObject({ archiviert: 0, nicht_gefunden_oder_schon_archiviert: 1 });
  });
});

test.describe("Claude & KI-Assistent – BQool und Amazon je Land", () => {
  test("BQool-Export hochladen → Repricer-Abschnitt → Werkzeug „repricer“ mit Auffälligkeiten", async ({ page, browser, baseURL }) => {
    const { anmelden } = await import("./helfer");
    await anmelden(page, "inhaber");
    await page.goto("/repricer");
    const csv = ["SKU,ASIN,Product Name,Your Price,Min Price,Max Price,Strategy Name,Repricing Status,Buy Box Winner", "TEST-SOCKEN,B0TEST0001,Testsocken (erfunden),21.99,19.50,29.99,Standard,Active,You", "TEST-TASSE,B0TEST0002,Testtasse (erfunden),14.90,,19.90,,Paused,A1TESTFBA00001", ""].join("\n");
    const up = page.locator('[data-testid="bqool-upload"]');
    await up.locator('input[type="file"]').setInputFiles({ name: "bqool-manage-listings.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await up.locator('select[name="markt"]').selectOption("DE");
    await Promise.all([aktion(page), up.locator('button[type="submit"]').click()]);
    await expect(page.locator('[data-testid="bqool-result"]')).toContainText("2 SKUs eingelesen (DE 2)");
    await expect(page.locator('[data-testid="bqool-problems"]')).toContainText("TEST-TASSE");

    const c = await mcpVerbinden(browser, baseURL!, "inhaber");
    const r = JSON.parse(await c.call("repricer", {}));
    expect(r.anzahl_skus).toBe(2);
    // Min der Socken liegt weit über jedem denkbaren Mindestpreis des Seller-Systems → unauffällig
    expect(r.auffaelligkeiten).toEqual({ ohne_min: 1, pausiert: 1, ohne_regel: 1 });
    const tasse = r.zeilen.find((z: { sku: string }) => z.sku === "TEST-TASSE");
    expect(tasse).toMatchObject({ marktplatz: "DE", status: "pausiert", min_bqool: null, max_bqool: 19.9, buybox_bei: "A1TESTFBA00001" });
    expect(tasse.pruefen).toEqual(expect.arrayContaining(["kein Mindestpreis in BQool", "Bepreisung in BQool pausiert", "keine Regel/Strategie zugeordnet"]));
    expect(r.zeilen.find((z: { sku: string }) => z.sku === "TEST-SOCKEN")).toBeUndefined();
    const alle = JSON.parse(await c.call("repricer", { ansicht: "alle", suche: "socken" }));
    expect(alle.zeilen).toHaveLength(1);
    expect(alle.zeilen[0]).toMatchObject({ sku: "TEST-SOCKEN", preis: 21.99, min_bqool: 19.5, max_bqool: 29.99, regel: "Standard", status: "aktiv", buybox_bei: "uns" });
    expect(r.datenstand.stand).toContain("BQool-Export eingelesen");
    expect(r.upload_datei).toBe(`${baseURL}/repricer/export?format=bqool`);
  });

  test("Amazon je Land: Berichte anfordern + abholen → amazon_buybox, amazon_listungen, amazon_lageralter; amazon_angebote live", async ({ page, browser, baseURL }) => {
    const { anmelden } = await import("./helfer");
    await anmelden(page, "inhaber");
    await page.goto("/anbindungen");
    const box = page.locator('[data-testid="amazon-berichte"]');
    await box.locator('select[name="bericht"]').selectOption("alle");
    await Promise.all([page.waitForURL(/amz=angefordert/), box.getByRole("button", { name: "Anfordern" }).click()]);
    await expect(page.locator('[data-testid="amazon-berichte-msg"]')).toContainText("6 Berichte je Land angefordert");
    await Promise.all([page.waitForURL(/amz=abgeholt/), page.getByRole("button", { name: "Fertige Berichte abholen" }).click()]);
    // Die Hintergrund-Abrufe können einzelne Berichte schon vorher abgeholt haben – entscheidend ist, was gespeichert ist.
    await expect(page.locator('[data-testid="amazon-berichte-msg"]')).toBeVisible();
    await expect(page.locator("table").getByText("Buy-Box-Anteil (Sales and Traffic) FR").first()).toBeVisible();
    await expect.poll(async () => (await sql<{ n: number }>("select count(distinct land)::int n from amazon_lageralter")).at(0)?.n).toBe(2);

    const c = await mcpVerbinden(browser, baseURL!, "inhaber");
    // Buy Box: gzip-JSON je Land, aufsteigend sortiert
    const bb = JSON.parse(await c.call("amazon_buybox", { sortierung: "buybox_aufsteigend" }));
    expect(bb.anzahl).toBe(3);
    expect(bb.zeilen[0]).toMatchObject({ land: "DE", asin: "B0TEST0002", sku: "TEST-TASSE", buybox_prozent: 41.2, sitzungen: 240, einheiten: 6, umsatz: 89.4, waehrung: "EUR" });
    expect(bb.zeitraum.von).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bb.laender_der_anbindung).toEqual(["DE", "FR"]);
    expect(bb.datenstand.stand).toMatch(/DE .*FR|FR .*DE/);
    expect(JSON.parse(await c.call("amazon_buybox", { buybox_unter: 50 })).anzahl).toBe(1);
    expect(JSON.parse(await c.call("amazon_buybox", { land: "FR", asin: "b0test0001" })).zeilen[0]).toMatchObject({ buybox_prozent: 63 });

    // Listung: deutsche Spalten (DE), englische (FR); Tasse fehlt in FR, Kabel ist nirgends aktiv
    const li = JSON.parse(await c.call("amazon_listungen", {}));
    expect(li.laender_mit_bericht.sort()).toEqual(["DE", "FR"]);
    expect(li.skus).toEqual([expect.objectContaining({ sku: "TEST-TASSE", aktiv: ["DE"], fehlt: ["FR"] })]);
    const liAlle = JSON.parse(await c.call("amazon_listungen", { ansicht: "alle", suche: "kabel" }));
    expect(liAlle.skus[0].laender).toEqual({ DE: "inaktiv (FBM) 4.99", FR: "inaktiv (FBM) 5.49" });

    // Lageralter: nur SKUs mit Aufschlag/über 180 Tage
    const la = JSON.parse(await c.call("amazon_lageralter", {}));
    expect(la.summe).toMatchObject({ aufschlag_geschaetzt: 3.42, skus_mit_aufschlag: 1 });
    expect(la.zeilen).toHaveLength(1);
    expect(la.zeilen[0]).toMatchObject({ land: "DE", sku: "TEST-SOCKEN", stueck_ueber_180_tage: 6, stueck_mit_aufschlag: 6, empfehlung_amazon: "Create removal order" });
    expect(JSON.parse(await c.call("amazon_lageralter", { nur_aufschlag: false })).anzahl).toBe(3);

    // Angebote live: wir haben die Buy Box in DE; zweiter Aufruf aus dem Zwischenspeicher
    const preisAufrufe = async () => (await testdienste.log()).filter((x) => x.path.includes("/products/pricing/")).length;
    const n0 = await preisAufrufe();
    const an = JSON.parse(await c.call("amazon_angebote", { asin: "B0TEST0001" }));
    expect(an.laender[0]).toMatchObject({ land: "DE", buybox_preis: 9.99, buybox_bei: "uns", angebote_neu: 3, angebote_fba: 2, angebote_fbm: 1, niedrigster_fbm: 11.98, amazon_bietet_mit: false, rang: 1234 });
    expect(an.laender[0].top_angebote).toHaveLength(3);
    expect(an.datenstand.stand).toContain("gerade bei Amazon abgerufen");
    expect(JSON.parse(await c.call("amazon_angebote", { asin: "B0TEST0001" })).datenstand.stand).toContain("Zwischenspeicher");
    expect(await preisAufrufe()).toBe(n0 + 1);
    const alle = JSON.parse(await c.call("amazon_angebote", { asin: "B0TEST0002", land: "alle" }));
    expect(alle.laender.map((l: { land: string; buybox_bei: string }) => `${l.land}:${l.buybox_bei}`)).toEqual(["DE:Amazon", "FR:Amazon"]);
    const fehlt = JSON.parse(await c.call("amazon_angebote", { asin: "B0FEHLT001" }));
    expect(fehlt.laender[0].fehler).toContain("InvalidInput");
  });

  test("Rechte im Fragefeld: Büro (ohne Amazon) bekommt Posteingang/Repricer/Angebote live, aber nicht Buy Box, Listung, Lageralter, Ansprüche", async ({ browser }) => {
    const m = marke();
    const bp = await alsPerson(browser, "buero");
    const antworten = () => bp.locator('[data-testid="asst-msg-assistant"]').count();
    const n = await antworten();
    await bp.fill('[data-testid="asst-input"]', `werkzeug:amazon_buybox {} ${m}-AA`);
    await bp.keyboard.press("Enter");
    await expect.poll(antworten).toBeGreaterThan(n);
    await expect(bp.locator('[data-testid="asst-status"]')).toHaveCount(0);
    expect((await bp.locator('[data-testid="asst-msg-assistant"]').allTextContents()).at(-1)).toContain("nicht freigegeben");
    const tools = (await testdienste.kiZu(`${m}-AA`))!.tools;
    // amazon_angebote gehört zur Lieferanten-Abfrage (Einkauf) – die ist in „Wawi“ enthalten
    expect(tools).toEqual(expect.arrayContaining(["mail", "posteingang_entwurf", "posteingang_archivieren", "repricer", "bestellvorschlaege", "amazon_angebote"]));
    for (const t of ["amazon_buybox", "amazon_listungen", "amazon_lageralter", "anspruch_eingereicht", "anbindungen_status", "sas", "fba_sendungen"]) expect(tools, t).not.toContain(t);
  });
});
