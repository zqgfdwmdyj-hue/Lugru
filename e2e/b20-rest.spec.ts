// B20.3/B20.6/B20.9 mit erfundenen Daten: Schwelle je Quelle zeigt den gültigen Wert (Platzhalter ist kein Wert);
// neuer grüner Aufruf mail_markieren → „↩ Rückgängig“ im Verlauf und es wirkt; VA-Nachrichten mit Sprachkennzeichen;
// BQool-Regel-Katalog mit „AI Win Sales Booster“ als Strategie.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

test.describe("B20 Rest", () => {
  test("Schwelle je Quelle „gilt“, Rückgängig nach mail_markieren, Sprachkennzeichen, AI Win Sales Booster", async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await anmelden(page, "inhaber");

    // B20.3: Platzhalter sieht nicht wie ein Wert aus; daneben die gültige Schwelle je Quelle
    await page.goto("/deal-eingang");
    const feld = page.getByTestId("de-schwelle-je");
    await expect(feld).toHaveAttribute("placeholder", /^leer = überall \d+/);
    await expect(page.getByTestId("de-schwelle-gilt")).toContainText(/gilt: .*Lugru Deals \d+/);

    // B20.6: neuer grüner Aufruf (mail_markieren) → im Verlauf „↩ Rückgängig“, Klick stellt den Stand wieder her
    const [mail] = await sql<{ id: string }>("insert into emails (tenant_id, message_key, from_address, subject, body_text, received_at, category) values ($1, $2, 'test@example.invalid', $3, 'Erfundene Testmail.', now(), 'info') returning id", [T, `<b20-undo-${m}@example.invalid>`, `B20 Rückgängig ${m}`]);
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const r = JSON.parse(await mcp.call("mail_markieren", { ids: [mail.id], als: "erledigt" })) as { ok: boolean; markiert: number };
    expect(r).toMatchObject({ ok: true, markiert: 1 });
    expect((await sql<{ archived: boolean }>("select archived from emails where id = $1", [mail.id]))[0].archived).toBe(true);
    await page.goto("/assistent-verlauf");
    const eintrag = page.locator('[data-testid="verlauf-eintrag"][data-tool="mail_markieren"]').first();
    await expect(eintrag.getByTestId("verlauf-rueckgaengig")).toBeVisible();
    await Promise.all([aktion(page), eintrag.getByTestId("verlauf-rueckgaengig").click()]);
    await expect.poll(async () => (await sql<{ archived: boolean }>("select archived from emails where id = $1", [mail.id]))[0].archived).toBe(false);

    // B20.9: Sprachkennzeichen je VA-Nachricht (übersetzt: EN → DE; sonst die Sprache)
    await sql(
      "insert into va_nachrichten (tenant_id, discord_id, kanal_id, von, text, original, sprache, art, gesendet_am) values ($1, $2, '900000000000000001', 'va', 'Erledigt: Etiketten gedruckt (erfunden).', 'Done: labels printed (made up).', 'en', 'info', now()), ($1, $3, '900000000000000001', 'va', 'Kurze Info auf Deutsch (erfunden).', null, 'de', 'info', now())",
      [T, `b20-en-${m}`, `b20-de-${m}`],
    );
    await page.goto("/delegation/va");
    const tags = await page.getByTestId("va-sprache-tag").allTextContents();
    expect(tags).toEqual(expect.arrayContaining(["EN → DE", "DE"]));

    // B20.9: Regel-Katalog nennt „AI Win Sales Booster“ als Strategie mit Erklärung
    await page.goto("/repricer/bqool");
    const katalog = page.getByTestId("bq-katalog");
    await expect(katalog.locator('input[name="name"][value="AI Win Sales Booster"]')).toHaveCount(1);
    await expect(katalog.locator('input[value*="Buy Box gewinnen"]')).toHaveCount(1);
  });
});
