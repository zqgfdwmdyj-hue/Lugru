// Teil 2 – Geld, Risiko, Team, Familie (Module 13–23). Alles mit erfundenen Daten (Testmarke, TEST-SKUs).
import { aktion, alsPerson, anmelden, expect, sql, test } from "./helfer";
import { createZip } from "../src/lib/ebay/export/zip";

const TAG = 86_400_000;
const iso = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const heute = () => iso(new Date());
const tag = (n: number) => iso(new Date(Date.now() + n * TAG));
const de = (isoTag: string) => `${isoTag.slice(8, 10)}.${isoTag.slice(5, 7)}.${isoTag.slice(2, 4)}`;
const tenant = async () => (await sql<{ id: string }>("select id from tenants order by created_at limit 1"))[0].id;

// Sparkasse CSV-CAMT (erfunden): Amex jeweils am 15., Miete am 1.
const KOPF = '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';
const zeile = (t: string, text: string, zweck: string, gl: string, mandat: string, name: string, betrag: string) => `"DE00123456780000000001";"${t}";"${t}";"${text}";"${zweck}";"${gl}";"${mandat}";"";"";"";"";"${name}";"DE00999999990000000002";"TESTDEFFXXX";"${betrag}";"EUR";"Umsatz gebucht"`;
function kontoauszug() {
  const monat = (n: number, d: number) => {
    const x = new Date();
    x.setUTCDate(1);
    x.setUTCMonth(x.getUTCMonth() - n);
    x.setUTCDate(d);
    return iso(x);
  };
  const z = [KOPF];
  for (const n of [1, 2, 3]) {
    z.push(zeile(de(monat(n, 15)), "LASTSCHRIFT", "Kartenabrechnung", "DE11AMX00000000001", "AMX-TEST-1", "American Express Europe S.A.", "-3.800,00"));
    z.push(zeile(de(monat(n, 1)), "LASTSCHRIFT", "Miete Lager", "DE22ZZZ00000000002", "LAGER-1", "Test Immobilien GmbH", "-950,00"));
  }
  return Buffer.from(z.join("\r\n"), "latin1");
}

