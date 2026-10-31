// Deal-Eingang: Lücken aus dem Abgleich mit dem Bauauftrag (Abschnitte 2, 4, 5, 7) – erfundene Daten.
// Risiken (Rechteinhaber-Beschwerde, selektiver Vertrieb, Gefahrgut), Keepa-Mini-Chart 90 Tage, Screenshot im
// Original ansehen (nur zum eigenen Eingang), weitere Einstellungen (Aufbewahrung, Mail-Adresse, iCloud-Link),
// Kurzbefehl-Anleitung mit Skizzen.
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

type Zeile = {
  asin: string | null;
  ampel: string;
  gruende: string[];
  risiken: string[];
};
const fertig = (id: string) =>
  expect
    .poll(
      async () =>
        (
          await sql<{ p: string }>(
            "select pruefung p from deal_eingaenge where id = $1",
            [id],
          )
        )[0]?.p,
      { timeout: 60_000 },
    )
    .toMatch(/fertig|fehler/);
const zeile = async (id: string) =>
  (
    await sql<{ zeilen: Zeile[] }>(
      "select zeilen from deal_eingaenge where id = $1",
      [id],
    )
  )[0].zeilen[0];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Deal-Eingang: Lücken aus dem Bauauftrag", () => {
  test("Einstellungen, Kurzbefehl-Skizzen, Risiken, Mini-Chart, Screenshot", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>(
      "select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1",
    );
    await anmelden(page, "inhaber");
    try {
      // 1) Weitere Einstellungen: ungültiger Kurzbefehl-Link wird abgelehnt, gültige Werte gespeichert; Budget bleibt
      await page.goto("/deal-eingang");
      const roiVorher = await page
        .locator('[data-testid="de-einstellungen-form"] input[name="zielRoi"]')
        .inputValue();
      await page.getByTestId("de-weitere").locator("summary").click();
      const f = page.getByTestId("de-weitere-form");
      await f
        .locator('input[name="kurzbefehlLink"]')
        .fill("https://example.invalid/kurzbefehl");
      await Promise.all([
        aktion(page),
        f.getByRole("button", { name: "Speichern" }).click(),
      ]);
      await expect(page.getByRole("status")).toContainText(
        "muss mit https://www.icloud.com/shortcuts/ beginnen",
      );
      await page.getByTestId("de-weitere").locator("summary").click();
      await f.locator('input[name="aufbewahrungMonate"]').fill("6");
      await f
        .locator('input[name="mailAdresse"]')
        .fill(`deals-${m.toLowerCase()}@example.invalid`);
      await f
        .locator('input[name="kurzbefehlLink"]')
        .fill(`https://www.icloud.com/shortcuts/test${m}`);
      await f.locator('input[name="preislisteAbZeilen"]').fill("20");
      await f.locator('input[name="maxReichweiteTage"]').fill("45");
      await Promise.all([
        aktion(page),
        f.getByRole("button", { name: "Speichern" }).click(),
      ]);
      await expect(page.getByRole("status")).toContainText(
        "Einstellungen gespeichert",
      );
      const [{ de }] = await sql<{ de: Record<string, unknown> }>(
        "select settings->'dealEingang' de from tenants where id = $1",
        [T],
      );
      expect(de).toMatchObject({
        aufbewahrungMonate: 6,
        mailAdresse: `deals-${m.toLowerCase()}@example.invalid`,
        kurzbefehlLink: `https://www.icloud.com/shortcuts/test${m}`,
        preislisteAbZeilen: 20,
        maxReichweiteTage: 45,
      });
      // Felder des anderen Formulars (Ziel-ROI, Budget) bleiben unverändert
      await expect(
        page.locator(
          '[data-testid="de-einstellungen-form"] input[name="zielRoi"]',
        ),
      ).toHaveValue(roiVorher);

      // 2) Kurzbefehl-Anleitung: iCloud-Link und Skizzen je Schritt
      await page.goto("/deal-eingang/kurzbefehl");
      await expect(
        page
          .getByTestId("de-iphone")
          .getByRole("link", { name: "iCloud-Link" }),
      ).toHaveAttribute("href", `https://www.icloud.com/shortcuts/test${m}`);
      await expect(page.getByTestId("de-skizze")).toHaveCount(4);
      await expect(page.getByTestId("de-anleitung")).toContainText(
        "Inhalte von URL abrufen",
      );

      // 3) Risiken: offene Rechteinhaber-Beschwerde zur ASIN → Rot; Lieferant ohne Marktplatz-Freigabe → Rot; Gefahrgut → Gelb
      await sql(
        "insert into amazon_vorgaenge (tenant_id, bereich, phase, status, titel, asins, fallnummer, erste_mail_am, letzte_mail_am) values ($1, 'marke', 'neu', 'offen', $2, '[\"B0TESTDE03\"]', '2000000001', now(), now())",
        [T, `Rechteinhaber-Beschwerde (Test ${m})`],
      );
      await sql(
        "insert into products (tenant_id, asin, title) values ($1, 'B0TESTDE02', 'Testtasse (erfunden)') on conflict do nothing",
        [T],
      );
      await sql(
        "update products set is_hazmat = true where tenant_id = $1 and asin = 'B0TESTDE02'",
        [T],
      );
      const [{ id: lid }] = await sql<{ id: string }>(
        "insert into suppliers (tenant_id, code, name) values ($1, $2, $3) returning id",
        [T, `TGH-${m}`, `Testgroßhandel ${m}`],
      );
      await sql(
        "insert into lieferanten_profile (tenant_id, supplier_id, wiederverkauf_erlaubt, marktplatz_erlaubt) values ($1, $2, true, false)",
        [T, lid],
      );

      const teilen = async (text: string, quelle: string, datei?: Buffer) => {
        const r = await page.request.post("/api/deal-eingang", {
          multipart: {
            text,
            quelle,
            ...(datei
              ? {
                  datei: {
                    name: `whatsapp-${m}.png`,
                    mimeType: "image/png",
                    buffer: datei,
                  },
                }
              : {}),
          },
          maxRedirects: 0,
        });
        expect(r.status()).toBe(303);
        const id = /\/deal-eingang\/([0-9a-f-]{36})/.exec(
          r.headers().location ?? "",
        )![1];
        await fertig(id);
        return id;
      };
      const ipId = await teilen(
        `B0TESTDE03 Testbecher 1,90 netto ab 30 Stk ${m}`,
        "Konrad",
      );
      const ip = await zeile(ipId);
      expect(ip.ampel).toBe("rot");
      expect(ip.gruende).toContain(
        "Offene Rechteinhaber-Beschwerde zu dieser ASIN (Fall 2000000001).",
      );

      const vtId = await teilen(
        `B0TESTDE02 Testtasse 3,10 netto ab 10 Stk ${m}`,
        `Testgroßhandel ${m}`,
        Buffer.concat([
          PNG,
          Buffer.from(
            `TESTOCR\nB0TESTDE02 Testtasse 3,10 netto ab 10 Stk ${m}`,
            "latin1",
          ),
        ]),
      );
      const vt = await zeile(vtId);
      expect(vt.ampel).toBe("rot");
      expect(vt.gruende[0]).toBe(
        `Lieferant Testgroßhandel ${m} erlaubt keinen Verkauf auf Marktplätzen (selektiver Vertrieb).`,
      );
      expect(vt.gruende[1]).toMatch(/^Gefahrgut \(laut Produktstamm\)/);

      // 4) Detailseite: Keepa-Mini-Chart 90 Tage (aus dem Zwischenspeicher), Gründe sichtbar
      await page.goto(`/deal-eingang/${ipId}`);
      await expect(page.getByTestId("de-chart").first()).toBeVisible();
      await expect(page.getByTestId("de-chart").first()).toContainText(
        /Keepa (DE|FR|IT|ES), Buy Box .* Ø .* Tief .* Stand/,
      );
      await expect(page.getByTestId("de-gruende").first()).toContainText(
        "Rechteinhaber-Beschwerde",
      );

      // 5) Screenshot im Original: Bild wird angezeigt; Datei nur über den eigenen Eingang erreichbar
      await page.goto(`/deal-eingang/${vtId}`);
      await page
        .locator("details", { hasText: "Originalnachricht" })
        .locator("summary")
        .click();
      const bild = page.getByTestId("de-bild");
      await expect(bild).toBeVisible();
      const src = (await bild.getAttribute("src"))!;
      const ok = await page.request.get(src);
      expect(ok.status()).toBe(200);
      expect(ok.headers()["content-type"]).toBe("image/png");
      const fileId = src.split("/").pop()!;
      expect(
        (
          await page.request.get(`/deal-eingang/${ipId}/datei/${fileId}`)
        ).status(),
      ).toBe(404);
    } finally {
      // Aufräumen: Einstellungen zurück auf Standard (andere Prüfungen laufen in derselben Datenbank)
      await sql(
        'update tenants set settings = jsonb_set(settings, \'{dealEingang}\', (settings->\'dealEingang\') || \'{"aufbewahrungMonate": 12, "preislisteAbZeilen": 15, "maxReichweiteTage": 60, "mailAdresse": ""}\'::jsonb) where id = $1',
        [T],
      );
    }
  });
});
