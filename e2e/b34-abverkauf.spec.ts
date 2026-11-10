// Bauauftrag B34.3 B2B-Abverkauf von Ladenhütern – Abnahme: Preisliste (PDF + Excel, ohne EK/Break-even/interne
// Gründe) aus einem Ladenhüter, 10 Test-Leads per CSV, E-Mail an Fremdkontakte ohne „Rechtlich geprüft“ gesperrt
// (keine Mail raus), Serienbrief-PDF mit Datenschutzhinweis nach Art. 14 DSGVO. Dazu: Antwort im Posteingang →
// Aufgabe, Abmeldung → Sperrliste (erneuter Import blockiert), Erfolg je Charge, E-Mail erst mit „Rechtlich geprüft“.
// Alle Firmen, Adressen und Artikel erfunden (Testspielwaren …, example.invalid).
import type { Page } from "@playwright/test";
import { extractText } from "unpdf";
import * as XLSX from "xlsx";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

const INTERN = /break-?even|\bEK\b|einkaufspreis|ladenhüter|reichweite|kapital\b|insider|wochen-?call/i;

async function pdfText(page: Page, href: string) {
  const r = await page.request.get(href);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("application/pdf");
  // Zeilenumbrüche im PDF wie Leerzeichen behandeln (Hinweistexte sind umbrochen)
  return ((await extractText(new Uint8Array(await r.body()), { mergePages: true })).text as string).replace(/\s+/g, " ");
}

