// Bauauftrag B34.4/5 Ankauf als Ausstiegsweg – Abnahme: beide Szenarien (Amazon / Ankauf) nebeneinander; dazu
// Checkliste beim „Gekauft“ als Warnung (kein Stopp), Aufgabe „Ankauf bestätigen“ mit Frist, Ausgang „Verlust“ →
// Lernschleife, Wissenseintrag „Ankaufserver“ (insider). Erfundener Artikel und Ankäufer gegen die Testdienste.
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

const fertig = (id: string) => expect.poll(async () => (await sql<{ p: string }>("select pruefung p from deal_eingaenge where id = $1", [id]))[0]?.p, { timeout: 60_000 }).toMatch(/fertig|fehler/);

test.describe("B34.4/5 Ankauf als Ausstiegsweg", () => {
  const m = marke();
  const ASIN = `B0ANK${m}`;
  test.afterAll(async () => {
    const ids = (await sql<{ id: string }>("select id from deal_eingaenge where zeilen::text like $1", [`%${ASIN}%`])).map((r) => r.id);
    for (const id of ids) {
      await sql("delete from tasks where system_key = $1", [`ankauf-bestaetigen:${id}`]);
      await sql("delete from lernschleife_fragen where schluessel = $1", [`ANKAUF|${id}`]);
      await sql("delete from deal_eingaenge where id = $1", [id]);
    }
  });

  test("Abnahme: Amazon und Ankauf nebeneinander; Warnung beim Kauf, Aufgabe mit Frist, Ausgang → Lernschleife", async ({ page }) => {
    test.setTimeout(180_000);
    await anmelden(page, "inhaber");
    const r = await page.request.post("/api/deal-eingang", { multipart: { text: `${ASIN} Testmixer 500 W (erfunden) 20,00 netto ab 30 Stk`, quelle: `Testquelle ${m}` }, maxRedirects: 0 });
    expect(r.status()).toBe(303);
    const id = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r.headers().location ?? "")![1];
    await fertig(id);
    await page.goto(`/deal-eingang/${id}`);
    const ab = page.getByTestId("de-ankauf");
    await expect(ab).toHaveAttribute("data-aktiv", "0");
    await expect(page.getByTestId("de-ausstieg")).toHaveCount(0);

    // Ankaufspreis + Risikofelder (Menge nur teilweise angemeldet, Frist und Legit-Check offen)
    const f = page.getByTestId("de-ankauf-form");
    await f.getByTestId("de-ankauf-preis").fill("26,00");
    await f.getByTestId("de-ankauf-ankaeufer").fill("Testankauf (erfunden)");
    await f.getByTestId("de-ankauf-menge").fill("10");
    await f.getByTestId("de-ankauf-ziel").fill("7");
    await f.getByTestId("de-ankauf-rueck").fill("2");
    await Promise.all([aktion(page), f.getByTestId("de-ankauf-speichern").click()]);
    await expect(page.getByRole("status")).toContainText("Ankauf gespeichert – Vergleich Amazon / Ankauf unten.");
    await expect(ab).toHaveAttribute("data-aktiv", "1");

    // Abnahme: beide Szenarien nebeneinander – Ankauf: 26,00 − 20,00 + 2 % von 20,00 = 6,40 € je Stück, Geld nach 7 Tagen
    const t = page.getByTestId("de-ausstieg");
    await expect(t.locator("thead")).toContainText("Amazon (");
    await expect(t.locator("thead")).toContainText("Ankauf (Testankauf (erfunden))");
    await expect(t.getByTestId("de-ausstieg-ankauf-gewinnStk")).toContainText("6,40 €");
    await expect(t.getByTestId("de-ausstieg-ankauf-marge")).toContainText("24,6 %");
    await expect(t.getByTestId("de-ausstieg-ankauf-roi")).toContainText("32 %");
    await expect(t.getByTestId("de-ausstieg-ankauf-tage")).toContainText("7 Tagen");
    await expect(t.getByTestId("de-ausstieg-ankauf-roiPa")).toContainText("1669 %");
    await expect(t.getByTestId("de-ausstieg-amazon-gewinnStk")).toContainText("€");
    await expect(t.getByTestId("de-ausstieg-amazon-roi")).toContainText("%");
    const fazit = page.getByTestId("de-ausstieg-fazit");
    await expect(fazit).toHaveAttribute("data-besser", /^(amazon|ankauf)$/);
    await expect(fazit).toContainText("lohnt sich eher");
    // Wissenseintrag „Ankaufserver“: insider, Herkunft Call, Einzelmeinung – verlinkt
    await expect(page.getByTestId("de-ankauf-wissen")).toContainText("Ankaufserver (Einzelmeinung, ungeprüft)");
    const [w] = await sql<{ insider: boolean; origin: string; quelle_datum: string }>("select insider, origin, quelle_datum::text from knowledge_entries k join deal_eingaenge d on d.tenant_id = k.tenant_id where d.id = $1 and k.title like 'Ankaufserver%'", [id]);
    expect(w).toEqual({ insider: true, origin: "call", quelle_datum: "2026-11-04" });
    // Nicht nach außen: Antwort-Entwurf an den Lieferanten ohne Ankauf
    expect(await page.getByTestId("de-antwort").first().textContent()).not.toMatch(/ankauf/i);

    // B34.5 Warnung im Kaufen-Abschnitt – kein Stopp
    const warn = page.getByTestId("de-ankauf-warnung");
    await expect(warn).toContainText("Ankauf-Deal – vor dem Kauf prüfen");
    await expect(warn).toContainText("Annahmefrist fehlt");
    await expect(warn).toContainText("Rang/Legit-Check bestanden: noch offen");
    await expect(warn).toContainText("Ankäufer kauft noch an");
    await expect(warn).toContainText("Versandfrist fehlt");
    const g = page.getByTestId("de-gekauft-form");
    await g.locator('input[name="menge"]').fill("30");
    await g.locator('input[name="preis"]').fill("20");
    const schalter = g.getByTestId("de-bestellmail-schalter");
    if (await schalter.isEnabled()) await schalter.uncheck();
    await Promise.all([aktion(page), page.getByTestId("de-gekauft-knopf").click()]);
    const meldung = page.getByRole("status");
    await expect(meldung).toContainText("Als gekauft gespeichert: 30 Stk");
    await expect(meldung).toContainText("Ankauf-Deal – bitte prüfen");
    await expect(meldung).toContainText("Menge beim Ankäufer angemeldet (nur 10 von 30 Stk angemeldet)");
    await expect(meldung).toContainText("Aufgabe „Ankauf bestätigen“ bis");
    await expect(page.getByTestId("de-gekauft")).toContainText("Gekauft: 30 Stk");
    const [aufgabe] = await sql<{ title: string; priority: string; due: string; status: string; link: string }>("select title, priority, due_date::text due, status, link from tasks where system_key = $1", [`ankauf-bestaetigen:${id}`]);
    expect(aufgabe.title).toMatch(/^Ankauf bestätigen: .+ \(30 Stk an Testankauf \(erfunden\)\)$/);
    expect(aufgabe.priority).toBe("critical");
    expect(aufgabe.status).toBe("open");
    expect(aufgabe.link).toBe(`/deal-eingang/${id}#ankauf`);
    const [{ in2 }] = await sql<{ in2: string }>("select (current_date + 2)::text in2");
    expect(aufgabe.due).toBe(in2);
    // offen: Menge, „kauft noch an“, Annahmefrist, Versandfrist, Legit-Check (Ankäufer ist eingetragen)
    await expect(page.getByTestId("de-ankauf-check").locator('li[data-ok="0"]')).toHaveCount(5);
    await expect(page.getByTestId("de-ankauf-check")).toContainText("Ankäufer kauft noch an");
    await expect(page.getByTestId("de-ankauf-check")).toContainText("Versandfrist bekannt");

    // Ausgang „Verlust“ → Aufgabe erledigt, Frage in der Lernschleife
    await page.getByTestId("de-ankauf-ausgang-wahl").selectOption("verlust");
    await page.getByTestId("de-ankauf-ausgang-form").locator('input[name="notiz"]').fill("Annahme verweigert (Test)");
    await Promise.all([aktion(page), page.getByTestId("de-ankauf-ausgang-knopf").click()]);
    await expect(page.getByRole("status")).toContainText("Ausgang gespeichert: Verlust – Aufgabe erledigt, Frage in der Lernschleife");
    await expect(page.getByTestId("de-ankauf-ausgang")).toHaveAttribute("data-ausgang", "verlust");
    expect((await sql<{ status: string }>("select status from tasks where system_key = $1", [`ankauf-bestaetigen:${id}`]))[0].status).toBe("done");
    const [frage] = await sql<{ asin: string; gruende: string[]; units: number; gewinn: number; quelle: string }>("select asin, gruende, units, gewinn, quelle from lernschleife_fragen where schluessel = $1", [`ANKAUF|${id}`]);
    expect(frage).toEqual({ asin: ASIN, gruende: ["Ankauf: Verlust"], units: 30, gewinn: -600, quelle: `Testquelle ${m}` });
    await page.goto("/deal-eingang/lernen");
    await expect(page.locator(`[data-testid="dl-ls-frage"][data-asin="${ASIN}"]`)).toBeVisible();
    await expect(page.getByTestId("dl-ls-ankauf")).toContainText(/\d+ Verlust/);
  });
});
