// Wunsch 06.11.: „Meldung offen“ bei anderen Kanälen (Temu, eBay, Kleinanzeigen …) auf einmal schließen statt jede
// einzeln. Amazon bleibt beim Weg über die Versandbestätigungs-Datei. WhatsApp und von Hand angelegte Aufträge stehen
// dort gar nicht (kein Kanal zum Melden). Alle Daten erfunden.
import { anmelden, expect, marke, sql, test } from "./helfer";

test.describe("Aufträge – Meldungen anderer Kanäle schließen", () => {
  test("Häkchen je Auftrag, ausgewählte auf einmal schließen; Amazon bleibt offen; einzeln auf der Detailseite", async ({ page }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const auftrag = async (channel: string, nr: string, fehler: string | null) =>
      (
        await sql<{ id: string }>(
          "insert into orders (tenant_id, channel, external_id, order_date, fulfillment, status, shipped_at, buyer_name, total, tracking_number, carrier, tracking_upload_error) values ($1, $2, $3, now() - interval '1 day', 'FBM', 'shipped', now() - interval '20 hours', 'Testkunde (erfunden)', 9.9, $4, 'DHL', $5) returning id",
          [T, channel, nr, `00340434TEST${m}${nr.slice(-1)}`, fehler],
        )
      )[0].id;
    const keine = "Keine Schnittstelle – bitte manuell im Kanal eintragen oder per Datei melden.";
    const wa = await auftrag("ebay", `EB-${m}-1`, "eBay: Sendungsnummer abgelehnt (Testfehler)");
    const wh = await auftrag("whatsapp", `WH-${m}-5`, null);
    const ha = await auftrag("manual", `HA-${m}-6`, keine);
    const ka = await auftrag("kleinanzeigen", `KA-${m}-2`, keine);
    const te = await auftrag("temu", `TE-${m}-3`, "Temu: Sendungsnummer abgelehnt (Testfehler)");
    const am = await auftrag("amazon", `AM-${m}-4`, null);
    const zeile = (nr: string) => page.locator("tr").filter({ hasText: nr });
    try {
      await anmelden(page, "inhaber");
      await page.goto("/auftraege?ansicht=fehler");
      await expect(page.getByTestId("meldungen-andere")).toContainText("Meldungen bei anderen Kanälen");
      // WhatsApp und von Hand: nie unter „Meldung offen“
      await expect(zeile(`WH-${m}-5`)).toHaveCount(0);
      await expect(zeile(`HA-${m}-6`)).toHaveCount(0);
      // Häkchen nur bei anderen Kanälen, Amazon ohne
      await expect(zeile(`EB-${m}-1`).getByTestId("meldung-auswahl")).toBeChecked();
      await expect(zeile(`AM-${m}-4`).getByTestId("meldung-auswahl")).toHaveCount(0);
      await expect(zeile(`TE-${m}-3`).getByTestId("meldung-auswahl")).toBeChecked();
      // Nur eBay + Kleinanzeigen schließen: alles abwählen (auch fremde Testaufträge), dann die zwei anhaken
      for (const box of await page.getByTestId("meldung-auswahl").all()) await box.uncheck();
      await zeile(`EB-${m}-1`).getByTestId("meldung-auswahl").check();
      await zeile(`KA-${m}-2`).getByTestId("meldung-auswahl").check();
      page.once("dialog", (d) => d.accept());
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("meldungen-schliessen").click()]);
      await expect(page.getByTestId("orders-msg")).toContainText("2 Meldungen als erledigt markiert");
      await expect(zeile(`EB-${m}-1`)).toHaveCount(0);
      await expect(zeile(`KA-${m}-2`)).toHaveCount(0);
      await expect(zeile(`TE-${m}-3`)).toHaveCount(1);
      await expect(zeile(`AM-${m}-4`)).toHaveCount(1);
      const stand = await sql<{ external_id: string; gemeldet: boolean; manuell: boolean; fehler: string | null }>(
        "select external_id, tracking_uploaded_at is not null as gemeldet, tracking_upload_manuell as manuell, tracking_upload_error as fehler from orders where id in ($1, $2, $3, $4) order by external_id",
        [wa, ka, te, am],
      );
      expect(stand.map((s) => [s.external_id.slice(0, 2), s.gemeldet, s.manuell])).toEqual([
        ["AM", false, false],
        ["EB", true, true],
        ["KA", true, true],
        ["TE", false, false],
      ]);
      expect(stand.find((s) => s.external_id.startsWith("EB"))!.fehler).toBeNull();

      // Einzeln auf der Detailseite: Temu „Im Kanal erledigt – schließen“
      await page.goto(`/auftraege/${te}`);
      await Promise.all([page.waitForURL(new RegExp(`/auftraege/${te}$`)), page.getByTestId("meldung-erledigt").click()]);
      await expect(page.getByTestId("meldung-status")).toContainText("Meldung von Hand als erledigt markiert");
      // Amazon: kein Knopf zum Schließen – dort zählt nur die hochgeladene Versandbestätigung
      await sql("update orders set tracking_upload_error = 'Testfehler' where id = $1", [am]);
      await page.goto(`/auftraege/${am}`);
      await expect(page.getByTestId("meldung-erledigt")).toHaveCount(0);
      await page.goto("/auftraege?ansicht=fehler");
      await expect(zeile(`TE-${m}-3`)).toHaveCount(0);
      await expect(zeile(`AM-${m}-4`)).toHaveCount(1);
    } finally {
      await sql("delete from orders where id in ($1, $2, $3, $4, $5, $6)", [wa, ka, te, am, wh, ha]);
    }
  });
});