const eml = (o: { von: string; betreff: string; text: string; id: string }) =>
  Buffer.from([`From: Testhändler <${o.von}>`, "To: info@test-firma.example", `Subject: ${o.betreff}`, `Message-ID: <${o.id}@example.invalid>`, `Date: ${new Date().toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"));

test.describe("B34.3 Abverkauf an Händler", () => {
  const m = marke();
  const SKU = `TEST-LH-${m}`;
  const firma = (i: number) => `Testspielwaren ${m} ${String(i).padStart(2, "0")} GmbH`;
  const mail = (i: number) => `info${i}-${m.toLowerCase()}@example.invalid`;
  const start = new Date();
  let T = "";

  test.afterAll(async () => {
    if (!T) return;
    const muster = `Testspielwaren ${m} %`;
    await sql("delete from abverkauf_chargen where tenant_id = $1 and id in (select charge_id from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where l.firma like $2)", [T, muster]);
    await sql("delete from abverkauf_anschreiben where tenant_id = $1 and lead_id in (select id from abverkauf_leads where firma like $2)", [T, muster]);
    await sql("delete from abverkauf_leads where tenant_id = $1 and firma like $2", [T, muster]);
    await sql("delete from abverkauf_sperrliste where tenant_id = $1 and created_at >= $2", [T, start]);
    await sql("delete from abverkauf_preislisten where tenant_id = $1 and positionen::text like $2", [T, `%${m}%`]);
    await sql("delete from tasks where tenant_id = $1 and title like $2", [T, `%Testspielwaren ${m}%`]);
    await sql("delete from emails where tenant_id = $1 and from_address like $2", [T, `%-${m.toLowerCase()}@example.invalid`]);
    await sql("delete from sellerboard_inventory where tenant_id = $1 and sku = $2", [T, SKU]);
    await sql("delete from lots where tenant_id = $1 and sku = $2", [T, SKU]);
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);
  });

  test("Abnahme: Preisliste PDF/Excel, 10 Leads per CSV, Mail ohne „Rechtlich geprüft“ gesperrt, Serienbrief mit Datenschutzhinweis; Antwort, Sperrliste, Erfolg", async ({ page }) => {
    test.setTimeout(240_000);
    // Ladenhüter: 20 Stück à 20 € EK, keine Verkäufe → Reichweite „keine Verkäufe“, Kapital 400 € (> 300 €)
    const [{ tenant_id, product_id }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    T = tenant_id;
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date - 120, 20, '20.00')", [T, product_id, SKU]);
    await sql("insert into sellerboard_inventory (tenant_id, sb_id, sku, asin, name, fba_stock, synced_at) values ($1, $2, $2, null, $3, 20, now())", [T, SKU, `Testpuzzle ${m} 1000 Teile (erfunden)`]);
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);

    await anmelden(page, "inhaber");
    await page.goto("/b2b/abverkauf");
    await expect(page.getByTestId("av-rechtlich")).not.toBeChecked();

    // 1. Preisliste: nur unser Ladenhüter
    const kandidat = page.locator(`[data-testid="av-kandidat"][data-sku="${SKU}"]`);
    await expect(kandidat).toContainText("keine Verkäufe");
    for (const z of await page.locator('[data-testid="av-kandidat"]').all()) if ((await z.getAttribute("data-sku")) !== SKU) await z.locator('input[name="sku"]').uncheck();
    await Promise.all([aktion(page), page.getByTestId("av-preisliste-los").click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("Preisliste erzeugt (1 Positionen)");
    const pdfHref = await page.getByTestId("av-pdf").first().getAttribute("href");
    const xlsxHref = await page.getByTestId("av-xlsx").first().getAttribute("href");
    const preisliste = await pdfText(page, pdfHref!);
    expect(preisliste).toContain("Restposten-Preisliste");
    expect(preisliste).toContain(`Testpuzzle ${m} 1000 Teile (erfunden)`);
    expect(preisliste).toMatch(/\d+,\d{2} €/);
    expect(preisliste).toContain("netto");
    expect(preisliste).not.toMatch(INTERN);
    expect(preisliste).not.toContain(SKU);
    const x = await page.request.get(xlsxHref!);
    expect(x.status()).toBe(200);
    const blatt = XLSX.read(await x.body(), { type: "buffer" });
    const zeilen = XLSX.utils.sheet_to_json<unknown[]>(blatt.Sheets[blatt.SheetNames[0]], { header: 1 });
    expect(zeilen[0]).toEqual(["Artikel", "ASIN", "Menge", "Preis netto je Stück (EUR)", "Staffelpreise"]);
    expect(zeilen[1][0]).toBe(`Testpuzzle ${m} 1000 Teile (erfunden)`);
    expect(zeilen[1][2]).toBe(20);
    expect(JSON.stringify(zeilen)).not.toMatch(INTERN);
    // Preis nie unter Break-even (intern in der Tabelle der Seite sichtbar, nicht in der Datei)
    const be = Number((await kandidat.locator("td").nth(5).innerText()).replace(/[^\d,]/g, "").replace(",", "."));
    expect(Number(zeilen[1][3])).toBeGreaterThan(be);

    // 2. Leads per CSV: 10 erfundene Händler; E-Mail nur mit Quelle Impressum (Nr. 4: Kontaktseite → verworfen)
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = [
      ["title", "address", "categoryName", "emails", "E-Mail-Quelle", "website"].join(","),
      ...Array.from({ length: 10 }, (_, k) => {
        const i = k + 1;
        return [firma(i), `Spielweg ${i}, ${10000 + i} Musterstadt`, "Spielwarengeschäft", i <= 4 ? mail(i) : "", i <= 3 ? "Impressum" : i === 4 ? "Kontaktseite" : "", `https://laden${i}.example.invalid`].map(q).join(",");
      }),
    ].join("\n");
    const imp = page.getByTestId("av-import");
    await imp.locator('input[name="datei"]').setInputFiles({ name: `leads-${m}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await imp.locator('input[name="quelle"]').fill("Testverzeichnis (erfunden)");
    await Promise.all([aktion(page), page.getByTestId("av-import-los").click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("10 Leads neu, 0 schon vorhanden, 0 auf der Sperrliste, 1 E-Mail(s) verworfen");
    const lead = (i: number) => page.locator(`[data-testid="av-lead"][data-firma="${firma(i)}"]`);
    await expect(page.locator(`[data-testid="av-lead"][data-firma^="Testspielwaren ${m} "]`)).toHaveCount(10);
    await expect(lead(1)).toContainText("Testverzeichnis (erfunden)");
    await expect(lead(1)).toContainText("Art. 6 Abs. 1 lit. f DSGVO");
    const [roh] = await sql<{ strasse: string; email: string | null; email_quelle: string | null; loeschen_am: string }>("select strasse, email, email_quelle, loeschen_am::text from abverkauf_leads where tenant_id = $1 and firma = $2", [T, firma(1)]);
    expect(roh.strasse).not.toContain("Spielweg"); // verschlüsselt gespeichert
    expect(roh.email).not.toContain("@");
    expect(roh.email_quelle).toBe("Impressum");
    expect((await sql<{ n: number }>("select count(*)::int n from abverkauf_leads where tenant_id = $1 and firma = $2 and email is null", [T, firma(4)]))[0].n).toBe(1);

    // 3. E-Mail an Fremdkontakt: auch mit Einwilligung gesperrt, solange „Rechtlich geprüft“ aus ist
    await lead(1).locator('select[name="kontaktweg"]').selectOption("email");
    await lead(1).locator('input[name="einwilligung"]').fill("Messe-Gespräch 2026, Visitenkarte (Test)");
    await Promise.all([aktion(page), lead(1).getByRole("button", { name: "✓" }).click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("Lead gespeichert");
    await expect(lead(1).getByTestId("av-mail-status")).toContainText("E-Mail gesperrt");
    await expect(lead(1).getByTestId("av-mail-status")).toContainText("Rechtlich geprüft");

    // 4. Entwürfe (KI oder Vorlage) für 3 Händler – nichts verschickt
    for (const i of [1, 2, 3]) await lead(i).locator('input[name="lead"]').check();
    await Promise.all([aktion(page), page.getByTestId("av-entwuerfe").click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("3 Entwürfe angelegt – nichts verschickt");
    const unsere = page.locator('[data-testid="av-anschreiben-zeile"]').filter({ hasText: `Testspielwaren ${m} ` });
    await expect(unsere).toHaveCount(3);
    await expect(unsere.and(page.locator('[data-status="entwurf"]'))).toHaveCount(3);
    for (const z of await page.locator('[data-testid="av-anschreiben-zeile"][data-status="entwurf"]').all()) if (!(await z.innerText()).includes(`Testspielwaren ${m} `)) await z.locator('input[name="anschreiben"]').uncheck();
    const texte = await sql<{ text: string; betreff: string }>("select a.text, a.betreff from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where a.tenant_id = $1 and l.firma like $2", [T, `Testspielwaren ${m} %`]);
    for (const t of texte) {
      expect(t.betreff).toMatch(/^Restposten-Angebot für Testspielwaren .+ \(AV-[A-Z0-9]{6}\)$/);
      expect(`${t.betreff}\n${t.text}`).not.toMatch(INTERN);
    }

    // Freigabe als Charge: Briefe frei, E-Mail gesperrt – keine Mail raus
    await Promise.all([aktion(page), page.getByTestId("av-freigeben").click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("2 freigegeben");
    await expect(page.getByTestId("av-meldung")).toContainText(`gesperrt: ${firma(1)}: E-Mail an Fremdkontakte gesperrt`);
    const mailZeile = unsere.and(page.locator('[data-kanal="email"]'));
    await expect(mailZeile).toHaveAttribute("data-status", "entwurf");
    await expect(mailZeile.getByTestId("av-fehler")).toContainText("Rechtlich geprüft");
    await expect(unsere.and(page.locator('[data-kanal="brief"][data-status="freigegeben"]'))).toHaveCount(2);
    expect((await sql<{ n: number }>(`select count(*)::int n from test_mails where tenant_id = $1 and "to" like $2`, [T, `%-${m.toLowerCase()}@example.invalid`]))[0].n).toBe(0);

    // Serienbrief-PDF: je Händler eine Seite mit Anschrift, Text und Datenschutzhinweis (Art. 14 DSGVO)
    const charge = page.getByTestId("av-charge").first();
    await expect(charge).toContainText("Brief");
    const brief = await pdfText(page, (await charge.getByTestId("av-serienbrief").getAttribute("href"))!);
    for (const s of ["Art. 14 DSGVO", "Testverzeichnis (erfunden)", "Art. 6 Abs. 1 lit. f DSGVO", "widersprechen", "Abmelden", "Sperrliste", firma(2), firma(3), "Spielweg 2", "10002 Musterstadt"]) expect(brief).toContain(s);
    expect(brief).not.toContain(firma(1));
    expect(brief).toMatch(/AV-[A-Z0-9]{6}/);
    expect(brief).not.toMatch(INTERN);
    const codes = Object.fromEntries((await sql<{ firma: string; code: string }>("select l.firma, a.code from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where a.tenant_id = $1 and l.firma like $2", [T, `Testspielwaren ${m} %`])).map((r) => [r.firma, r.code]));
    await Promise.all([aktion(page), charge.getByRole("button", { name: "als verschickt markieren" }).click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("als verschickt markiert");

    // Antworten im Posteingang: Bestellung (Nr. 2) → Aufgabe; Abmeldung (Nr. 3) → Sperrliste
    await page.goto("/posteingang");
    const form = page.getByTestId("eml-upload").first();
    await form.locator("input[type=file]").setInputFiles([
      { name: `av2-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: mail(2), betreff: `Re: Restposten-Angebot für ${firma(2)} (${codes[firma(2)]})`, text: "Guten Tag, gerne 10 Stück, bitte Rechnung schicken.", id: `av2-${m}` }) },
      { name: `av3-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: mail(3), betreff: `Re: Restposten-Angebot (${codes[firma(3)]})`, text: "Bitte keine Angebote mehr senden.", id: `av3-${m}` }) },
    ]);
    await form.getByRole("button", { name: "Hochladen", exact: true }).click();
    await expect(form).toContainText("2 neu");
    expect((await sql<{ n: number }>("select count(*)::int n from emails where tenant_id = $1 and from_address in ($2, $3)", [T, mail(2), mail(3)]))[0].n).toBe(2);
    const aufgaben = await sql<{ title: string; link: string }>("select title, link from tasks where tenant_id = $1 and title like $2 order by title", [T, `%Testspielwaren ${m}%`]);
    expect(aufgaben.map((a) => a.title)).toEqual([`Abmeldung: ${firma(3)} (Restposten) – auf Sperrliste`, `Antwort auf Restposten-Angebot: ${firma(2)}`]);
    expect(aufgaben[0].link).toBe("/b2b/abverkauf#anschreiben");

    await page.goto("/b2b/abverkauf");
    await expect(lead(2)).toHaveAttribute("data-status", "geantwortet");
    await expect(lead(3)).toHaveAttribute("data-status", "gesperrt");
    // Umsatz und Marge zur Antwort → Erfolg je Charge
    const z2 = page.locator(`[data-testid="av-anschreiben-zeile"][data-code="${codes[firma(2)]}"]`);
    await expect(z2).toHaveAttribute("data-status", "beantwortet");
    await z2.locator('input[name="umsatz"]').fill("220");
    await z2.locator('input[name="marge"]').fill("20,50");
    await Promise.all([aktion(page), z2.getByRole("button", { name: "✓" }).click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("Gespeichert");
    const c = page.getByTestId("av-charge").first();
    await expect(c).toContainText("2 / 100 %");
    await expect(c).toContainText("220,00 €");
    await expect(c).toContainText("20,50 €");
    await page.goto("/b2b/bilanz");
    await expect(page.getByTestId("bilanz-abverkauf")).toContainText("220,00 €");

    // Sperrliste: erneuter Import desselben Händlers wird blockiert
    await page.goto("/b2b/abverkauf");
    const imp2 = page.getByTestId("av-import");
    await imp2.locator('input[name="datei"]').setInputFiles({ name: `leads-${m}-2.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await imp2.locator('input[name="quelle"]').fill("Testverzeichnis (erfunden)");
    await Promise.all([aktion(page), page.getByTestId("av-import-los").click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("0 Leads neu, 9 schon vorhanden, 1 auf der Sperrliste");

    // „Rechtlich geprüft“ an (Inhaber): E-Mail mit dokumentierter Einwilligung geht raus – mit Datenschutzhinweis
    await page.getByTestId("av-rechtlich").check();
    await Promise.all([aktion(page), page.getByTestId("av-einstellungen").getByRole("button", { name: "Speichern" }).click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("Einstellungen gespeichert");
    await expect(lead(1).getByTestId("av-mail-status")).toContainText("E-Mail erlaubt: Einwilligung");
    for (const z of await page.locator('[data-testid="av-anschreiben-zeile"][data-status="entwurf"]').all()) if (!(await z.innerText()).includes(firma(1))) await z.locator('input[name="anschreiben"]').uncheck();
    await Promise.all([aktion(page), page.getByTestId("av-freigeben").click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("1 E-Mails verschickt");
    await expect(page.locator(`[data-testid="av-anschreiben-zeile"][data-code="${codes[firma(1)]}"]`)).toHaveAttribute("data-status", "versendet");
    const [gesendet] = await sql<{ subject: string }>(`select subject from test_mails where tenant_id = $1 and "to" = $2`, [T, mail(1)]);
    expect(gesendet.subject).toBe(`Restposten-Angebot für ${firma(1)} (${codes[firma(1)]})`);
    // Text liegt verschlüsselt in der Datenbank – lesbar unter Einstellungen → Testumgebung (abgefangene Mails)
    await page.goto("/einstellungen/testumgebung");
    const testmail = page.locator('[data-testid="testenv-mail"]', { hasText: codes[firma(1)] }).first();
    await testmail.locator("summary").click();
    const text = (await testmail.textContent()) ?? "";
    expect(text).toContain("Art. 14 DSGVO");
    expect(text).toContain("Abmelden");
    expect(text).not.toMatch(INTERN);
  });
});
