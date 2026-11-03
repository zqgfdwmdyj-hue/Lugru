// DHL-Label aus Chat/Screenshot (Bauauftrag Push-Handy/DHL-Label, Teil B; Abnahmen 1–3) gegen die Testdienste:
// KI-Nachbau liest Adressen (Testbilder tragen den Text hinter „TESTOCR“), DHL-Nachbau erstellt Labels bzw. lehnt
// PLZ „00000“ ab. Alle Adressen sind erfunden.
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { anmelden, expect, marke, sql, test } from "./helfer";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const testbild = (text: string) => Buffer.concat([PNG, Buffer.from(`TESTOCR\n${text}`, "utf8")]);

async function sendung(page: Page, o: { gewicht: string; artikel: string; preis?: string }) {
  await page.getByTestId("label-gewicht").fill(o.gewicht);
  await page.getByTestId("label-artikel").fill(o.artikel);
  if (o.preis) await page.getByTestId("label-preis").fill(o.preis);
  await page.getByTestId("label-zahlungsart").fill("PayPal");
}

test.describe("Label aus Chat", () => {
  test("Abnahme 1+2: Screenshot bzw. Kleinanzeigen-Text → Formular gefüllt (unsicher gelb) → Label-PDF < 30 s → Auftrag, Tracking-Text", async ({ page }) => {
    test.setTimeout(180_000);
    const m = marke();
    await anmelden(page, "inhaber");
    await page.goto("/versand/label");
    await page.waitForLoadState("networkidle");

    // Abnahme 1: WhatsApp-Screenshot hochladen
    await page.getByTestId("label-bild").setInputFiles({ name: "whatsapp.png", mimeType: "image/png", buffer: testbild(`Max Muster${m}\nTeststraße 12a?\n12345 Musterstadt\nTel 0151 23456789`) });
    await expect(page.getByTestId("label-bild-name")).toContainText("whatsapp.png");
    const t0 = Date.now();
    await page.getByTestId("label-erkennen").click();
    await expect(page.getByTestId("ad-name")).toHaveValue(`Max Muster${m}`);
    await expect(page.getByTestId("ad-strasse")).toHaveValue("Teststraße");
    await expect(page.getByTestId("ad-hausnummer")).toHaveValue("12a");
    await expect(page.getByTestId("ad-hausnummer")).toHaveAttribute("data-unsicher", "1"); // gelb
    await expect(page.getByTestId("ad-plz")).toHaveValue("12345");
    await expect(page.getByTestId("ad-telefon")).toHaveValue("015123456789");
    await expect(page.getByTestId("label-erkannt")).toContainText("1 Feld gelb");
    // Gelbes Feld bestätigen: antippen und verlassen nimmt die Markierung weg
    await page.getByTestId("ad-hausnummer").click();
    await page.getByTestId("ad-hausnummer").press("Tab");
    await expect(page.getByTestId("ad-hausnummer")).toHaveAttribute("data-unsicher", "0");
    await page.getByTestId("label-pruefen").click();
    await expect(page.getByTestId("label-pruefung")).toContainText("DHL: Adresse in Ordnung");
    await sendung(page, { gewicht: "1,4", artikel: `Testkopfhörer ${m}`, preis: "25" });
    await expect(page.getByTestId("label-produkt")).toHaveValue("paket_2");
    await page.getByTestId("label-erstellen").click();
    await expect(page.getByTestId("label-ergebnis")).toBeVisible({ timeout: 30_000 });
    expect(Date.now() - t0).toBeLessThan(30_000);
    const pdf = await page.request.get((await page.getByTestId("label-pdf").getAttribute("href"))!);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    await expect(page.getByTestId("label-textbaustein")).toHaveValue(new RegExp(`Hallo Max,\\ndein Paket ist unterwegs: https://.+piececode=\\d+`));
    await page.getByTestId("label-link-kopieren").click();
    const [o1] = await sql<{ channel: string; tracking_number: string; status: string; total: string; notes: string; id: string }>("select o.id, o.channel, o.tracking_number, o.status, o.total, o.notes from orders o join versand_labels v on v.order_id = o.id where v.artikel = $1", [`Testkopfhörer ${m}`]);
    expect(o1).toMatchObject({ channel: "kleinanzeigen", status: "label_created" });
    expect(Number(o1.total)).toBe(25);
    expect(o1.notes).toContain("PayPal");
    expect(o1.tracking_number).toMatch(/^\d+$/);
    await page.getByTestId("label-auftrag").click();
    await expect(page).toHaveURL(new RegExp(`/auftraege/${o1.id}`));

    // Abnahme 2: Kleinanzeigen-Nachricht als Text
    await page.goto("/versand/label");
    await page.getByTestId("label-text").fill(`Hallo, hier meine Daten:\nName: Erika Beispiel${m}\nStraße: Probeweg 7\nPLZ/Ort: 54321 Beispielstadt\nE-Mail: erika@example.invalid\nDanke!`);
    await page.getByTestId("label-erkennen").click();
    await expect(page.getByTestId("ad-name")).toHaveValue(`Erika Beispiel${m}`);
    await expect(page.getByTestId("ad-ort")).toHaveValue("Beispielstadt");
    await expect(page.getByTestId("ad-email")).toHaveValue("erika@example.invalid");
    await sendung(page, { gewicht: "3", artikel: `Testlampe ${m}`, preis: "40" });
    await expect(page.getByTestId("label-produkt")).toHaveValue("paket_5");
    const t1 = Date.now();
    await page.getByTestId("label-erstellen").click();
    await expect(page.getByTestId("label-ergebnis")).toBeVisible({ timeout: 30_000 });
    expect(Date.now() - t1).toBeLessThan(30_000);
    expect((await sql("select 1 from orders o join versand_labels v on v.order_id = o.id where v.artikel = $1 and o.channel = 'kleinanzeigen'", [`Testlampe ${m}`])).length).toBe(1);
    // Protokoll (Inhaber): wer, an wen
    await page.goto("/versand/label");
    await expect(page.getByTestId("label-protokoll-zeile").filter({ hasText: `Erika Beispiel${m}` })).toContainText("Ina Inhaber");
  });

  test("Abnahme 3: Gefahrgut LQ → Label + LQ-Kennzeichen; Klasse 1/7 gesperrt („per Spedition“); Lithium-Kennzeichen", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    await anmelden(page, "inhaber");
    await page.goto("/versand/label");
    await page.getByTestId("label-text").fill(`Gerd Gefahr${m}\nTeststraße 3\n12345 Musterstadt`);
    await page.getByTestId("label-erkennen").click();
    await expect(page.getByTestId("ad-name")).toHaveValue(`Gerd Gefahr${m}`);
    await sendung(page, { gewicht: "4", artikel: `Testspray LQ ${m}`, preis: "12" });
    await page.getByTestId("gg-lq").check();
    // Ohne Pflichtangaben: Hinweis, Erstellen liefert Fehler
    await expect(page.getByTestId("gg-ergebnis")).toContainText("UN-Nummer fehlt");
    await page.getByTestId("gg-un").fill("UN1950");
    await page.getByTestId("gg-menge").fill("6 x 0,4 L");
    // Unzulässige Klasse: gesperrt
    for (const k of ["1.4S", "7", "6.2"]) {
      await page.getByTestId("gg-klasse").fill(k);
      await expect(page.getByTestId("gg-ergebnis")).toHaveAttribute("data-gesperrt", "1");
      await expect(page.getByTestId("gg-ergebnis")).toContainText("per Spedition");
      await expect(page.getByTestId("label-erstellen")).toBeDisabled();
    }
    await page.getByTestId("gg-klasse").fill("2.1");
    await expect(page.getByTestId("gg-ergebnis")).toHaveAttribute("data-gesperrt", "0");
    await expect(page.getByTestId("gg-ergebnis")).toContainText("nur begrenzte Mengen (LQ)");
    await page.getByTestId("gg-lithium").selectOption("UN3481");
    await page.getByTestId("label-erstellen").click();
    await expect(page.getByTestId("label-ergebnis")).toBeVisible({ timeout: 30_000 });
    const lq = page.getByTestId("label-kennzeichen-lq");
    await expect(lq).toBeVisible();
    await expect(page.getByTestId("label-kennzeichen-lithium")).toBeVisible();
    await page.goto((await lq.getAttribute("href"))!);
    await expect(page.getByTestId("gk-lq")).toBeVisible();
    await expect(page.getByTestId("gk-leiste")).toContainText("100 × 100 mm");
    await page.goto("/etikett/gefahrgut?art=lithium&un=UN3481");
    await expect(page.getByTestId("gk-lithium")).toContainText("UN3481");
    const [v] = await sql<{ gefahrgut: { lq: boolean; un: string; klasse: string } }>("select gefahrgut from versand_labels where artikel = $1", [`Testspray LQ ${m}`]);
    expect(v.gefahrgut).toMatchObject({ lq: true, un: "UN1950", klasse: "2.1" });
    // Vollgefahrgut gesperrt
    await page.goto("/versand/label");
    await page.getByTestId("gg-voll").check();
    await expect(page.getByTestId("gg-ergebnis")).toContainText("Vollgefahrgut");
    await expect(page.getByTestId("label-erstellen")).toBeDisabled();
  });

  test("Fehlerfälle: DHL lehnt ab (Klartext, Formular bleibt), Prüfung mit Vorschlag, ohne Verbindung → Vorlage, wieder öffnen", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    await anmelden(page, "inhaber");
    await page.goto("/versand/label");
    await page.getByTestId("label-text").fill(`Fritz Fehler${m}\nTeststraße 9\n12345 Musterdorf`);
    await page.getByTestId("label-erkennen").click();
    await expect(page.getByTestId("ad-ort")).toHaveValue("Musterdorf");
    await page.getByTestId("label-pruefen").click();
    await expect(page.getByTestId("label-pruefung")).toContainText("Vorschlag: Musterstadt");
    await page.getByTestId("ad-plz").fill("00000");
    await sendung(page, { gewicht: "1", artikel: `Testfehler ${m}` });
    await page.getByTestId("label-erstellen").click();
    await expect(page.getByTestId("label-fehler")).toContainText("Die Postleitzahl ist ungültig");
    await expect(page.getByTestId("ad-name")).toHaveValue(`Fritz Fehler${m}`); // Formular bleibt gefüllt
    await expect(page.getByTestId("label-artikel")).toHaveValue(`Testfehler ${m}`);
    // Päckchen ohne Abrechnungsnummer (Testdaten) = keine DHL-Verbindung → Vorlage
    await page.getByTestId("ad-plz").fill("12345");
    await page.getByTestId("ad-ort").fill("Musterstadt");
    await page.getByTestId("label-gewicht").fill("0,5");
    await page.getByTestId("label-produkt").selectOption("paeckchen");
    await page.getByTestId("label-erstellen").click();
    await expect(page.getByTestId("label-fehler")).toHaveAttribute("data-vorlage", "1");
    await expect(page.getByTestId("label-fehler")).toContainText("als Vorlage gespeichert");
    await page.goto("/versand/label");
    const [v] = await sql<{ id: string; status: string }>("select id, status from versand_labels where artikel = $1", [`Testfehler ${m}`]);
    expect(v.status).toBe("vorlage");
    await page.goto(`/versand/label?vorlage=${v.id}`);
    await expect(page.getByTestId("label-vorlage-geladen")).toContainText("Vorlage");
    await expect(page.getByTestId("ad-name")).toHaveValue(`Fritz Fehler${m}`);
    await expect(page.getByTestId("label-produkt")).toHaveValue("paeckchen");
  });

  test("Rechte + Protokoll + Preisliste + iPhone: VA (Bereich Service) erstellt Labels ohne B2B, sieht nur eigene; Inhaber sieht wer/Kosten; Teilen-Endpunkt legt Entwurf an", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: LAGER, areas }] = await sql<{ id: string; areas: string[] }>("select u.id, ms.areas from users u join memberships ms on ms.user_id = u.id where u.email = 'lager'");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    try {
      // Preis hinterlegen (Inhaber)
      await anmelden(page, "inhaber");
      await page.goto("/versand/label");
      await page.getByTestId("preis-paket_2").fill("4,50");
      await page.getByTestId("label-einstellungen-speichern").click();
      await expect(page.getByTestId("label-meldung")).toContainText("Gespeichert");
      // „lager“ wie die VA: Bereiche Start, Amazon, Service
      await sql("update memberships set areas = '[\"start\",\"amazon\",\"service\"]'::jsonb where user_id = $1", [LAGER]);
      const ctx = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" });
      const va = await ctx.newPage();
      await anmelden(va, "lager");
      await va.goto("/versand/label");
      await expect(va.getByTestId("label-kanal").locator("option[value=b2b]")).toHaveCount(0);
      await expect(va.getByTestId("label-einstellungen")).toHaveCount(0);
      await va.getByTestId("label-text").fill(`Vera Versand${m}\nTeststraße 5\n12345 Musterstadt`);
      await va.getByTestId("label-erkennen").click();
      await expect(va.getByTestId("ad-name")).toHaveValue(`Vera Versand${m}`);
      await sendung(va, { gewicht: "1", artikel: `VA-Test ${m}`, preis: "9" });
      await va.getByTestId("label-erstellen").click();
      await expect(va.getByTestId("label-ergebnis")).toBeVisible({ timeout: 30_000 });
      await va.goto("/versand/label");
      await expect(va.getByTestId("label-protokoll")).toContainText("Meine Labels");
      await expect(va.getByTestId("label-kosten")).toHaveCount(0);
      await ctx.close();
      // Inhaber: Protokoll mit wer + Kosten laut Preisliste
      await page.goto("/versand/label");
      const z = page.getByTestId("label-protokoll-zeile").filter({ hasText: `Vera Versand${m}` });
      await expect(z).toContainText("Lars Lager");
      await expect(z.getByTestId("label-kosten")).toHaveText("4,50 €");
      // iPhone-Teilen-Menü: Bild an /api/mobil/label → Entwurf → Seite vorausgefüllt
      const token = `mk_lb${m}${"x".repeat(24)}`;
      await sql("insert into api_tokens (tenant_id, user_id, name, zweck, token_hash, anfang) values ($1, $2, $3, 'mobil', $4, $5)", [T, INH, `Label ${m}`, createHash("sha256").update(token).digest("hex"), token.slice(0, 7)]);
      const r = await page.request.post("/api/mobil/label", { headers: { Authorization: `Bearer ${token}` }, multipart: { bild: { name: "chat.png", mimeType: "image/png", buffer: testbild(`Ida Iphone${m}\nTeststraße 1\n12345 Musterstadt`) } } });
      expect(r.status()).toBe(200);
      const j = (await r.json()) as { url: string; antwort: string };
      expect(j.antwort).toContain(`Ida Iphone${m}`);
      await page.goto(j.url);
      await expect(page.getByTestId("label-vorlage-geladen")).toContainText("vom Handy");
      await expect(page.getByTestId("ad-name")).toHaveValue(`Ida Iphone${m}`);
      expect((await page.request.post("/api/mobil/label", { headers: { Authorization: "Bearer mk_falsch_00000000000000000000" }, data: { text: "x" } })).status()).toBe(401);
    } finally {
      await sql("update memberships set areas = $2::jsonb where user_id = $1", [LAGER, JSON.stringify(areas)]);
      await sql("update tenants set settings = settings - 'versandLabel' where id = $1", [T]);
    }
  });
});
