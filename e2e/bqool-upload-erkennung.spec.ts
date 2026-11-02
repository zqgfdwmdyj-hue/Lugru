// Befund 02.11.: BQool-Uploads standen als „Fehler: Keine Erfolgsmeldung“, obwohl sie geklappt hatten. Jetzt zählen
// auch kurz eingeblendete Hinweise und die Antwort des Servers; feste Texte der Seite (Verlauf mit „Completed/Failed“)
// zählen nicht. Ohne jede Bestätigung: „bitte in BQool prüfen“ (gelb) statt Fehler, mit Knopf „hat geklappt“.
// Test-Nachbau der Upload-Seiten (toast, still, ajaxfehler, nichts), erfundene SKU.
import { aktion, anmelden, expect, marke, sql, test, testdienste } from "./helfer";
import { TD } from "./env";

test.describe("BQool-Upload: Erfolg erkennen", () => {
  test("kurzer Hinweis / stille Annahme = hochgeladen, Ablehnung = Fehler; nichts erkannt = bitte prüfen → „hat geklappt“", async ({ page }) => {
    test.setTimeout(300_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ config: vorher }] = await sql<{ config: Record<string, string> }>("select config from integrations where tenant_id = $1 and provider = 'bqool_web'", [T]);
    const setzen = (cfg: Record<string, string>) => sql("update integrations set config = $2::jsonb where tenant_id = $1 and provider = 'bqool_web'", [T, JSON.stringify({ ...vorher, ...cfg })]);
    const zeile = (land: string) => ({ land, sku: `TEST-BQU-${m}`, cost: 5.95, zusatz: 0, regel: "ia", min: 12.99, max: 25.98 });
    const exportAnlegen = async (laender: string[]) =>
      (await sql<{ id: string }>("insert into bqool_exporte (tenant_id, laender, nur_aenderungen, zeilen, anzahl) values ($1, $2::jsonb, false, $3::jsonb, '{}'::jsonb) returning id", [T, JSON.stringify(laender), JSON.stringify(laender.map(zeile))]))[0].id;
    const uebertragen = async (id: string) => {
      await page.goto(`/repricer/bqool?export=${id}`);
      await page.getByTestId("bq-automatik").locator('input[name="bestaetigt"]').check();
      await Promise.all([aktion(page), page.getByTestId("bq-automatik").getByRole("button").click()]);
    };
    const protokoll = async (id: string) => (await sql<{ p: string; u: string }>("select protokoll::text as p, uebertragung as u from bqool_exporte where id = $1", [id]))[0];
    try {
      await anmelden(page, "inhaber");

      // 1) DE: Hinweis nur 0,7 s sichtbar · FR: keine Meldung, Server nimmt an · IT: Server lehnt ab (JSON)
      await setzen({ uploadUrl: `${TD}/web-bqool/upload/toast`, uploadUrlFR: `${TD}/web-bqool/upload/still`, uploadUrlIT: `${TD}/web-bqool/upload/ajaxfehler` });
      const e1 = await exportAnlegen(["DE", "FR", "IT"]);
      const vor = (await testdienste.web()).filter((w) => w.dienst === "bqool").length;
      await uebertragen(e1);
      await expect(page.getByRole("status")).toContainText("2 von 3 Ländern bei BQool hochgeladen", { timeout: 150_000 });
      await expect(page.getByRole("status")).toContainText("DE: 1 Zeile hochgeladen · FR: 1 Zeile hochgeladen · IT: Fehler");
      await expect(page.getByRole("status")).toContainText("Invalid header line");
      expect((await testdienste.web()).filter((w) => w.dienst === "bqool").slice(vor).map((w) => w.land)).toEqual(["toast", "still"]);
      const p1 = await protokoll(e1);
      expect(p1.p).toContain("Bestätigung auf der Seite");
      expect(p1.p).toContain("vom Server angenommen");
      expect(p1.u).toBe("teilweise");

      // 2) Nichts erkannt (Knopf schickt nichts ab): kein Fehler, sondern „bitte in BQool prüfen“ + normale Aufgabe
      await setzen({ uploadUrl: `${TD}/web-bqool/upload/nichts` });
      const e2 = await exportAnlegen(["DE"]);
      await uebertragen(e2);
      await expect(page.getByRole("status")).toContainText("ohne erkannte Bestätigung – bitte in BQool prüfen", { timeout: 150_000 });
      await expect(page.getByTestId("bq-uebertragung")).toContainText("Bestätigung bitte in BQool prüfen");
      expect((await protokoll(e2)).u).toBe("pruefen");
      const aufgabe = async () => (await sql<{ title: string; priority: string; status: string }>("select title, priority, status from tasks where tenant_id = $1 and system_key = $2", [T, `automatik-bqool-${e2}`]))[0];
      expect(await aufgabe()).toMatchObject({ title: "BQool-Upload: DE bitte kurz in BQool prüfen", priority: "normal", status: "open" });

      // In BQool nachgesehen → „hat geklappt“: Zeile grün „von Hand bestätigt“, Status fertig, Aufgabe erledigt
      await page.goto("/anbindungen");
      const z = page.getByTestId("bq-upload-zeile").filter({ has: page.locator(`a[href="/repricer/bqool?export=${e2}"]`) });
      await expect(z.getByTestId("bq-upload-pruefen")).toBeVisible();
      await Promise.all([page.waitForURL(/\/anbindungen/), z.getByTestId("bq-upload-geklappt").click()]);
      await expect(z).toContainText("hochgeladen (von Hand bestätigt)");
      const p2 = await protokoll(e2);
      expect(p2.u).toBe("fertig");
      expect(p2.p).toContain("von Hand als hochgeladen bestätigt");
      expect((await aufgabe()).status).toBe("done");
    } finally {
      await sql("update integrations set config = $2::jsonb where tenant_id = $1 and provider = 'bqool_web'", [T, JSON.stringify(vorher)]);
    }
  });
});