test.describe("Teil 2 – Geld & Risiko", () => {
  test("Liquidität: Kontoauszug, Amex erkannt, Einkauf in der Amex-Woche → Woche rot (Reserve unterschritten)", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/cashflow");
    await page.getByTestId("ka-datei").setInputFiles({ name: "umsaetze-test.csv", mimeType: "text/csv", buffer: kontoauszug() });
    await page.getByTestId("ka-saldo").fill("9000");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("ka-einlesen").click()]);
    await expect(page.getByTestId("liqui-meldung")).toContainText("Buchungen");
    await expect(page.getByTestId("cash-start-state")).toContainText("aus Kontoauszug");
    await expect(page.getByTestId("wiederkehrend")).toContainText("American Express");
    // Großer Einkauf am nächsten Amex-Termin
    const d = new Date();
    if (d.getDate() >= 15) d.setMonth(d.getMonth() + 1);
    d.setDate(15);
    await page.goto(`/cashflow?was=Testeinkauf&betrag=12000&datum=${iso(d)}`);
    await expect(page.getByTestId("ww-ergebnis")).toContainText("unterschritten");
    await expect(page.getByTestId("woche-ampel").filter({ hasText: "unter Reserve" }).first()).toBeVisible();
  });

  test("Kapital-Ampel: Ladenhüter rot mit Vorschlägen; Verlust-Stopp: Fall → Ausnahme mit Wochensumme", async ({ page }) => {
    const T = await tenant();
    await sql(
      `insert into sellerboard_products (tenant_id, sb_id, sku, asin, name, cost, price, fba_fee, referral_fee, vat_pct, synced_at) values
       ($1, 'T2-KAP', 'TEST-KAPITAL', 'B0TESTKAP1', 'Testmarke Kapitaltopf (erfunden)', 5, 19.99, -3, -3, 19, now()),
       ($1, 'T2-VER', 'TEST-VERLUST', 'B0TESTVER1', 'Testmarke Verlustdose (erfunden)', 9, 12.99, -3.5, -2, 19, now()),
       ($1, 'T2-VER2', 'TEST-VERLUST2', 'B0TESTVER2', 'Testmarke Abverkaufsdose (erfunden)', 9, 11.99, -3.5, -2, 19, now())`,
      [T],
    );
    await sql(`insert into sellerboard_inventory (tenant_id, sb_id, sku, asin, name, fba_stock, sales_velocity, synced_at) values ($1, 'T2-KAP-INV', 'TEST-KAPITAL', 'B0TESTKAP1', 'Testmarke Kapitaltopf (erfunden)', 200, 0.5, now())`, [T]);
    await sql(`insert into sellerboard_sku_months (tenant_id, month, sku, asin, name, units, sales, net_profit, synced_at) values ($1, $2, 'TEST-KAPITAL', 'B0TESTKAP1', 'Testmarke Kapitaltopf (erfunden)', 15, 299.85, 30, now())`, [T, heute().slice(0, 7)]);
    for (const [sku, werte] of [["TEST-VERLUST", [-2, 1, -1.5]], ["TEST-VERLUST2", [-3, -2, -4]]] as const)
      for (const [i, g] of werte.entries()) await sql(`insert into sellerboard_sku_tage (tenant_id, channel, day, sku, asin, name, units, sales, net_profit, avg_price, synced_at) values ($1, 'amazon', $2, $3, null, $4, 2, 25, $5, 12.5, now())`, [T, tag(i - 3), sku, `Testmarke ${sku}`, g]);

    await anmelden(page, "inhaber");
    await page.goto("/kapital?filter=rot");
    const z = page.locator('[data-testid="kapital-zeile"][data-sku="TEST-KAPITAL"]');
    await expect(z).toHaveAttribute("data-ampel", "rot");
    await expect(z.getByTestId("kapital-vorschlaege")).toContainText("Nicht nachbestellen");

    await page.goto("/verlust");
    await expect(page.locator('[data-testid="verlust-fall"][data-sku="TEST-VERLUST2"]')).toContainText("3 von 3 Tagen im Minus");
    await expect(page.locator('[data-testid="verlust-fall"][data-sku="TEST-VERLUST"]')).toContainText("2 von 3 Tagen im Minus");
    // Bewusster Abverkauf → Ausnahme; die Aufgabe dafür wird erledigt, die andere bleibt wichtig + offen
    const fall = page.locator('[data-testid="verlust-fall"][data-sku="TEST-VERLUST2"]');
    await fall.locator("summary").click();
    await fall.getByTestId("verlust-grund").fill("Abverkauf (Test)");
    await Promise.all([page.waitForURL(/meldung=/), fall.getByTestId("verlust-ausnahme").click()]);
    await expect(page.locator('[data-testid="verlust-ausnahme-zeile"][data-sku="TEST-VERLUST2"]')).toContainText("Abverkauf (Test)");
    const tasks = await sql<{ system_key: string; status: string; priority: string }>("select system_key, status, priority from tasks where system_key like 'verlust-%' order by system_key");
    expect(tasks).toContainEqual({ system_key: "verlust-TEST-VERLUST", status: "open", priority: "critical" });
    expect(tasks.find((t) => t.system_key === "verlust-TEST-VERLUST2")).toBeUndefined();
  });

  test("Echtheits-Ordner: Marke anlegen, Rechnung erkannt, Abdeckung, Audit-Paket (ZIP)", async ({ page, baseURL }) => {
    const T = await tenant();
    await sql(`insert into invoices (tenant_id, source, file_name, kind, status, doc_type, invoice_date, invoice_number, vendor, text_excerpt, total_gross) values ($1, 'upload', 'testrechnung-testmarke.pdf', 'goods', 'matched', 'rechnung', $2, 'RE-TEST-1', 'Testgroßhandel (erfunden)', 'Pos 1 Testmarke Kapitaltopf 10 Stk 5,00 € 50,00 €', 59.5)`, [T, tag(-40)]);
    await anmelden(page, "inhaber");
    await page.goto("/echtheit");
    await page.getByTestId("echtheit-marke").fill("Testmarke");
    await Promise.all([page.waitForURL(/\/echtheit\/[0-9a-f-]{36}/), page.getByTestId("echtheit-anlegen").click()]);
    await expect(page.getByTestId("echtheit-titel")).toHaveText("Testmarke");
    await expect(page.getByTestId("echtheit-beleg").first()).toContainText("Testgroßhandel");
    await expect(page.getByTestId("echtheit-abdeckung-tabelle")).toContainText("TEST-KAPITAL");
    const href = await page.getByTestId("echtheit-paket").getAttribute("href");
    const r = await page.request.get(`${baseURL}${href}`);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("application/zip");
    expect((await r.body()).subarray(0, 2).toString()).toBe("PK");
  });

  test("Amazon Business: Geschäftsbericht hochladen, Staffelpreise mit Gewinnprüfung, Freigabe, Upload-Datei", async ({ page, baseURL }) => {
    await anmelden(page, "inhaber");
    await page.goto("/amazon-business?land=DE");
    const csv = ["(Übergeordnete) ASIN;(Untergeordnete) ASIN;Titel;SKU;Sitzungen – Summe;Sitzungen – Summe – B2B;Bestellte Einheiten;Bestellte Einheiten – B2B;Umsatz bestellter Produkte;Umsatz bestellter Produkte – B2B;Prozentsatz an Empfohlenes Angebot (Buy Box) – B2B", "B0TESTKAP1;B0TESTKAP1;Testmarke Kapitaltopf (erfunden);TEST-KAPITAL;400;60;20;6;399,80 €;119,94 €;90 %"].join("\n");
    await page.locator("details", { hasText: "Geschäftsbericht hochladen" }).locator("summary").click();
    await page.locator('input[name="von"]').fill(de(tag(-30)).replace(/\.(\d\d)$/, ".20$1"));
    await page.locator('input[name="bis"]').fill(de(tag(-1)).replace(/\.(\d\d)$/, ".20$1"));
    await page.getByTestId("ab-datei-upload").setInputFiles({ name: "geschaeftsbericht.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("ab-hochladen").click()]);
    await expect(page.getByTestId("ab-tabelle")).toContainText("B0TESTKAP1");
    await expect(page.getByTestId("ab-umsatz")).toContainText("120");
    // Vorschlag übernehmen → freigeben → Upload-Datei
    const vorschlag = page.getByTestId("ab-vorschlaege");
    await vorschlag.locator('input[name="sku"][value="TEST-KAPITAL"]').check();
    await Promise.all([page.waitForURL(/meldung=/), vorschlag.getByTestId("ab-uebernehmen").click()]);
    const zeile = page.locator('[data-testid="ab-staffel"]', { hasText: "TEST-KAPITAL" });
    await expect(zeile).toHaveAttribute("data-status", "vorschlag");
    // Übertragen ohne Freigabe/Bestätigung ändert nichts
    await zeile.locator('input[name="sku"]').check();
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("ab-freigeben").click()]);
    await expect(page.locator('[data-testid="ab-staffel"]', { hasText: "TEST-KAPITAL" })).toHaveAttribute("data-status", "freigegeben");
    const datei = await page.request.get(`${baseURL}/amazon-business/datei?land=DE`);
    expect(datei.status()).toBe(200);
    const text = await datei.text();
    expect(text.split("\r\n")[0]).toContain("business-price");
    expect(text).toContain("TEST-KAPITAL\t");
  });
});

