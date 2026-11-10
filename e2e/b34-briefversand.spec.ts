// Bauauftrag B34.3a Briefversand per Anbieter-API + B34.3.6 AdelPrep-Beilage – Abnahme: Testanbieter im Testmodus
// (LetterXpress-Nachbau), 3 Test-Leads, Kostenvorschau stimmt, Testbrief an den Absender, Status kommt zurück, ohne
// AV-Haken kein Live-Versand, ohne Freigabe nichts verschickt. Beilage als eigener Brief mit eigenem Impressum; Text
// mit „all-in“ bzw. unbelegter Fläche wird nicht beigelegt. Alle Firmen, Adressen und Preise erfunden.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { extractText } from "unpdf";
import { E2E_ENV, TD } from "./env";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

function versiegeln(plain: string) {
  const key = createHash("sha256").update(`integrations:${E2E_ENV.APP_SECRET}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
type Job = { id: number; anbieter: string; mode: string; status: string; seiten: number; amount: number };
const jobs = () => fetch(`${TD}/__briefe`).then((r) => r.json() as Promise<Job[]>);
const briefeSetzen = (b: unknown) => fetch(`${TD}/__briefe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const meldung = (page: Page) => page.getByTestId("av-meldung");

test.describe.serial("B34.3a Briefversand + B34.3.6 Beilage", () => {
  const m = marke();
  const firma = (i: number) => `Testfriseur ${m} ${i} GmbH`;
  let T = "";

  test.beforeAll(async () => {
    [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);
    await sql("delete from integrations where tenant_id = $1 and provider = 'letterxpress'", [T]);
    await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'letterxpress', 'Test', $2::jsonb, $3)", [T, JSON.stringify({ username: "testkonto" }), versiegeln(JSON.stringify({ apiKey: "test-lxp-schluessel" }))]);
    await briefeSetzen({ zuruecksetzen: true });
  });
  test.afterAll(async () => {
    const muster = `Testfriseur ${m} %`;
    await sql("delete from abverkauf_briefe where tenant_id = $1 and charge_id in (select charge_id from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where l.firma like $2)", [T, muster]);
    await sql("delete from abverkauf_chargen where tenant_id = $1 and id in (select charge_id from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where l.firma like $2)", [T, muster]);
    await sql("delete from abverkauf_anschreiben where tenant_id = $1 and lead_id in (select id from abverkauf_leads where firma like $2)", [T, muster]);
    await sql("delete from abverkauf_leads where tenant_id = $1 and firma like $2", [T, muster]);
    await sql("delete from integrations where tenant_id = $1 and provider = 'letterxpress'", [T]);
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);
    await briefeSetzen({ zuruecksetzen: true });
  });

  test("Abnahme: Beilage-Prüfung, 3 Test-Leads, Kostenvorschau, Testbrief, Freigabe, Status, AV-Sperre, Kosten je Rücklauf", async ({ page }) => {
    test.setTimeout(240_000);
    await anmelden(page, "inhaber");
    await page.goto("/b2b/abverkauf");

    // B34.3.6 Beilage: ohne Firmendaten nicht bereit; „all-in“ + unbelegte Fläche werden abgelehnt
    const bl = page.getByTestId("av-beilage");
    await expect(bl).toHaveAttribute("data-bereit", "0");
    await page.getByTestId("av-ap-firma").fill("Testlogistik GmbH");
    await page.getByTestId("av-ap-strasse").fill("Lagerweg 1");
    await page.getByTestId("av-ap-plz").fill("12345");
    await page.getByTestId("av-ap-ort").fill("Musterstadt");
    await page.getByTestId("av-ap-email").fill("lager@example.invalid");
    await page.getByTestId("av-ap-impressum").fill("Amtsgericht Musterstadt HRB 00000 · USt-ID DE000000000 · Geschäftsführung: Testperson");
    await page.getByTestId("av-ap-text").fill("FBA-Prep all-in, 500 m² Lagerfläche.");
    await Promise.all([aktion(page), page.getByTestId("av-ap-speichern").click()]);
    await expect(page.getByTestId("av-ap-pruefung")).toContainText("„all-in“ vermeiden");
    await expect(page.getByTestId("av-ap-pruefung")).toContainText("Angabe „Fläche/Palettenplätze“ nicht belegt");
    await page.getByTestId("av-ap-text").fill("Wir übernehmen Wareneingang, Lagerung und FBA-Prep ab 0,40 € netto je Artikel (Testpreis).");
    await Promise.all([aktion(page), page.getByTestId("av-ap-speichern").click()]);
    await expect(page.getByTestId("av-beilage")).toHaveAttribute("data-bereit", "1");

    // B34.3a Anbieter LetterXpress im Testmodus, Preise aus den Einstellungen (erfunden: 0,90 € + 0,10 € je weitere Seite)
    await page.getByTestId("av-bv-anbieter").selectOption("letterxpress");
    await page.getByTestId("av-bv-preis-letterxpress").fill("0,90");
    await page.getByTestId("av-bv-seite-letterxpress").fill("0,10");
    await Promise.all([aktion(page), page.getByTestId("av-bv-speichern").click()]);
    await expect(meldung(page)).toContainText("Briefversand gespeichert.");

    // 3 Test-Leads per CSV, einer mit Zielgruppe AdelPrep
    const csv = ["Firma,Straße,PLZ,Ort,Kategorie,Zielgruppe AdelPrep", `${firma(1)},Testweg 1,12345,Musterstadt,Friseursalon,nein`, `${firma(2)},Testweg 2,12345,Musterstadt,Friseursalon,ja`, `${firma(3)},Testweg 3,12345,Musterstadt,Friseursalon,nein`].join("\n");
    const imp = page.getByTestId("av-import");
    await imp.locator('input[name="datei"]').setInputFiles({ name: `leads-${m}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await imp.locator('input[name="quelle"]').fill(`Testquelle ${m}`);
    await Promise.all([aktion(page), page.getByTestId("av-import-los").click()]);
    await expect(meldung(page)).toContainText("3 Leads neu");
    await Promise.all([page.waitForURL(/adelprep=1/), page.getByTestId("av-filter-adelprep").click()]);
    await expect(page.locator(`[data-testid="av-lead"][data-firma="${firma(2)}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="av-lead"][data-firma="${firma(1)}"]`)).toHaveCount(0);
    await page.goto("/b2b/abverkauf");
    for (const i of [1, 2, 3]) await page.locator(`[data-testid="av-lead"][data-firma="${firma(i)}"]`).locator('input[name="lead"]').check();
    await Promise.all([aktion(page), page.getByTestId("av-entwuerfe").click()]);
    await expect(meldung(page)).toContainText("3 Entwürfe angelegt");

    // Beilage je Brief zuwählen (nur beim AdelPrep-Lead)
    const zeile2 = page.getByTestId("av-anschreiben-zeile").filter({ hasText: firma(2) });
    await Promise.all([aktion(page), zeile2.getByTestId("av-beilage-schalter").click()]);
    await expect(page.getByTestId("av-anschreiben-zeile").filter({ hasText: firma(2) }).getByTestId("av-beilage-schalter")).toHaveAttribute("data-an", "1");
    for (const z of await page.locator('[data-testid="av-anschreiben-zeile"][data-status="entwurf"]').all()) {
      const box = z.locator('input[name="anschreiben"]');
      if ((await z.textContent())?.includes(`Testfriseur ${m} `)) await box.check();
      else await box.uncheck();
    }
    await Promise.all([aktion(page), page.getByTestId("av-freigeben").click()]);
    await expect(meldung(page)).toContainText("3 freigegeben");
    const [{ charge_id: C }] = await sql<{ charge_id: string }>("select a.charge_id from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where l.firma = $1", [firma(1)]);

    // Sammel-PDF: Beilage als eigenes Blatt der Logistik-Firma mit eigenem Impressum – nicht im Restposten-Brief
    const r = await page.request.get(`/b2b/abverkauf/datei?art=serienbrief&id=${C}`);
    const seiten = (await extractText(new Uint8Array(await r.body()), { mergePages: false })).text as string[];
    expect(seiten).toHaveLength(4);
    const beilage = seiten.filter((t) => t.includes("Eigenes Schreiben der Testlogistik GmbH"));
    expect(beilage).toHaveLength(1);
    expect(beilage[0].replace(/\s+/g, " ")).toContain("Impressum: Amtsgericht Musterstadt HRB 00000");
    expect(beilage[0]).toContain("ab 0,40 € netto je Artikel");
    for (const t of seiten.filter((x) => !x.includes("Eigenes Schreiben"))) expect(t).not.toContain("Testlogistik");

    // Versand-Seite: Vorschau + Kostenvorschau 0,90 + 1,00 (2 Seiten mit Beilage) + 0,90 = 2,80 €
    await page.goto("/b2b/abverkauf#erfolg");
    await page.locator(`[data-testid="av-charge"]`).filter({ has: page.locator(`a[href="/b2b/abverkauf/versand/${C}"]`) }).getByTestId("av-versand").click();
    await expect(page.getByTestId("versand")).toHaveAttribute("data-modus", "test");
    await expect(page.locator('[data-testid="versand-zeile"][data-ok="1"]')).toHaveCount(3);
    await expect(page.getByTestId("versand-summe")).toHaveAttribute("data-summe", "2.8");
    await expect(page.getByTestId("versand-summe")).toContainText("3 Briefe · 2,80 € netto");
    // Ohne Testbrief und ohne Freigabe: nichts beim Anbieter
    await expect(page.getByTestId("versand-sperre")).toContainText("Zuerst einen Testbrief an die eigene Adresse schicken.");
    expect(await jobs()).toHaveLength(0);

    // Testbrief an den Absender (Testmodus)
    await Promise.all([aktion(page), page.getByTestId("versand-testbrief").click()]);
    await expect(page.getByTestId("versand-meldung")).toContainText(/Testbrief an .+ an LetterXpress übergeben \(Testmodus – nichts gedruckt\)/);
    expect((await jobs()).map((j) => j.mode)).toEqual(["test"]);

    // Ohne Bestätigung der Kosten (Freigabe) wird nichts verschickt
    await Promise.all([aktion(page), page.getByTestId("versand-los").click()]);
    await expect(page.getByTestId("versand-meldung")).toContainText("ohne Freigabe wird nichts verschickt");
    expect(await jobs()).toHaveLength(1);

    // Freigabe: 3 Briefe an den Anbieter, Kosten laut Anbieter = Kostenvorschau
    await page.getByTestId("versand-bestaetigt").check();
    await Promise.all([aktion(page), page.getByTestId("versand-los").click()]);
    await expect(page.getByTestId("versand-meldung")).toContainText("3 Briefe an LetterXpress übergeben (Testmodus – nichts gedruckt), 2,80 € netto");
    const nachher = await jobs();
    expect(nachher).toHaveLength(4);
    expect(nachher.slice(1).map((j) => j.seiten).sort()).toEqual([1, 1, 2]);
    expect(Math.round(nachher.slice(1).reduce((n, j) => n + j.amount, 0) * 100) / 100).toBe(2.8);
    const [{ s: dbKosten }] = await sql<{ s: string }>("select sum(kosten_netto)::text s from abverkauf_briefe where tenant_id = $1 and charge_id = $2 and testbrief = false", [T, C]);
    expect(Number(dbKosten)).toBe(2.8);

    // Status kommt zurück: Anbieter meldet gedruckt + zugestellt
    await briefeSetzen({ alle: true, status: "done", tracking_status: "Zugestellt: Die Sendung wurde erfolgreich zugestellt (Test)." });
    await Promise.all([aktion(page), page.getByTestId("versand-status").click()]);
    await expect(page.getByTestId("versand-meldung")).toContainText("4 Status aktualisiert.");
    await expect(page.locator('[data-testid="versand-brief"][data-status="zugestellt"]')).toHaveCount(4);

    // Live ohne AV-Haken: gesperrt (auch kein Testbrief)
    await page.goto("/b2b/abverkauf#briefversand");
    await page.getByTestId("av-bv-live").check();
    await Promise.all([aktion(page), page.getByTestId("av-bv-speichern").click()]);
    await expect(meldung(page)).toContainText("Live-Versand bleibt gesperrt, bis der AV-Vertrag bestätigt ist");
    await page.goto(`/b2b/abverkauf/versand/${C}`);
    await expect(page.getByTestId("versand")).toHaveAttribute("data-modus", "live");
    await expect(page.getByTestId("versand-sperre")).toContainText("Ohne bestätigten AV-Vertrag kein Live-Versand");
    await Promise.all([aktion(page), page.getByTestId("versand-testbrief").click()]);
    await expect(page.getByTestId("versand-meldung")).toContainText("Ohne bestätigten AV-Vertrag kein Live-Versand.");
    expect(await jobs()).toHaveLength(4);

    // Mit AV-Haken: Testbrief live, dann Charge live → Kosten je Charge und je Rücklauf in der Erfolgskontrolle
    await page.goto("/b2b/abverkauf#briefversand");
    await page.getByTestId("av-bv-av").check();
    await Promise.all([aktion(page), page.getByTestId("av-bv-speichern").click()]);
    await page.goto(`/b2b/abverkauf/versand/${C}`);
    await Promise.all([aktion(page), page.getByTestId("versand-testbrief").click()]);
    await expect(page.getByTestId("versand-meldung")).toContainText("übergeben (live)");
    await page.getByTestId("versand-bestaetigt").check();
    await Promise.all([aktion(page), page.getByTestId("versand-los").click()]);
    await expect(page.getByTestId("versand-meldung")).toContainText("3 Briefe an LetterXpress übergeben (live), 2,80 € netto");
    await sql("update abverkauf_anschreiben set status = 'beantwortet', antwort_am = now() where tenant_id = $1 and lead_id = (select id from abverkauf_leads where firma = $2)", [T, firma(1)]);
    await page.goto("/b2b/abverkauf#erfolg");
    const ch = page.locator('[data-testid="av-charge"]').filter({ has: page.locator(`a[href="/b2b/abverkauf/versand/${C}"]`) });
    await expect(ch.getByTestId("av-charge-kosten")).toContainText("2,80 €");
    await expect(ch.getByTestId("av-charge-je-ruecklauf")).toContainText("2,80 €");
  });
});
