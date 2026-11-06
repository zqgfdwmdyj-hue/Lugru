// Bauauftrag Rechnungsstation – Abnahmen 2 und 3: 50 Blätter nacheinander an der Station (Kamera-Weg, Bilder über die
// Prüf-Hilfe eingespeist, gleicher Upload/KI/Kachel-Weg) und ein PDF-Stapel mit 20 Rechnungen im Scanner-Ordner.
// KI-Nachbau liest den Text hinter „TESTOCR“. Alle Daten erfunden (Testgroßhandel, Testmarkt, B0TEST…).
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { E2E_ENV } from "./env";
import { alsPerson, anmelden, expect, marke, sql, test } from "./helfer";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const blatt = (text: string) => Buffer.concat([PNG, Buffer.from(`TESTOCR\n${text}`, "utf8")]).toString("base64");
const tenant = async () => (await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1"))[0].tenant_id;
const tag = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const de = (n: number) => n.toFixed(2).replace(".", ",");

test.describe("Rechnungsstation", () => {
  test("Abnahme 2: 50 Blätter → alle erfasst, ≥ 40 zugeordnet, Mehrseiter, Duplikat, Rest in der Prüfliste, Stotax nur grün/gelb, VA bedient", async ({ page }) => {
    test.setTimeout(300_000);
    const m = marke();
    const T = await tenant();
    const lieferant = `Testgroßhandel ${m} GmbH`;
    const datum = tag(-3);
    const betrag = (i: number) => 100.5 + i;
    // Einkäufe zum Zuordnen: 42 Bestellungen beim Testgroßhandel (wie ArbitrageOne/Deal-Käufe), je eigener Betrag
    const [{ id: sup }] = await sql<{ id: string }>("insert into suppliers (tenant_id, code, name) values ($1, $2, $3) returning id", [T, `TG${m}`, lieferant]);
    const poIds: string[] = [];
    for (let i = 1; i <= 42; i++) {
      const [{ id }] = await sql<{ id: string }>("insert into purchase_orders (tenant_id, number, supplier_id, status, order_date) values ($1, $2, $3, 'ordered', $4) returning id", [T, `PO-${m}-${i}`, sup, tag(-4)]);
      await sql("insert into purchase_order_items (tenant_id, po_id, quantity, unit_cost_gross, title) values ($1, $2, 1, $3, $4)", [T, id, betrag(i), `Testartikel ${i}`]);
      poIds.push(id);
    }
    await sql("delete from integrations where tenant_id = $1 and provider = 'stotax'", [T]);
    await sql("insert into integrations (tenant_id, provider, label, config, created_at) values ($1, 'stotax', 'Test', $2, now() - interval '1 day')", [T, JSON.stringify({ address: "belege-test@mail2select.de" })]);
    const rechnung = (i: number, extra = "") => {
      const b = betrag(i), n = Math.round((b / 1.19) * 100) / 100;
      return `ART: rechnung\nLIEFERANT: ${lieferant}\nNR: RE-${m}-${i}\nDATUM: ${datum}\nNETTO: ${de(n)}\nBRUTTO: ${de(b)}\nUST: 19 ${de(Math.round((b - n) * 100) / 100)}\nZIEL: 14\n${extra}`;
    };
    // 50 Blätter: 40 Rechnungen, 1 Zweiseiter (2 Blätter), 1 Rechnung mit ASIN, 4 Kassenzettel, 1 unsicher, 1 ohne Betrag, 1 Duplikat
    const blaetter: { text: string; versatz?: number }[] = [];
    for (let i = 1; i <= 40; i++) blaetter.push({ text: rechnung(i) });
    blaetter.push({ text: `ART: rechnung\nLIEFERANT: ${lieferant}\nNR: RE-${m}-41\nDATUM: ${datum}\nPOS: Testartikel Seite 1 | 1 | 50,00` });
    { const b = betrag(41), n = Math.round((b / 1.19) * 100) / 100; blaetter.push({ text: `NR: RE-${m}-41\nFOLGESEITE\nNETTO: ${de(n)}\nBRUTTO: ${de(b)}\nUST: 19 ${de(Math.round((b - n) * 100) / 100)}`, versatz: 2000 }); }
    blaetter.push({ text: rechnung(42, "POS: B0TEST0001 4000000000017 Testsocken | 10 | 2,10") });
    for (let k = 0; k < 4; k++) blaetter.push({ text: `ART: kassenzettel\nLIEFERANT: Testmarkt ${m}\nDATUM: ${datum}\nBRUTTO: ${de(12.34 + k)}\nUST: 19 1,97\nZAHLUNG: Karte` });
    blaetter.push({ text: `ART: rechnung\nLIEFERANT: Unsicher-Lieferant ${m}\nNR: RE-${m}-47\nDATUM: ${datum}\nBRUTTO: 47,47\nUNSICHER: datum` });
    blaetter.push({ text: `ART: rechnung\nLIEFERANT: Ohne-Betrag ${m}\nNR: RE-${m}-48\nDATUM: ${datum}` });
    blaetter.push({ text: rechnung(1, "(zweiter Scan desselben Papiers)") }); // gleiche Nummer, anderes Foto
    expect(blaetter).toHaveLength(50);

    const [{ buero_areas }] = await sql<{ buero_areas: string[] | null }>("select m.areas as buero_areas from memberships m join users u on u.id = m.user_id where u.email = 'buero'");
    try {
      // Die VA bedient die Station (Bereich Service)
      await sql("update memberships set areas = '[\"start\",\"service\"]'::jsonb where user_id = (select id from users where email = 'buero')");
      await anmelden(page, "buero");
      await page.goto("/rechnungsstation");
      await page.getByTestId("station-starten").click();
      await expect(page.getByTestId("station-stapel")).toContainText("Kamera");
      const start = Date.now();
      let t = Date.now();
      for (const [idx, b] of blaetter.entries()) {
        t = b.versatz ? t + b.versatz : Date.now() + idx * 6000;
        await page.evaluate(([b64, am]) => window.__rechnungsstation!.blatt(b64 as string, "image/png", am as number), [blatt(b.text), t] as const);
      }
      const [{ id: stapelId }] = await sql<{ id: string }>("select id from beleg_stapel where tenant_id = $1 and quelle = 'kamera' and gestartet_von_name = 'Bea Büro' order by created_at desc limit 1", [T]);
      // Alle gelesen (Kacheln haben eine Ampel)
      await expect.poll(async () => (await sql<{ n: number }>("select count(*)::int n from invoices where stapel_id = $1 and ampel is null", [stapelId]))[0].n, { timeout: 120_000 }).toBe(0);
      await expect.poll(async () => (await sql<{ n: number }>("select count(*)::int n from invoices where stapel_id = $1", [stapelId]))[0].n, { timeout: 30_000 }).toBe(49);
      await expect(page.getByTestId("station-kachel").first()).toBeVisible();
      await expect.poll(async () => page.getByTestId("station-kachel").count(), { timeout: 10_000 }).toBe(49);
      await expect(page.locator('[data-testid="station-kachel"][data-ampel="liest"]')).toHaveCount(0);
      // Stapelende: Zusammenfassung als Aufgabe
      await page.getByTestId("station-fertig").click();
      await expect(page.getByTestId("station-info")).toContainText("Stapel fertig: 49 Belege");
      await expect(page.getByTestId("station-info")).toContainText("2 unklar");
      const dauer = Date.now() - start;
      expect(dauer).toBeLessThan(10 * 60_000);

      const [aufgabe] = await sql<{ title: string; link: string; status: string }>("select title, link, status from tasks where tenant_id = $1 and system_key = $2", [T, `rechnungsstapel:${stapelId}`]);
      expect(aufgabe.title).toMatch(/^Rechnungsstapel prüfen: 49 Belege, .* 2 unklar$/);
      expect(aufgabe).toMatchObject({ status: "open", link: `/rechnungsstation/pruefen?stapel=${stapelId}` });

      const belege = await sql<{ nr: string | null; vendor: string | null; brutto: string | null; datum: string | null; ampel: string; zugeordnet: boolean; seiten: number; kind: string; doc_type: string; dup: boolean; po: string | null; text: string | null }>(
        "select invoice_number nr, vendor, total_gross::text brutto, invoice_date::text datum, ampel, zugeordnet_am is not null zugeordnet, seiten, kind, doc_type, (checks->'duplicateOf') is not null dup, zuordnung->>'id' po, text_excerpt text from invoices where stapel_id = $1",
        [stapelId],
      );
      // alle erfasst: Lieferant, Betrag und Datum gelesen (außer dem ohne Betrag)
      expect(belege.filter((b) => b.vendor && b.datum).length).toBe(49);
      expect(belege.filter((b) => b.brutto !== null).length).toBe(48);
      // ≥ 40 automatisch zugeordnet (hier 42: 40 + Zweiseiter + ASIN-Rechnung)
      const zugeordnet = belege.filter((b) => b.zugeordnet);
      expect(zugeordnet.length).toBeGreaterThanOrEqual(40);
      expect(zugeordnet.length).toBe(42);
      const po = await sql<{ number: string; invoice_id: string | null }>("select number, invoice_id from purchase_orders where id = any($1::uuid[]) order by number", [poIds]);
      expect(po.filter((p) => p.invoice_id).length).toBe(42);
      // Mehrseiter: zweites Blatt ≤ 5 s mit gleicher Rechnungsnummer angehängt → ein Beleg, 2 Seiten, zugeordnet
      const zwei = belege.find((b) => b.nr === `RE-${m}-41`)!;
      expect(zwei).toMatchObject({ seiten: 2, ampel: "gruen", zugeordnet: true });
      expect(Number(zwei.brutto)).toBeCloseTo(betrag(41), 2);
      // ASIN: an die Charge gehängt (VA/wissen finden die Rechnung am ASIN)
      const asin = belege.find((b) => b.nr === `RE-${m}-42`)!;
      expect(asin.text).toContain("ASIN: B0TEST0001");
      const [{ n: anCharge }] = await sql<{ n: number }>("select count(*)::int n from invoice_lots il join invoices i on i.id = il.invoice_id join lots l on l.id = il.lot_id where i.stapel_id = $1 and l.sku = 'TEST-SOCKEN'", [stapelId]);
      expect(anCharge).toBe(1);
      // Kassenzettel: Ausgabe, grün, ohne Einkauf
      expect(belege.filter((b) => b.doc_type === "quittung").map((b) => [b.ampel, b.kind])).toEqual(Array(4).fill(["gruen", "expense"]));
      // Duplikat und fehlender Betrag rot, Unsicheres gelb
      expect(belege.filter((b) => b.ampel === "rot").map((b) => (b.dup ? "duplikat" : b.nr))).toEqual(expect.arrayContaining(["duplikat", `RE-${m}-48`]));
      expect(belege.filter((b) => b.ampel === "gelb").map((b) => b.nr)).toEqual([`RE-${m}-47`]);

      // Rest in der Prüfliste (Bild daneben): 1 gelb, 2 rot
      await page.getByTestId("station-pruefliste").click();
      await expect(page).toHaveURL(new RegExp(`/rechnungsstation/pruefen\\?stapel=${stapelId}`));
      await expect(page.getByTestId("pruef-beleg")).toHaveCount(3);
      await expect(page.locator('[data-testid="pruef-beleg"][data-ampel="rot"]')).toHaveCount(2);
      await expect(page.getByTestId("pruef-duplikat")).toContainText(`RE-${m}-1 schon erfasst`);
      await expect(page.getByTestId("pruef-beleg").first().locator("img")).toBeVisible();

      // Weitergabe (Takt „Belege an Stotax“, hier sofort ausgelöst): grün + gelb, rot nicht
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("jetzt-weitergeben").click()]);
      await expect(page.getByTestId("pruef-meldung")).toContainText("An Stotax übertragen: 47");
      const st = await sql<{ ampel: string; gesendet: boolean }>("select ampel, stotax_sent_at is not null gesendet from invoices where stapel_id = $1", [stapelId]);
      expect(st.filter((x) => x.gesendet).length).toBe(47);
      expect(st.filter((x) => x.ampel === "rot" && x.gesendet).length).toBe(0);
      // Gelbe Mail ging an Mail2Select (Text mit Vermerk liegt verschlüsselt vor – Inhalt prüft tests/rechnungsstation.test.ts)
      const [gelbMail] = await sql<{ subject: string; an: string }>("select subject, \"to\" an from test_mails where tenant_id = $1 and subject like $2 order by created_at desc limit 1", [T, `%RE-${m}-47%`]);
      expect(gelbMail.subject).toContain(`Unsicher-Lieferant ${m}`);

      // Prüfen: fehlender Betrag nachtragen → grün, sofort an Stotax; Duplikat → „Kein Beleg“; gelb freigeben
      const ohne = page.getByTestId("pruef-beleg").filter({ has: page.locator(`input[value="RE-${m}-48"]`) });
      await ohne.getByTestId("pruef-brutto").fill("48,48");
      await Promise.all([page.waitForURL(/meldung=/), ohne.getByTestId("pruef-speichern").click()]);
      await expect(page.getByTestId("pruef-meldung")).toContainText("Geprüft: Ohne-Betrag");
      const [g48] = await sql<{ ampel: string; geprueft: string; gesendet: boolean }>("select ampel, geprueft_von_name geprueft, stotax_sent_at is not null gesendet from invoices where stapel_id = $1 and invoice_number = $2", [stapelId, `RE-${m}-48`]);
      expect(g48).toEqual({ ampel: "gruen", geprueft: "Bea Büro", gesendet: true });
      page.once("dialog", (d) => d.accept());
      await Promise.all([page.waitForURL(/meldung=/), page.locator('[data-testid="pruef-beleg"]').filter({ has: page.getByTestId("pruef-duplikat") }).getByTestId("pruef-verwerfen").click()]);
      await expect(page.getByTestId("pruef-meldung")).toContainText("kein Beleg");
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("pruef-beleg").getByTestId("pruef-speichern").click()]);
      await expect(page.getByTestId("pruef-beleg")).toHaveCount(0);
      // Stapel erledigt → Aufgabe schließt sich; Status je Beleg in der Liste
      await expect.poll(async () => (await sql<{ status: string }>("select status from tasks where tenant_id = $1 and system_key = $2", [T, `rechnungsstapel:${stapelId}`]))[0].status).toBe("done");
      await expect(page.locator('[data-testid="stapel-beleg"][data-status="stotax"]')).toHaveCount(48);
    } finally {
      await sql("update memberships set areas = $1::jsonb where user_id = (select id from users where email = 'buero')", [JSON.stringify(buero_areas)]);
      await sql("delete from integrations where tenant_id = $1 and provider = 'stotax'", [T]);
    }
  });

  test("Abnahme 3: PDF-Stapel mit 20 Rechnungen im Scanner-Ordner → 20 Belege; Rechte", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const m = marke();
    const T = await tenant();
    // 22 Seiten: 18 einseitige + 2 zweiseitige Rechnungen
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const seiten: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const zweiseitig = i === 5 || i === 13;
      const b = 20 + i;
      seiten.push(`ART: rechnung\nLIEFERANT: Scanlieferant ${m}\nNR: SC-${m}-${i}\nDATUM: ${tag(-5)}${zweiseitig ? "" : `\nBRUTTO: ${de(b)}`}`);
      if (zweiseitig) seiten.push(`NR: SC-${m}-${i}\nFOLGESEITE\nBRUTTO: ${de(b)}`);
    }
    seiten.forEach((_, n) => doc.addPage([595, 842]).drawText(`Testseite ${n + 1}`, { x: 50, y: 780, size: 14, font }));
    const pdf = Buffer.concat([Buffer.from(await doc.save()), Buffer.from(`\nTESTOCR\n${seiten.map((s, n) => `=== SEITE ${n + 1} ===\n${s}`).join("\n")}`, "utf8")]);
    const ordner = E2E_ENV.BELEG_EINGANG_DIR;
    mkdirSync(ordner, { recursive: true });
    const name = `stapel-${m}.pdf`;
    writeFileSync(path.join(ordner, name), pdf);

    await anmelden(page, "inhaber");
    await page.goto("/rechnungsstation/pruefen");
    await Promise.all([page.waitForURL(/meldung=|fehler=/), page.getByTestId("ordner-pruefen").click()]);
    await expect(page.getByTestId("pruef-meldung")).toContainText("1 PDF aus dem Scanner-Ordner: 20 Belege");
    const [st] = await sql<{ id: string; quelle: string; beendet: boolean }>("select id, quelle, beendet_am is not null beendet from beleg_stapel where tenant_id = $1 and name = $2", [T, name]);
    expect(st).toMatchObject({ quelle: "ordner", beendet: true });
    const belege = await sql<{ nr: string; seiten: number; ampel: string; brutto: string }>("select invoice_number nr, seiten, ampel, total_gross::text brutto from invoices where stapel_id = $1 order by external_id", [st.id]);
    expect(belege).toHaveLength(20);
    expect(belege.reduce((s, b) => s + b.seiten, 0)).toBe(22);
    expect(belege.filter((b) => b.seiten === 2).map((b) => b.nr).sort()).toEqual([`SC-${m}-13`, `SC-${m}-5`]);
    expect(belege.every((b) => b.ampel === "gruen" && b.brutto !== null)).toBe(true);
    // Original verschoben (nicht noch einmal verarbeiten)
    expect(readdirSync(ordner)).not.toContain(name);
    expect(readdirSync(path.join(ordner, "verarbeitet")).some((f) => f.endsWith(name))).toBe(true);
    await page.goto(`/rechnungsstation/pruefen?stapel=${st.id}`);
    await expect(page.getByTestId("stapel-beleg")).toHaveCount(20);

    // Rechte: Lager (ohne Service/Buchhaltung/Geld) kommt nicht hinein und darf nichts hochladen
    const lp = await alsPerson(browser, "lager");
    await lp.goto("/rechnungsstation");
    await expect(lp).toHaveURL(/gesperrt=1/);
    const r = await lp.request.post("/api/rechnungsstation?aktion=start");
    expect(r.status()).toBe(403);
    await lp.context().close();
  });
});