test.describe("Teil 2 – Team", () => {
  test("Call-Archiv: Google-Doc importieren → KI-Punkte → übernehmen → Aufgabe mit Link zur Call-Stelle; Offene Punkte; Discord", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/calls");
    await page.getByTestId("calls-einzeln").locator("summary").click();
    await page.getByTestId("calls-link").fill("https://docs.google.com/document/d/TESTCALLimport00000000001/edit");
    await Promise.all([page.waitForURL(/\/calls\/[0-9a-f-]{36}/), page.getByTestId("calls-import").click()]);
    await expect(page.getByTestId("call-punkt")).toHaveCount(4);
    await expect(page.getByTestId("call-zusammenfassung")).toContainText("Consultant (Test), Ludwig (Test)");
    // Die Adresse trägt schon die Import-Meldung – deshalb auf die neue Meldung warten, nicht auf „meldung=“.
    await page.getByTestId("call-uebernehmen").click();
    await expect(page.locator("[role=status]")).toContainText("übernommen");
    const [t] = await sql<{ title: string; link: string; category: string; due_date: string }>("select title, link, category, due_date::text from tasks where title like 'Liste der zehn Audit-Marken%'");
    expect(t).toMatchObject({ category: "amazon", due_date: "2026-10-23" });
    expect(t.link).toMatch(/^\/calls\/[0-9a-f-]{36}#p-[0-9a-f-]{36}$/);
    await page.goto("/calls/offen");
    await expect(page.getByTestId("offen-fragen")).toContainText("Gilt der Mindestrabatt auch für Bundles?");
    await expect(page.getByTestId("offen-consultant")).toContainText("Mindestrabatt für Bundles intern klären");
    await expect(page.getByTestId("offen-aufgaben")).toContainText("Liste der zehn Audit-Marken");
    // Discord-Kanal (Test-Bot) → neuer Call
    await page.goto("/calls");
    await page.locator("details", { hasText: "Calls importieren" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await Promise.all([page.waitForURL(/meldung=/), page.getByRole("button", { name: "Jetzt aus Discord holen" }).click()]);
    await expect(page.locator("[role=status]")).toContainText("1 neue Calls aus Discord");
    await expect(page.getByTestId("calls-zeile").filter({ hasText: "Consultant-Call 21.10.2026" })).toBeVisible();
    // ältere Nachrichten nachholen: derselbe Link ist schon da
    await page.locator("details", { hasText: "Calls importieren" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("calls-discord-nachholen").click()]);
    await expect(page.locator("[role=status]")).toContainText("0 neue Calls aus Discord (1 Nachrichten gelesen)");
  });

  test("Umzug aus dem bisherigen Call-Archiv: Export (JSON) → Call mit Zusammenfassung, Vorschläge, kein Doppel", async ({ page }) => {
    const exportDatei = {
      calls: [{ id: "cTEST-ARCHIV-1", date: "2026-09-17", title: "Archiv-Testcall (erfunden)", sourceUrl: "https://docs.google.com/document/d/TESTARCHIV00000000000001/edit", summary: { overview: "Erfundener Überblick aus dem Archiv.", topics: [{ name: "Lager", points: ["Testpunkt"] }], decisions: ["Testentscheidung"], todos: [{ task: "Test-To-do aus dem Archiv", owner: "Ludwig", due: "2026-09-24" }], open_questions: ["Testfrage aus dem Archiv?"], participants: ["Ludwig (Test)", "Consultant (Test)"] } }],
      chunks: [{ callId: "cTEST-ARCHIV-1", n: 0, text: "Consultant: Testtranskript aus dem Archiv." }],
    };
    const datei = { name: "call-archiv-test.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exportDatei)) };
    await anmelden(page, "inhaber");
    await page.goto("/calls");
    await page.locator("details", { hasText: "Calls importieren" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await page.getByTestId("calls-archiv-datei").setInputFiles(datei);
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("calls-archiv-import").click()]);
    await expect(page.locator("[role=status]")).toContainText("1 Calls übernommen");
    await page.getByTestId("calls-zeile").filter({ hasText: "Archiv-Testcall (erfunden)" }).getByRole("link").click();
    await expect(page.getByTestId("call-zusammenfassung")).toContainText("Erfundener Überblick aus dem Archiv.");
    await expect(page.getByTestId("call-zusammenfassung")).toContainText("Ludwig (Test), Consultant (Test)");
    await expect(page.locator('[data-testid="call-punkt"][data-status="vorschlag"]')).toHaveCount(3);
    // zweiter Import derselben Datei: nichts doppelt
    await page.goto("/calls");
    await page.locator("details", { hasText: "Calls importieren" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await page.getByTestId("calls-archiv-datei").setInputFiles(datei);
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("calls-archiv-import").click()]);
    await expect(page.locator("[role=status]")).toContainText("1 waren schon da");
  });

  test("Wochen-Calls der Deal-Gruppe auf einmal: Word, ZIP (Text + Untertitel), Link → Auswertung im Hintergrund, kein Doppel", async ({ page }) => {
    // erfundene Transkripte – lang genug für die Inhalts-Kennung
    const transkript = (thema: string) => Array.from({ length: 12 }, (_, i) => `Sprecher ${i % 3} (Test): ${thema} – Testsatz ${i} über Deals, Retouren und Lager.`).join("\n");
    const docx = (text: string) =>
      createZip([
        { name: "[Content_Types].xml", data: "<Types/>" },
        { name: "word/document.xml", data: `<w:document><w:body>${text.split("\n").map((z) => `<w:p><w:r><w:t>${z}</w:t></w:r></w:p>`).join("")}</w:body></w:document>` },
      ]);
    const vtt = `WEBVTT\n\n${transkript("Untertitel-Call").split("\n").map((z, i) => `${i + 1}\n00:00:0${i % 10}.000 --> 00:00:0${i % 10}.900\n<v ${z.split(":")[0]}>${z.split(": ")[1]}`).join("\n\n")}\n`;
    const zip = createZip([
      { name: "Wochen-Calls/Call 2026-09-12.txt", data: transkript("Text-Call") },
      { name: "Wochen-Calls/Call 2026-09-19.vtt", data: vtt },
      { name: "__MACOSX/Wochen-Calls/._Call 2026-09-12.txt", data: "x" },
    ]);
    const wordDatei = { name: "Call 2026-09-05.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx(transkript("Word-Call")) };
    const zipDatei = { name: "wochen-calls.zip", mimeType: "application/zip", buffer: zip };
    await anmelden(page, "inhaber");
    await page.goto("/calls");
    await page.locator("details", { hasText: "Calls importieren" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await page.getByTestId("calls-sammel-bezeichnung").fill("Wochen-Call Testgruppe");
    await page.getByTestId("calls-dateien").setInputFiles([wordDatei, zipDatei]);
    await page.getByTestId("calls-links").fill("Bea (Test) — 26.09.2026 18:01\nhttps://docs.google.com/document/d/TESTCALLgruppe00000000001/edit");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("calls-sammel-import").click()]);
    await expect(page.locator("[role=status]")).toContainText("4 Calls übernommen");
    for (const d of ["05.09.2026", "12.09.2026", "19.09.2026", "26.09.2026"]) await expect(page.getByTestId("calls-zeile").filter({ hasText: `Wochen-Call Testgruppe ${d}` }).filter({ hasText: "Deal-Gruppe" })).toBeVisible();
    // Die KI wertet im Hintergrund aus (Testdienst) – bis nichts mehr wartet.
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("calls-wartend")).toHaveCount(0);
    }).toPass({ timeout: 60_000 });
    await page.getByTestId("calls-zeile").filter({ hasText: "Wochen-Call Testgruppe 05.09.2026" }).getByRole("link").first().click();
    await expect(page.getByTestId("call-zusammenfassung")).toContainText("Consultant (Test), Ludwig (Test)");
    await expect(page.getByTestId("call-punkt").first()).toBeVisible();
    // Wissen aus dem Call: von der KI (Testdienst) ins Wissen gezogen, mit Quelle zurück zum Call
    const callUrl = page.url();
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("call-wissen")).toContainText("Testwissen (Wochen-Call Testgruppe 05.09.2026): Black-Week-Deals nur mit Gewinn");
    }).toPass({ timeout: 60_000 });
    await page.getByTestId("call-wissen").getByRole("link", { name: /Black-Week-Deals nur mit Gewinn/ }).click();
    await expect(page.getByTestId("entry-origin")).toContainText("Aus einem Call (ungeprüft)");
    await expect(page.getByTestId("entry-insider")).toContainText("Insider – nicht weitergeben");
    await expect(page.locator(".article-body")).toContainText("Regel · gesagt von: Ludwig · Einschätzung: bestätigt");
    await expect(page.getByTestId("entry-call")).toContainText("Call vom 05.09.2026");
    await expect(page.getByTestId("entry-call").getByRole("link").first()).toContainText("Wochen-Call Testgruppe 05.09.2026");
    // Insider-Markierung lässt sich aufheben und wieder setzen
    await page.getByTestId("entry-insider-umschalten").click();
    await expect(page.getByTestId("entry-insider")).toHaveCount(0);
    await page.getByTestId("entry-insider-umschalten").click();
    await expect(page.getByTestId("entry-insider")).toBeVisible();
    // Stelle im Transkript (Call aus dem Google Doc – dort steht das Zitat wörtlich)
    const [eintrag] = await sql<{ id: string }>("select id from knowledge_entries where title = 'Testwissen (Wochen-Call Testgruppe 26.09.2026): Black-Week-Deals nur mit Gewinn'");
    await page.goto(`/wissen/${eintrag.id}`);
    await expect(page.getByTestId("entry-call")).toContainText("gesagt von: Ludwig");
    await page.getByTestId("entry-stelle").click();
    await expect(page.getByTestId("call-stelle")).toContainText("Black-Week-Deals nur mit Gewinn");
    await page.goto("/wissen?bereich=call");
    await expect(page.getByTestId("wissen-call-hinweis")).toBeVisible();
    await expect(page.getByText("Testwissen (Wochen-Call Testgruppe 12.09.2026): Markenliste vor dem Audit bereithalten")).toBeVisible();
    // Suche im Wissen findet es auch
    await page.goto(`/wissen?q=${encodeURIComponent("Black-Week")}`);
    await expect(page.getByText("Testwissen (Wochen-Call Testgruppe 19.09.2026): Black-Week-Deals nur mit Gewinn")).toBeVisible();
    await page.goto(callUrl);
    // Titel und Datum von Hand ändern
    await page.getByTestId("call-bearbeiten").locator("summary").click();
    await page.getByTestId("call-bearbeiten").locator('input[name="datum"]').fill("06.09.2026");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("call-bearbeiten").getByRole("button", { name: "Speichern" }).click()]);
    await expect(page.locator(".crumb")).toContainText("06.09.2026 · Deal-Gruppe");
    // Noch einmal: dieselbe Word-Datei unter anderem Namen und der Text des Google Docs als Datei → nichts doppelt
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from calls where quelle_ref = 'gdoc:TESTCALLgruppe00000000001'");
    expect(n).toBe(1);
    await page.goto("/calls");
    await page.locator("details", { hasText: "Calls importieren" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await page.getByTestId("calls-dateien").setInputFiles([{ ...wordDatei, name: "Kopie vom Word-Call.docx" }]);
    await page.getByTestId("calls-links").fill("https://docs.google.com/document/d/TESTCALLgruppe00000000001/edit");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("calls-sammel-import").click()]);
    await expect(page.locator("[role=status]")).toContainText("0 Calls übernommen");
    await expect(page.locator("[role=status]")).toContainText("2 waren schon da");
    await expect(page.locator("[role=status]")).toContainText("Kopie vom Word-Call.docx (= „Wochen-Call Testgruppe 05.09.2026“");
  });

  test("Anleitung im Wissen → Aufgabe zuweisen hängt sie an; Bea sieht die Aufgabe mit Anleitung", async ({ page, browser }) => {
    await anmelden(page, "inhaber");
    await page.goto("/wissen/neu?art=anleitung");
    await page.fill("#title", "Inventur im Testlager");
    await page.fill("#a_zweck", "Bestand im Testlager zählen");
    await page.getByTestId("entry-schritte").fill("Regal scannen\nMenge zählen\nIn WaWi eintragen");
    await page.getByTestId("entry-typen").fill("titel:inventur");
    await Promise.all([page.waitForURL(/\/wissen\/[0-9a-f-]{36}$/), page.getByRole("button", { name: "Speichern" }).click()]);
    await expect(page.locator(".article-body")).toContainText("1. Regal scannen");
    await expect(page.getByTestId("entry-pruefen")).toBeVisible();

    await page.goto("/board?b=todos");
    await page.getByLabel("Neue Aufgabe").fill("Inventur Regal A (Test)");
    await Promise.all([page.waitForURL(/b=todos/), page.getByRole("button", { name: "Hinzufügen" }).click()]);
    const karte = page.locator("[data-testid=board-todos] *", { hasText: "Inventur Regal A (Test)" }).filter({ has: page.getByTestId("task-wer") }).last();
    const [bea] = await sql<{ id: string }>("select id from users where email = 'buero'");
    await karte.getByTestId("task-wer").selectOption(bea.id);
    await Promise.all([aktion(page), karte.getByTestId("task-zuweisen").click()]);
    await expect(page.getByTestId("task-anleitungen").filter({ hasText: "Inventur im Testlager" })).toBeVisible();

    const b = await alsPerson(browser, "buero");
    await b.goto("/board?b=todos");
    await expect(b.getByTestId("task-anleitungen").filter({ hasText: "Inventur im Testlager" })).toBeVisible();
    await b.context().close();
  });

  test("Feste freie Zeiten: Aufgabe am freien Tag wandert auf den nächsten Arbeitstag; Wochenrückblick", async ({ page }) => {
    const morgen = tag(1);
    const wt = ((new Date(`${morgen}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    await anmelden(page, "inhaber");
    const T = await tenant();
    await sql(`insert into tasks (tenant_id, title, due_date, category) values ($1, 'Freizeit-Test Aufgabe', $2, 'eigene')`, [T, morgen]);
    await page.goto("/kalender/zeiten");
    const form = page.locator("form", { has: page.getByTestId("zeit-anlegen-frei") });
    await form.locator('input[name="titel"]').fill("Testfreier Tag");
    await form.locator(`input[name="wt"][value="${wt}"]`).check();
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("zeit-anlegen-frei").click()]);
    await expect(page.locator("[role=status]")).toContainText("verschoben");
    const [t] = await sql<{ due: string }>("select due_date::text as due from tasks where title = 'Freizeit-Test Aufgabe'");
    expect(t.due > morgen).toBe(true);
    await expect(page.getByTestId("zeiten-rueckblick")).toBeVisible();
    // Aufräumen: den Testblock wieder entfernen (andere Prüfungen erwarten keine Sperrtage)
    await page.getByTestId("zeit-block").filter({ hasText: "Testfreier Tag" }).getByRole("button", { name: "entfernen" }).click();
    await page.waitForURL(/meldung=/);
  });
});

test.describe("Teil 2 – Familie & Zugänge", () => {
  test("Familien-Zugang: nur Familienliste + Familienkalender; kein Geld, keine Geschäftsseiten, kein Privat-Geld", async ({ page }) => {
    await anmelden(page, "familie");
    await page.goto("/privat/familienaufgaben");
    // Ohne Aufgaben ist das Formular schon offen – sicherstellen, dass es offen ist (nicht zuklappen).
    await page.locator("details", { has: page.locator("summary", { hasText: "+ Aufgabe" }) }).evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await page.getByLabel("Aufgabe").fill("Geschenk Oma besorgen (Test)");
    await page.locator('select[name="kategorie"]').selectOption("geschenke");
    await Promise.all([aktion(page), page.getByRole("button", { name: "Anlegen" }).click()]);
    await expect(page.getByTestId("fam-aufgabe").filter({ hasText: "Geschenk Oma besorgen (Test)" })).toBeVisible();
    await expect(page.getByTestId("fam-fairness")).toContainText("Ausgeschaltet");
    await page.goto("/privat/kalender");
    await expect(page).toHaveURL(/\/privat\/kalender/);
    for (const pfad of ["/privat/geld", "/privat/tagebuch", "/privat/paar"]) {
      await page.goto(pfad);
      await expect(page, pfad).toHaveURL(/nurfamilie=1/);
    }
    for (const pfad of ["/", "/kapital", "/cashflow", "/echtheit", "/calls"]) {
      await page.goto(pfad);
      await expect(page, pfad).not.toHaveURL(new RegExp(`${pfad === "/" ? "^[^?]*/$" : pfad}$`));
    }
  });

  test("Assistenz (Büro) sieht keine Finanz- oder Privatdaten", async ({ page }) => {
    await anmelden(page, "buero");
    for (const pfad of ["/kapital", "/verlust", "/cashflow", "/hebel", "/privat", "/privat/geld"]) {
      await page.goto(pfad);
      await expect(page, pfad).toHaveURL(/gesperrt=1/);
    }
  });

  test("Privates Geld: nur für die eigene Person; Frage für den Steuerberater", async ({ page, browser }) => {
    await anmelden(page, "inhaber");
    await page.goto("/privat/geld");
    await expect(page.locator("body")).toContainText("keine Steuerberatung");
    await page.getByTestId("geld-frage").fill("Gehalt oder Ausschüttung 2027? (Test)");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("geld-frage").locator("xpath=..").getByRole("button", { name: "+" }).click()]);
    await expect(page.getByTestId("geld-steuerberater")).toContainText("Gehalt oder Ausschüttung 2027? (Test)");
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from private_entries where kind = 'privatgeld'");
    expect(n).toBeGreaterThan(0);
    // Familien-Zugang sieht die Seite nicht
    const f = await alsPerson(browser, "familie");
    await f.goto("/privat/geld");
    await expect(f).toHaveURL(/nurfamilie=1/);
    await f.context().close();
  });
});
