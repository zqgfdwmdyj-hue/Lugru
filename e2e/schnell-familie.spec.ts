// Modul 11 (Schnellerfassung per Sprache), Modul 9 (Geburtstage) und Modul 8 (Briefe von Schule/Kita).
// Erfundene Diktate, Personen und Briefe.
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

const tagPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

test.describe("Schnellerfassung, Geburtstage, Schulbriefe", () => {
  test("Diktat per Schlüssel: Aufgabe direkt, Unklares in die Eingangsliste, Privates nur mit Zugang, Widerruf", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const m = marke();
    const B = baseURL!;
    await anmelden(page, "inhaber");
    await page.goto("/schnell");
    const f = page.getByTestId("mobil-token-form");
    await f.locator("input[name=name]").fill(`Test-Handy ${m}`);
    await Promise.all([aktion(page), f.locator("button[type=submit]").click()]);
    const token = (await page.getByTestId("mobil-token-wert").textContent())!.trim();
    expect(token).toMatch(/^mk_/);

    const senden = (text: string, t = token) => fetch(`${B}/api/mobil/erfassen`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    // Fehler immer als JSON mit passendem Status und vorlesbarer „antwort“
    const falsch = await senden("Aufgabe: x", "mk_falsch_falsch_falsch_falsch");
    expect(falsch.status).toBe(401);
    expect(falsch.headers.get("content-type")).toContain("application/json");
    expect(await falsch.json()).toEqual({ ok: false, error: "Ungültiger Schlüssel.", antwort: "Ungültiger Schlüssel." });
    const ohne = await fetch(`${B}/api/mobil/erfassen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Aufgabe: x" }) });
    expect(ohne.status).toBe(401);
    expect((await ohne.json()).ok).toBe(false);
    const get = await fetch(`${B}/api/mobil/erfassen`, { headers: { Authorization: `Bearer ${token}` } });
    expect(get.status).toBe(405);
    expect(await get.json()).toMatchObject({ ok: false, antwort: expect.stringContaining("POST") });
    const kaputt = await fetch(`${B}/api/mobil/erfassen`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{text:" });
    expect(kaputt.status).toBe(400);
    expect((await kaputt.json()).error).toContain("Ungültiges JSON");
    const leer = await senden("");
    expect(leer.status).toBe(400);
    expect(await leer.json()).toMatchObject({ ok: false, antwort: "Bitte etwas diktieren." });

    // Geschäftliche Aufgabe mit Frist → sofort angelegt, kurze Antwort zum Vorlesen
    const a = await (await senden(`Aufgabe: morgen DHL Geschäftskunden anrufen ${m}`)).json();
    expect(a).toMatchObject({ ok: true, angelegt: true, art: "aufgabe" });
    expect(a.antwort).toMatch(/^Aufgabe angelegt für/);
    const [t] = await sql<{ due_date: string; category: string }>("select due_date::text, category from tasks where title like $1", [`%DHL Geschäftskunden anrufen ${m}%`]);
    expect(t).toMatchObject({ due_date: tagPlus(1), category: "eigene" });

    // Siri mit Weckwort: „Seller-System, erinnere mich morgen an …“ → direkt angelegt, Titel ohne Befehl/Zeit;
    // Link für das Handy über die Adresse, unter der die Anfrage ankam – nicht localhost
    const siri = await fetch(`${B}/api/mobil/erfassen`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Forwarded-Host": "seller.example.invalid", "X-Forwarded-Proto": "https" }, body: JSON.stringify({ text: `Seller-System, erinnere mich morgen an die Retouren ${m}` }) }).then((r) => r.json());
    expect(siri).toMatchObject({ ok: true, angelegt: true, art: "aufgabe", link: "https://seller.example.invalid/schnell" });
    expect(siri.antwort).toBe(`Aufgabe angelegt für ${tagPlus(1).slice(8, 10)}.${tagPlus(1).slice(5, 7)}.: Retouren ${m}`);
    expect((await sql<{ due_date: string }>("select due_date::text from tasks where title = $1", [`Retouren ${m}`]))[0]?.due_date).toBe(tagPlus(1));
    // Befehl ohne Inhalt → Rückfrage statt leerer Aufgabe
    const ohneInhalt = await (await senden("Erstelle morgen um 10 Uhr eine Aufgabe")).json();
    expect(ohneInhalt.angelegt).toBe(false);
    expect(ohneInhalt.antwort).toMatch(/^Was soll die Aufgabe sein\?/);

    // Privat-Aufgabe (Inhaber hat vollen Privat-Zugang) → angelegt, ohne Inhalt in der Antwort
    const p = await (await senden(`Zahnarzt für Kind A anrufen ${m}`)).json();
    expect(p).toMatchObject({ angelegt: true, art: "privat_aufgabe" });
    expect(p.antwort).not.toContain("Zahnarzt");

    // Unklares → Eingangsliste; dort als Aufgabe bestätigen
    const u = await (await senden(`Blaue Kisten ${m}`)).json();
    expect(u.angelegt).toBe(false);
    expect(u.antwort).toContain("Eingangsliste");
    await page.goto("/schnell");
    const eintrag = page.getByTestId("schnell-eintrag").filter({ hasText: `Blaue Kisten ${m}` });
    await expect(eintrag).toBeVisible();
    await eintrag.locator("select[name=art]").selectOption("aufgabe");
    await eintrag.locator("input[name=titel]").fill(`Blaue Kisten bestellen ${m}`);
    await eintrag.getByRole("button", { name: "Anlegen" }).click();
    await expect(page.getByTestId("schnell-meldung")).toContainText("Aufgabe angelegt");
    expect((await sql("select 1 from tasks where title = $1", [`Blaue Kisten bestellen ${m}`])).length).toBe(1);
    // Privat-Zeit nie direkt
    expect((await (await senden(`Paarzeit am Samstag ab 19 Uhr ${m}`)).json()).angelegt).toBe(false);

    // Protokoll je Aufruf; Diktate verschlüsselt (kein Klartext in der Datenbank)
    expect((await sql<{ n: number }>("select count(*)::int as n from mobil_protokoll p join api_tokens t on t.id = p.token_id where t.name = $1", [`Test-Handy ${m}`]))[0].n).toBe(8);
    expect((await sql("select 1 from schnell_eingaenge where daten::text like $1", [`%${m}%`])).length).toBe(0);

    // Widerrufen → 401
    await page.goto("/schnell");
    await page.getByTestId("mobil-token").filter({ hasText: `Test-Handy ${m}` }).getByRole("button", { name: "widerrufen" }).click();
    await expect(page.getByTestId("schnell-meldung")).toContainText("widerrufen");
    expect((await senden(`Aufgabe: noch was ${m}`)).status).toBe(401);
  });

  test("Geburtstag mit Erinnerung und Schulbrief → Vorschläge → Privatkalender mit Original", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    await anmelden(page, "inhaber");

    // Geburtstag in 10 Tagen → „bald“ und auf der Privat-Startseite
    const gb = tagPlus(10);
    await page.goto("/privat/geburtstage");
    const f = page.getByTestId("jt-form");
    await f.locator("#jt-name").fill(`Testoma ${m}`);
    await f.locator("#jt-datum").fill(`${gb.slice(8, 10)}.${gb.slice(5, 7)}.1950`);
    await f.locator("#jt-ideen").fill("Hörbuch\nBlumen");
    await f.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByTestId("jt-bald")).toContainText(`Testoma ${m}`);
    await expect(page.getByTestId("jt-bald")).toContainText("Idee: Hörbuch");
    await page.goto("/privat");
    await expect(page.getByTestId("today-jahrestage")).toContainText(`Testoma ${m}`);

    // Schulbrief (erfundenes Testbild mit sichtbarem Text hinter „TESTOCR“)
    const abend = tagPlus(19);
    const frist = tagPlus(7);
    const brief = Buffer.from(`\x89PNG\r\n\x1a\nTESTOCR\nElternabend Klasse 2b ${m} am ${dmy(abend)} um 19:30\nKind A: Unterschrift Wandertag ${m} bis ${dmy(frist)}, Brotzeit mitbringen\n`, "utf8");
    await page.goto("/privat/schulbriefe");
    await page.getByTestId("sb-upload").locator("input[type=file]").setInputFiles({ name: "brief.png", mimeType: "image/png", buffer: brief });
    await page.getByTestId("sb-upload").getByRole("button", { name: "Hochladen und lesen" }).click();
    await expect(page.getByTestId("sb-meldung")).toContainText("2 Vorschläge");
    await expect(page.getByTestId("sb-vorschlag")).toHaveCount(2);
    await page.getByTestId("sb-vorschlaege").getByRole("button", { name: "Ausgewählte übernehmen" }).click();
    await expect(page.getByTestId("sb-meldung")).toContainText("2 übernommen");

    // Termin im Privatkalender; Original abrufbar (nur mit Privat-Zugang)
    await page.goto(`/privat/kalender?ansicht=tag&tag=${abend}`);
    await expect(page.locator('[data-testid="pk-item"]', { hasText: `Elternabend Klasse 2b ${m}` })).toContainText("19:30");
    await page.goto("/privat/schulbriefe");
    const href = await page.getByRole("link", { name: "Original ansehen" }).first().getAttribute("href");
    const orig = await page.request.get(href!);
    expect(orig.status()).toBe(200);
    expect(orig.headers()["content-type"]).toBe("image/png");
    // Unverschlüsselt liegt nichts in der Datenbank
    expect((await sql("select 1 from private_entries where data::text like $1", [`%${m}%`])).length).toBe(0);
  });
});
