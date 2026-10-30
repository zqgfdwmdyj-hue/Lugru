// B15 Sofort (Browser-Test 30.10.): private Termine auf der Startseite nur „Privat belegt“ (nie Titel, Ort oder
// Betrag); Prep-Center-Aufträge buchen nicht vom eigenen Lager ab; alte Fehlbuchungen nur auf Klick zurückbuchen.
// Erfundene Daten.
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

test.describe("B15 Sofort", () => {
  test("Startseite: privater Kalender nur „Privat belegt“, ohne Betrag; Assistenz sieht ihn gar nicht", async ({
    page,
    browser,
  }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>(
      "select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1",
    );
    const start = new Date(Date.now() + 3 * 3_600_000);
    const tag = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Berlin",
    }).format(start);
    await sql(
      "insert into calendar_events (tenant_id, calendar_name, uid, title, starts_at, all_day, day, location) values ($1, 'Familie (privat)', $2, $3, $4, false, $5, $6)",
      [
        T,
        `b15-${m}`,
        `Kredit Rate 1.234,56 € ${m}`,
        start,
        tag,
        `Privatweg ${m}`,
      ],
    );
    // Termine erscheinen nur mit verbundenem Kalender – für diesen Test kurz eine (erfundene) Kalender-Anbindung.
    const ohneKalender =
      (
        await sql(
          "select 1 from integrations where tenant_id = $1 and provider = 'apple_calendar'",
          [T],
        )
      ).length === 0;
    if (ohneKalender)
      await sql(
        "insert into integrations (tenant_id, provider, label, config, secret_encrypted) select tenant_id, 'apple_calendar', 'Test (B15)', '{}'::jsonb, secret_encrypted from integrations where tenant_id = $1 and provider = 'keepa' limit 1",
        [T],
      );
    try {
      await anmelden(page, "inhaber");
      await page.goto("/");
      const body = page.locator("body");
      await expect(page.getByTestId("termin-privat").first()).toHaveText(
        "Privat belegt",
      );
      await expect(body).not.toContainText(`Kredit Rate 1.234,56 € ${m}`);
      await expect(body).not.toContainText(`Privatweg ${m}`);
      const ctx = await browser.newContext();
      const va = await ctx.newPage();
      await anmelden(va, "buero");
      await va.goto("/");
      await expect(va.locator("body")).not.toContainText(`Kredit Rate`);
      await ctx.close();
    } finally {
      if (ohneKalender)
        await sql(
          "delete from integrations where tenant_id = $1 and provider = 'apple_calendar' and label = 'Test (B15)'",
          [T],
        );
      await sql(
        "delete from calendar_events where tenant_id = $1 and uid = $2",
        [T, `b15-${m}`],
      );
    }
  });

  test("Prep Center bucht nicht vom eigenen Lager; alte Fehlbuchung → Reparatur nur auf Klick", async ({
    page,
  }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>(
      "select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1",
    );
    const bestand = async () =>
      (
        await sql<{ q: number }>(
          "select quantity q from own_stock where tenant_id = $1 and sku = 'TEST-SOCKEN'",
          [T],
        )
      )[0]?.q ?? 0;
    const auftrag = async (
      nr: string,
      shippedBy: string | null,
      status = "open",
    ) => {
      const [o] = await sql<{ id: string }>(
        "insert into orders (tenant_id, channel, external_id, order_date, fulfillment, status, shipped_by, buyer_name, total) values ($1, 'amazon', $2, now(), 'FBM', $3, $4, 'Testkunde (erfunden)', 9.9) returning id",
        [T, nr, status, shippedBy],
      );
      await sql(
        "insert into order_items (tenant_id, order_id, sku, quantity, title) values ($1, $2, 'TEST-SOCKEN', 2, 'Testsocken (erfunden)')",
        [T, o.id],
      );
      return o.id;
    };
    await anmelden(page, "inhaber");
    try {
      // 1) Prep Center verschickt → Bestand bleibt
      const vorher = await bestand();
      const prep = await auftrag(`303-${m}-0000001`, "prep");
      await page.goto(`/auftraege/${prep}`);
      await Promise.all([
        aktion(page),
        page
          .getByRole("button", { name: "Als versendet markieren & melden" })
          .click(),
      ]);
      await expect
        .poll(
          async () =>
            (
              await sql<{ s: string }>(
                "select status s from orders where id = $1",
                [prep],
              )
            )[0].s,
        )
        .toBe("shipped");
      expect(await bestand()).toBe(vorher);
      // 2) Selbst verschickt → −2
      const selbst = await auftrag(`303-${m}-0000002`, "self");
      await page.goto(`/auftraege/${selbst}`);
      await Promise.all([
        aktion(page),
        page
          .getByRole("button", { name: "Als versendet markieren & melden" })
          .click(),
      ]);
      await expect.poll(bestand).toBe(vorher - 2);

      // 3) Alte Fehlbuchung (Prep-Center-Auftrag mit eigener Abbuchung) → Vorschlag, erst der Klick bucht zurück
      const alt = await auftrag(`303-${m}-0000003`, "prep", "shipped");
      await sql(
        "insert into stock_movements (tenant_id, sku, delta, reason, reference) values ($1, 'TEST-SOCKEN', -2, 'Versand', $2)",
        [T, `amazon 303-${m}-0000003`],
      );
      await sql(
        "update own_stock set quantity = quantity - 2 where tenant_id = $1 and sku = 'TEST-SOCKEN'",
        [T],
      );
      const nachFehl = await bestand();
      await page.goto("/bestand");
      await expect(page.getByTestId("prep-reparatur")).toContainText(
        "vom eigenen Lager abgebucht",
      );
      expect(await bestand()).toBe(nachFehl); // ohne Klick passiert nichts
      await Promise.all([
        aktion(page),
        page
          .getByTestId("prep-reparatur")
          .getByRole("button", { name: "Zurückbuchen" })
          .click(),
      ]);
      await expect(page.getByRole("status").first()).toContainText(
        "zurückgebucht",
      );
      expect(await bestand()).toBe(nachFehl + 2);
      expect(alt).toBeTruthy();
    } finally {
      // Erfundene Aufträge wieder weg (sonst zählen sie in den Prep-Center-Monatszahlen anderer Prüfungen).
      await sql(
        "delete from orders where tenant_id = $1 and external_id like $2",
        [T, `303-${m}-%`],
      );
    }
  });
});
