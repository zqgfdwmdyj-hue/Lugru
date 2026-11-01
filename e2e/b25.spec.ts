// B25 (Browser-Prüfung Teil 4) mit erfundenen Daten: Abrechnung aus dem Transaktionsbericht (auch für ältere Importe
// nachgezogen, genauere Datei ersetzt die Ableitung), Import-Seite mit Ergebnis/Fehler, Lugru-Schwelle 60 als Wert,
// BQool-Vorschau statt Download, Rückgängig für aufgabe_verschieben, Paletten ohne Kunde auf der Startseite,
// Fahrzeit + Telefonnummer im Tagesplan, Privat „voll“ bei Nicht-Inhabern bereinigt, VA-Rolle per Knopf,
// Calls-Suche, Abruf-Intervall je Anbindung, B2B-Ablauf-Hilfe.
import bcrypt from "bcryptjs";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

type Link = { import_id: string; upload_url: string; content_type: string };
const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const HEUTE = berlin(new Date());
const vor = (n: number) => plus(HEUTE, -n);
const dmyZeit = (iso: string, uhr: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${uhr} UTC`;
/** Ein Dienstag weit weg von anderen Prüfungen. */
const DIENSTAG = (() => {
  let d = plus(HEUTE, 52);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 2) d = plus(d, 1);
  return d;
})();

const KOPF = ["Datum/Uhrzeit", "Abrechnungsnummer", "Typ", "Bestellnummer", "SKU", "Beschreibung", "Menge", "Marketplace", "Versand", "Umsätze", "Produktumsatzsteuer", "Gutschrift für Versandkosten", "Rabatte aus Werbeaktionen", "Verkaufsgebühren", "Gebühren zu Versand durch Amazon", "Andere Transaktionsgebühren", "Andere", "Gesamt"];
const z = (...x: string[]) => x.map((v) => `"${v}"`).join(",");
const VORSPANN = ['"Enthält Amazon Marketplace-Transaktionen (erfunden)"', '"Alle Beträge in Euro, sofern nicht anders angegeben"', '"Definitionen:"', '"Umsatzsteuer für Verkäufe: erfunden"', '"Verkaufsgebühren: erfunden"', '"Gebühren zu Versand durch Amazon: erfunden"', '"Andere Transaktionsgebühren: erfunden"', '"Andere: erfunden"', ""];
function zeilenA(m: string) {
  const a = `88${m}1`;
  return [
    z(dmyZeit(vor(9), "08:00:00"), a, "Bestellung", `302-${m}-0000001`, "TEST-SOCKEN", "Testsocken (erfunden)", "2", "amazon.de", "Versand durch Amazon", "20,00", "3,80", "0", "0", "-3,00", "-4,50", "0", "0", "16,30"),
    z(dmyZeit(vor(8), "09:00:00"), a, "Erstattung", `302-${m}-0000001`, "TEST-SOCKEN", "Testsocken (erfunden)", "1", "Amazon.de", "Versand durch Amazon", "-10,00", "-1,90", "0", "0", "1,20", "0", "0", "0", "-10,70"),
    z(dmyZeit(vor(7), "10:00:00"), a, "Servicegebühr", "", "", "Abonnementgebühr (erfunden)", "", "", "", "0", "0", "0", "0", "0", "0", "-39,00", "0", "-39,00"),
    z(dmyZeit(vor(6), "11:00:00"), a, "Übertrag", "", "", "An Bankkonto (erfunden)", "", "", "", "0", "0", "0", "0", "0", "0", "0", "-123,45", "-123,45"),
  ];
}
const zeileB = (m: string, n: string, tage: number, gesamt: string) => z(dmyZeit(vor(tage), "08:00:00"), `88${m}2`, "Bestellung", `302-${m}-000000${n}`, "TEST-SOCKEN", "Testsocken (erfunden)", "1", "amazon.de", "Versand durch Amazon", "12,00", "2,28", "0", "0", "-1,80", "-3,10", "0", "0", gesamt);
const datei = (zeilen: string[]) => [...VORSPANN, z(...KOPF), ...zeilen].join("\n");

test.describe("B25 Browser-Prüfung Teil 4", () => {
  test("B25.1/B25.2: Abrechnung aus dem Transaktionsbericht – ältere Importe nachgezogen, genauere Datei ersetzt die Ableitung; Import-Seite mit Ergebnis", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const A = `88${m}1`;
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const hochladen = async (inhalt: string, name: string) => {
      const l = JSON.parse(await mcp.call("import_link", { art: "amazon_transaktionen", dateiname: name })) as Link;
      expect((await fetch(l.upload_url, { method: "PUT", body: inhalt, headers: { "Content-Type": l.content_type } })).status).toBe(202);
      await expect.poll(async () => JSON.parse(await mcp.call("import_status", { import_id: l.import_id })).status, { timeout: 60_000 }).toMatch(/fertig|fehler/);
      const s = JSON.parse(await mcp.call("import_status", { import_id: l.import_id })) as { status: string; fehler_text?: string };
      expect(s.status, s.fehler_text).toBe("fertig");
    };
    const summeA = async () => Number((await sql<{ s: string }>("select coalesce(sum(amount), 0)::text as s from amazon_settlement_lines where settlement_id = $1", [A]))[0].s);
    const txdbA = async () => (await sql<{ n: number }>("select count(*)::int as n from amazon_settlement_lines where settlement_id = $1 and row_hash like 'txdb:%'", [A]))[0].n;

    // 1. Transaktionsbericht importieren → Abrechnungszeilen aus der Datei
    await hochladen(datei([...zeilenA(m), zeileB(m, "2", 3, "9,38")]), "2026Jan1-2026Oct30CustomTransaction.csv");
    expect(await summeA()).toBeCloseTo(16.3 - 10.7 - 39, 2);

    // 2. Wie ein Import von vor dem Update: Abrechnungszeilen fehlen, die Transaktionen sind gespeichert
    await sql("delete from amazon_settlement_lines where settlement_id = $1", [A]);
    expect(await summeA()).toBe(0);

    // 3. Nächster Import (andere Abrechnung) zieht die ältere aus den gespeicherten Transaktionen nach – Übertrag bleibt Auszahlung, nie Umsatz
    await hochladen(datei([zeileB(m, "2", 3, "9,38"), zeileB(m, "3", 2, "7,10")]), "Transaktionen-Nachtrag.csv");
    expect(await txdbA()).toBeGreaterThan(0);
    expect(await summeA()).toBeCloseTo(16.3 - 10.7 - 39, 2);
    const [abr] = await sql<{ total_amount: string }>("select total_amount from amazon_settlements where settlement_id = $1", [A]);
    expect(Number(abr.total_amount)).toBe(123.45);

    // 4. Genauere Datei, die alle gespeicherten Zeilen der Abrechnung enthält (+ eine neue) → ersetzt die Ableitung, keine Doppelzählung
    const extra = z(dmyZeit(vor(5), "12:00:00"), A, "Bestellung", `302-${m}-0000009`, "TEST-SOCKEN", "Testsocken (erfunden)", "1", "amazon.de", "Versand durch Amazon", "5,00", "0,95", "0", "0", "-0,80", "-1,20", "0", "0", "3,00");
    await hochladen(datei([...zeilenA(m), extra]), "2026Jan1-2026Oct31CustomTransaction.csv");
    expect(await txdbA()).toBe(0);
    expect(await summeA()).toBeCloseTo(16.3 - 10.7 - 39 + 3, 2);

    // B25.2: Import-Seite – Ergebnis je Import (inkl. „nachgezogen“), Lagergebühren und USt-Bericht unter „Was erkannt wird“
    await anmelden(page, "inhaber");
    await page.goto("/import");
    await expect(page.getByRole("columnheader", { name: "Ergebnis / Fehler" })).toBeVisible();
    await expect(page.getByTestId("import-ergebnis").filter({ hasText: /aus gespeicherten Transaktionen nachgezogen/ }).first()).toBeVisible();
    const erkannt = page.locator("section", { has: page.getByRole("heading", { name: "Was erkannt wird" }) });
    await expect(erkannt).toContainText("Lagergebühren je Monat");
    await expect(erkannt).toContainText("Umsatzsteuer-Transaktionsbericht");
    await expect(erkannt).toContainText("Gestrandeter Bestand");

    // B25.1: Gewinn-Seite lädt mit Quelle und Stand (Abdeckung „bis gestern“ prüft tests/b25.test.ts)
    await page.goto("/gewinn");
    await expect(page.getByTestId("kpi-revenue")).toBeVisible();
  });

  test("B25.3/B25.5/B25.6/B25.7: Lugru-Schwelle 60, BQool-Vorschau statt Download, Rückgängig für aufgabe_verschieben, Paletten ohne Kunde", async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await anmelden(page, "inhaber");

    // B25.3: „Lugru Deals=60“ ist ein gespeicherter Standard, kein Platzhalter
    await page.goto("/deal-eingang");
    await expect(page.getByTestId("de-schwelle-je")).toHaveValue(/Lugru Deals=\d+/);
    await expect(page.getByTestId("de-schwelle-gilt")).toContainText(/Lugru Deals \d+/);

    // B25.5: /repricer/export ohne Format → Vorschau mit Warnungen und Freigabe je Land (kein Datei-Download)
    await page.goto("/repricer/export");
    await expect(page).toHaveURL(/\/repricer\/bqool/);
    await expect(page.locator('[data-testid="bq-warnungen"], [data-testid="bq-warnungen-keine"]').first()).toBeVisible();
    const csv = await page.request.get("/repricer/export?format=bqool");
    expect(csv.headers()["content-type"]).toContain("text/csv");

    // B25.6: neuer grüner Aufruf aufgabe_verschieben → „↩ Rückgängig“ stellt die alte Frist wieder her
    const alt = plus(HEUTE, 30);
    const [t] = await sql<{ id: string }>("insert into tasks (tenant_id, title, due_date, category) values ($1, $2, $3, 'eigene') returning id", [T, `B25 Verschieben ${m}`, alt]);
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const r = JSON.parse(await mcp.call("aufgabe_verschieben", { id: t.id, datum: DIENSTAG })) as { ok: boolean };
    expect(r.ok).toBe(true);
    const frist = async () => (await sql<{ d: string }>("select due_date::text as d from tasks where id = $1", [t.id]))[0].d;
    expect(await frist()).toBe(DIENSTAG);
    await page.goto("/assistent-verlauf");
    const eintrag = page.locator('[data-testid="verlauf-eintrag"][data-tool="aufgabe_verschieben"]').first();
    await expect(eintrag.getByTestId("verlauf-rueckgaengig")).toBeVisible();
    await Promise.all([aktion(page), eintrag.getByTestId("verlauf-rueckgaengig").click()]);
    await expect.poll(frist).toBe(alt);

    // B25.7: Palette ohne Kunde → „Jetzt dringend“ auf der Startseite
    await sql("insert into pallets (tenant_id, code, customer, in_at) values ($1, $2, null, current_date)", [T, `B25-${m}`]);
    await page.goto("/");
    await expect(page.getByTestId("signal-paletten-ohne-kunde")).toContainText("ohne Kunde");
    await expect(page.getByTestId("signal-paletten-ohne-kunde")).toHaveAttribute("href", /\/paletten\?kunde=__ohne/);
  });

  test("B25.8: Tagesplan blockt Fahrzeit vor Terminen mit Ort, Anruf-Aufgabe mit Telefonnummer", async ({ page }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await sql(
      "insert into calendar_events (tenant_id, calendar_name, uid, title, starts_at, ends_at, all_day, day, location) values ($1, 'Testkalender', $2, $3, ($4::date + time '14:00') at time zone 'Europe/Berlin', ($4::date + time '15:00') at time zone 'Europe/Berlin', false, $4::date, 'Testweg 1, 80331 München')",
      [T, `b25-fahrt-${m}`, `Lieferantenbesuch ${m}`, DIENSTAG],
    );
    await sql("insert into tasks (tenant_id, title, due_date, telefon, category) values ($1, $2, $3, '+49 30 1234567', 'eigene')", [T, `Lieferant ${m} anrufen`, DIENSTAG]);
    await anmelden(page, "inhaber");
    await page.goto(`/kalender/tagesplan?tag=${DIENSTAG}`);
    await expect(page.getByTestId("tagesplan-sperren")).toContainText(/Fahrzeit \d+ Min\./);
    await expect(page.getByTestId("tagesplan-sperren")).toContainText("Anrufe möglich");
    const tel = page.getByTestId("tagesplan-telefon").first();
    await expect(tel).toContainText("+49 30 1234567");
    await expect(tel).toHaveAttribute("href", "tel:+49301234567");
  });

  test("B25.9: Privat „voll“ bei Nicht-Inhaber gesperrt und beim Inhaber-Login bereinigt; va@… → „Als VA-Rolle übernehmen“", async ({ page, browser }) => {
    const m = marke().toLowerCase();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const pw = `Erfunden-${m}-Passwort`;
    const [u] = await sql<{ id: string }>("insert into users (email, name, password_hash) values ($1, $2, $3) returning id", [`b25-${m}`, `B25 Konto ${m}`, await bcrypt.hash(pw, 4)]);
    await sql("insert into memberships (tenant_id, user_id, role, areas, read_only, private_access, private_scope) values ($1, $2, 'staff', '[\"start\"]'::jsonb, false, true, 'voll')", [T, u.id]);

    // Gespeichertes „voll“ wirkt bei Nicht-Inhabern nicht mehr: Privatbereich gesperrt
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto("/login");
    await p2.fill("#email", `b25-${m}`);
    await p2.fill("#password", pw);
    await Promise.all([p2.waitForURL((x) => !x.pathname.startsWith("/login")), p2.click("button[type=submit]")]);
    await p2.goto("/privat");
    await expect(p2).toHaveURL(/gesperrt=1/);
    await ctx.close();

    // Inhaber meldet sich an → bereinigt (Privat „kein Zugang“), Dialog nennt das Konto, Aufgabe als Hinweis
    await anmelden(page, "inhaber");
    await expect(page.getByTestId("privat-warn-dialog")).toContainText("Privat-Zugang bereinigt");
    await expect(page.getByTestId("privat-warn-dialog")).toContainText(`b25-${m}`);
    expect((await sql<{ private_access: boolean }>("select private_access from memberships where user_id = $1", [u.id]))[0].private_access).toBe(false);
    expect((await sql<{ n: number }>("select count(*)::int as n from tasks where tenant_id = $1 and system_key like 'privat-voll-bereinigt:%' and notes like $2", [T, `%b25-${m}%`]))[0].n).toBe(1);
    await page.getByTestId("privat-warn-dialog").getByRole("link", { name: "Später" }).click();
    await expect(page.getByTestId("privat-warn-dialog")).toHaveCount(0);

    // va@…-Konto ohne VA-Rolle → Knopf „Als VA-Rolle übernehmen“
    const email = `va-b25-${m}@example.invalid`;
    const name = `B25 Testkonto ${m}`;
    const [v] = await sql<{ id: string }>("insert into users (email, name, password_hash) values ($1, $2, $3) returning id", [email, name, await bcrypt.hash(pw, 4)]);
    await sql("insert into memberships (tenant_id, user_id, role, areas, read_only, private_access, private_scope) values ($1, $2, 'staff', '[\"start\"]'::jsonb, false, false, 'voll')", [T, v.id]);
    await page.goto("/einstellungen#benutzer");
    const warnung = page.getByTestId("zugriff-warnungen").locator("li", { hasText: name });
    await expect(warnung).toContainText("sieht nach dem Konto der VA aus");
    await Promise.all([aktion(page), warnung.getByTestId("als-va-rolle").getByRole("button", { name: "Als VA-Rolle übernehmen" }).click()]);
    await expect.poll(async () => (await sql<{ n: number }>("select jsonb_array_length(areas)::int as n from memberships where user_id = $1", [v.id]))[0].n).toBeGreaterThan(1);
    await page.reload();
    await expect(page.locator("body")).not.toContainText(`${name}: sieht nach dem Konto der VA aus`);
  });

  test("B25.10/B25.12: Calls-Suche, Abruf-Intervall je Anbindung, B2B-Ablauf-Hilfe", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    await anmelden(page, "inhaber");

    // Calls: Transkript einfügen, danach über das Suchfeld finden
    await page.goto("/calls");
    await page.getByTestId("calls-einzeln").waitFor({ state: "attached" });
    await page.locator("details", { has: page.getByTestId("calls-einzeln") }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await page.getByTestId("calls-einzeln").locator("summary").click();
    const form = page.getByTestId("calls-einzeln");
    await form.locator('input[name="titel"]').fill(`B25 Call ${m}`);
    await form.locator('input[name="datum"]').fill(`${HEUTE.slice(8, 10)}.${HEUTE.slice(5, 7)}.${HEUTE.slice(0, 4)}`);
    await form.getByTestId("calls-text").fill(`Ludwig (Test): Heute geht es um Zauberwort${m} und Rabatte beim Testlieferanten.\nConsultant (Test): Zauberwort${m} lohnt sich nur mit Staffelpreis (erfunden).`);
    await Promise.all([page.waitForURL(/\/calls\/[0-9a-f-]{36}/), form.getByTestId("calls-import").click()]);
    await page.goto(`/calls?q=${encodeURIComponent(`Zauberwort${m}`)}`);
    await expect(page.getByTestId("calls-treffer-zeile").first()).toContainText(`B25 Call ${m}`);
    await page.goto(`/calls?q=${encodeURIComponent(`Gibtsnicht${m}`)}`);
    await expect(page.getByTestId("calls-treffer")).toContainText("Kein Call enthält");

    // Anbindungen: Intervall je Abruf statt „laut Plan“
    await page.goto("/anbindungen");
    const intervall = page.getByTestId("intervall-amazon_sp");
    await expect(intervall).toContainText("Amazon-Bestellungen:");
    await expect(page.locator("main")).not.toContainText("laut Plan");

    // B2B: wo Deal-Blatt, Sammelbestellung und Prep-Export erscheinen
    await page.goto("/b2b");
    const hilfe = page.getByTestId("b2b-ablauf-hilfe");
    await expect(hilfe).toContainText("Deal-Blatt");
    await expect(hilfe).toContainText("Sammelbestellung");
    await expect(hilfe).toContainText("Prep");
  });
});
