// Modul 3 + 6: Posteingang auf null (Regeln je Absender, automatisch archivieren, wichtige Zahlungsmails, Vorschlag je
// Mail) und Termin-Mails → Privatkalender des Inhabers statt Geschäfts-Posteingang. Erfundene Absender und Praxen.
import type { Page } from "@playwright/test";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const eml = (o: { von: string; betreff: string; text: string; id: string }) =>
  Buffer.from([`From: ${o.von}`, "To: info@test-firma.example", `Subject: ${o.betreff}`, `Message-ID: <${o.id}@example.invalid>`, `Date: ${new Date().toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"));
const tagPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

async function hochladen(page: Page, dateien: { name: string; buffer: Buffer }[]) {
  await page.goto("/posteingang");
  const form = page.getByTestId("eml-upload").first();
  await form.locator("input[type=file]").setInputFiles(dateien.map((d) => ({ ...d, mimeType: "message/rfc822" })));
  await Promise.all([aktion(page), form.locator("button[type=submit]").click()]);
  await expect(form.locator(".notice")).toBeVisible();
  return (await form.locator(".notice").textContent()) ?? "";
}

test.describe("Posteingang auf null und Termin-Mails", () => {
  test("Regel an Zuständigen, Auto-Archiv, Zahlung abgelehnt, Termin-Mails im Privatkalender, Vorschlag für Claude", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const [{ id: bueroId }] = await sql<{ id: string }>("select id from users where email = 'buero'");
    await anmelden(page, "inhaber");

    // Regel: Mails der (erfundenen) Steuerkanzlei → Aufgabe für Bea Büro
    await page.goto("/posteingang/regeln");
    const f = page.getByTestId("regel-form");
    await f.locator("#r-absender").fill(`@kanzlei-${m.toLowerCase()}.example`);
    await f.locator("#r-aktion").selectOption("weiterleiten");
    await f.locator("#r-person").selectOption(bueroId);
    await Promise.all([aktion(page), f.locator("button[type=submit]").click()]);
    await expect(f.getByRole("status")).toContainText("Regel gespeichert");
    await expect(page.getByTestId("regel-liste")).toContainText(`kanzlei-${m.toLowerCase()}.example`);

    const termin = tagPlus(6);
    const neu = tagPlus(8);
    const doctolib = eml({ von: "Doctolib <no-reply@doctolib.de>", betreff: `Ihr Termin ist bestätigt ${m}`, text: `Ihr Termin am ${dmy(termin)} um 09:30 Uhr bei Dr. Testmann${m} ist bestätigt.\nPraxis Dr. Testmann${m}, Musterstraße 12, 12345 Teststadt\nPatient: Ina\nBitte bringen Sie Ihre Versichertenkarte mit.`, id: `doc-${m}` });
    const antwort = await hochladen(page, [
      { name: "n.eml", buffer: eml({ von: "Seller University <seller-news@amazon.de>", betreff: `Webinar: Neuigkeiten für Verkäufer ${m}`, text: "Jetzt anmelden. Abbestellen hier.", id: `nl-${m}` }) },
      { name: "k.eml", buffer: eml({ von: `Kanzlei Test <post@kanzlei-${m.toLowerCase()}.example>`, betreff: `Unterlagen Q3 ${m}`, text: "Bitte Belege senden (erfunden).", id: `kz-${m}` }) },
      { name: "p.eml", buffer: eml({ von: "Billing <billing@saas-test.example>", betreff: `Pagamento rifiutato ${m}`, text: "Il pagamento è stato rifiutato.", id: `pay-${m}` }) },
      { name: "d.eml", buffer: doctolib },
    ]);
    expect(antwort).toMatch(/^4 neu/);

    // Newsletter beim Eingang archiviert; Zahlung abgelehnt (italienisch) kritisch mit Aufgabe; Kanzlei → Aufgabe für Bea
    const mails = await sql<{ subject: string; archived: boolean; category: string; task_id: string | null; regel_id: string | null }>("select subject, archived, category, task_id, regel_id from emails where subject like $1", [`%${m}%`]);
    const per = (s: string) => mails.find((x) => x.subject.includes(s));
    expect(per("Webinar")?.archived).toBe(true);
    expect(per("Pagamento")).toMatchObject({ archived: false, category: "critical" });
    expect(per("Pagamento")?.task_id).toBeTruthy();
    expect(per("Unterlagen Q3")?.regel_id).toBeTruthy();
    const [aufgabe] = await sql<{ assignee_id: string }>("select assignee_id from tasks where id = $1", [per("Unterlagen Q3")!.task_id]);
    expect(aufgabe.assignee_id).toBe(bueroId);
    // Termin-Mail nie im Geschäfts-Posteingang
    expect(per("Termin ist bestätigt")).toBeUndefined();
    expect((await sql("select 1 from emails where body_text like $1", [`%Dr. Testmann${m}%`])).length).toBe(0);

    // Im Privatkalender des Inhabers: Arzttermin mit Uhrzeit
    await page.goto(`/privat/kalender?ansicht=tag&tag=${termin}`);
    await expect(page.locator('[data-testid="pk-item"]', { hasText: `Dr. Testmann${m}` })).toBeVisible();

    // Dieselbe Mail noch einmal → schon bekannt; Verschiebung → neuer Tag, alter Tag leer
    expect(await hochladen(page, [{ name: "d2.eml", buffer: doctolib }])).toMatch(/0 neu, 1 schon bekannt/);
    await hochladen(page, [{ name: "v.eml", buffer: eml({ von: "Doctolib <no-reply@doctolib.de>", betreff: `Ihr Termin wurde verschoben ${m}`, text: `Ihr Termin bei Dr. Testmann${m} am ${dmy(termin)} wurde auf den ${dmy(neu)} um 11:15 Uhr verschoben.`, id: `ver-${m}` }) }]);
    await page.goto(`/privat/kalender?ansicht=tag&tag=${neu}`);
    await expect(page.locator('[data-testid="pk-item"]', { hasText: `Dr. Testmann${m}` })).toContainText("11:15");
    await page.goto(`/privat/kalender?ansicht=tag&tag=${termin}`);
    await expect(page.locator('[data-testid="pk-item"]', { hasText: `Dr. Testmann${m}` })).toHaveCount(0);

    // Posteingang-Seite: Spalte „Vorschlag“
    await page.goto("/posteingang?ansicht=kritisch");
    await expect(page.locator("tr", { hasText: `Pagamento rifiutato ${m}` }).getByTestId("mail-vorschlag")).toHaveText("als Aufgabe");

    // Claude (Inhaber mit Privat-Freigabe): Vorschlag je Mail und Zahl der Termin-Mails, ohne Inhalte
    const B = baseURL!;
    const claude = await mcpVerbinden(browser, B, "inhaber", { privat: true });
    const r = JSON.parse(await claude.call("posteingang", { suche: m }));
    expect(r.mails.find((x: { betreff: string }) => x.betreff.includes("Pagamento")).vorschlag).toBe("aufgabe");
    expect(r.mails.find((x: { betreff: string }) => x.betreff.includes("Unterlagen")).vorschlag).toBe("weiterleiten");
    expect(r.termin_mails.letzte_7_tage).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(r)).not.toContain(`Testmann${m}`);
    // Ohne Privat-Freigabe: kein Hinweis auf Termin-Mails
    const ohne = await mcpVerbinden(browser, B, "inhaber");
    const rb = JSON.parse(await ohne.call("posteingang", { suche: m }));
    expect(rb.termin_mails).toBeUndefined();
    expect(JSON.stringify(rb)).not.toContain("Testmann");
  });
});
