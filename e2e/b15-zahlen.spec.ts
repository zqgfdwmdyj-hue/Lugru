// B15 Zahlen (Browser-Test 30.10.): Gewinn-Seite mit Quelle je Zeile, sellerboard als Ersatz, solange die
// Amazon-Abrechnung den Zeitraum nicht abdeckt; USt.-Zeilen und Rücklagen zählen nicht als Ergebnis.
// Erfundene Daten.
import { anmelden, expect, marke, sql, test } from "./helfer";

/** „Letzter Monat“ wie auf der Gewinn-Seite (Berliner Datum). */
function vormonat() {
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const [y, m] = heute.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const von = `${py}-${String(pm).padStart(2, "0")}-01`;
  const ende = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { von, bis: ende, mitte: `${von.slice(0, 8)}10` };
}

test.describe("B15 Zahlen", () => {
  test("Gewinn: Quelle je Zeile, sellerboard-Ersatz, USt. und Rücklage nicht im Ergebnis", async ({ page }) => {
    const m = marke();
    const { von, bis, mitte } = vormonat();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const sid = `b15-${m}`;
    const zeile = (i: number, tag: string, art: string | null, typ: string, beschr: string, betrag: number, sku: string | null, menge: number | null = null) =>
      sql(
        "insert into amazon_settlement_lines (tenant_id, settlement_id, row_hash, transaction_type, order_id, amount_type, amount_description, amount, posted_date, sku, quantity) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        [T, sid, `${sid}-${i}`, art, `028-${m}-0000001`, typ, beschr, betrag, tag, sku, menge],
      );
    const vorher = await sql<{ n: number }>("select count(*)::int n from amazon_settlement_lines where tenant_id = $1", [T]);
    test.skip(vorher[0].n > 0, "Testdatenbank hat schon Abrechnungen – Prüfung braucht einen leeren Stand");
    try {
      // Abrechnung nur bis Monatsmitte: 100 € netto + 19 € USt. (eigens ausgewiesen), Gebühr −15 €, Lager −5 €, Rücklage +904 €
      await zeile(1, mitte, "Order", "ItemPrice", "Principal", 100, "TEST-SOCKEN", 2);
      await zeile(2, mitte, "Order", "ItemPrice", "Tax", 19, "TEST-SOCKEN");
      await zeile(3, mitte, "Order", "ItemFees", "Commission", -15, "TEST-SOCKEN");
      await zeile(4, mitte, "other-transaction", "other-transaction", "Storage Fee", -5, null);
      await zeile(5, mitte, "other-transaction", "other-transaction", "Previous Reserve Amount Balance", 904, null);
      await sql(
        "insert into sellerboard_kpis (tenant_id, channel, from_day, to_day, sales, orders, units, net_profit, gross_profit, synced_at) values ($1, 'amazon', $2, $3, 2380, 20, 30, -525, -400, now())",
        [T, von, bis],
      );
      await anmelden(page, "inhaber");

      // 1) Abrechnung deckt den Monat nicht → Amazon-Zeile aus sellerboard, mit Quelle
      await page.goto("/gewinn?zeitraum=vormonat");
      const amazon = page.getByTestId("channel-amazon");
      await expect(amazon).toHaveAttribute("data-quelle", "sellerboard");
      await expect(page.getByTestId("channel-amazon-quelle")).toContainText(`sellerboard – Amazon-Abrechnung bis ${mitte.slice(8, 10)}.${mitte.slice(5, 7)}.`);
      await expect(amazon).toContainText("525,00");
      await expect(amazon).toContainText("2.000,00"); // 2.380 € brutto ÷ 1,19
      // Rücklage nur als Geldbewegung, nicht in den Kosten ohne SKU
      await expect(page.getByTestId("profit-transfers")).toContainText("Previous Reserve Amount Balance");

      // 2) Ohne sellerboard-Werte: Abrechnung mit Hinweis; USt. kein Ertrag (100 € netto, nicht 84,03 €), Rücklage nicht im Ergebnis
      await sql("delete from sellerboard_kpis where tenant_id = $1 and channel = 'amazon' and from_day = $2 and to_day = $3", [T, von, bis]);
      await page.goto("/gewinn?zeitraum=vormonat");
      await expect(amazon).toHaveAttribute("data-quelle", "abrechnung");
      await expect(page.getByTestId("channel-amazon-quelle")).toContainText("Zeitraum danach fehlt");
      await expect(amazon).toContainText("100,00");
      await expect(amazon).not.toContainText("84,03");

      // 3) Abrechnung bis Monatsende → Quelle Abrechnung ohne Hinweis
      await zeile(6, bis, "Order", "ItemFees", "FBAPerUnitFulfillmentFee", -1, "TEST-SOCKEN");
      await page.goto("/gewinn?zeitraum=vormonat");
      await expect(page.getByTestId("channel-amazon-quelle")).toHaveText(`Amazon-Abrechnung (bis ${bis.slice(8, 10)}.${bis.slice(5, 7)}.)`);
    } finally {
      await sql("delete from amazon_settlement_lines where tenant_id = $1 and settlement_id = $2", [T, sid]);
      await sql("delete from sellerboard_kpis where tenant_id = $1 and channel = 'amazon' and from_day = $2 and to_day = $3", [T, von, bis]);
    }
  });
});
