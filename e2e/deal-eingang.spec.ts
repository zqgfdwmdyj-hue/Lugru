// Deal-Eingang (B6) gegen die Testdienste – erfundene Angebote, Marken und ASINs. Abnahmen: Text → ASIN, Ampel,
// Menge, max. EK; „Screenshot“ mit 3 Angeboten (nur EAN, falsche Packung) + Push ≤ 60 s; Kapital-Ampel rot →
// „Bestand reicht … Tage“; Kurzbefehl mit Schlüssel, widerrufener Schlüssel abgelehnt; XLSX 500 Zeilen → Preisliste;
// Mail mit „Deal prüfen“; ProfitPath über Discord (Push nur Grün/Gelb, gleiche ASIN zusammengefasst, EK-Update);
// Knöpfe Bestellvorschlag/B2B-Deal; Claude-Werkzeuge.
import * as XLSX from "xlsx";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

type Push = { pfad: string; vapid: boolean };
const pushes = async (): Promise<Push[]> => (await fetch(`${TD}/__push`)).json();
const fertig = (id: string) => expect.poll(async () => (await sql<{ p: string }>("select pruefung p from deal_eingaenge where id = $1", [id]))[0]?.p, { timeout: 60_000 }).toMatch(/fertig|fehler/);
const zeilen = async (id: string) => (await sql<{ zeilen: { nr: number; asin: string | null; ampel: string; gruende: string[]; empfohlen: number | null; maxEk: { land: string; ek: number }[]; zuordnung: string }[] }>("select zeilen from deal_eingaenge where id = $1", [id]))[0].zeilen;

// Kleinstes gültiges PNG (1×1) + sichtbarer Text hinter „TESTOCR“ (der KI-Nachbau „liest“ ihn wie einen Screenshot).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const screenshot = (text: string) => Buffer.concat([PNG, Buffer.from(`TESTOCR\n${text}`, "latin1")]);

test.describe("Deal-Eingang", () => {
  test("Text, Screenshot, Kurzbefehl, Kapital rot, Preisliste, Mail, Push, Knöpfe, Claude", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    // Push-Abo des Inhabers (Push-Dienst = Testdienste) und eine Ware mit roter Kapital-Ampel (400 Tage Reichweite).
    await sql("insert into push_abos (tenant_id, user_id, endpoint) values ($1, $2, $3)", [T, INH, `${TD}/push/de-${m}`]);
    await sql("insert into sellerboard_products (tenant_id, sb_id, sku, asin, name, cost, price, fba_fee, referral_fee, vat_pct, synced_at) values ($1, $2, $3, 'B0TESTKAP9', 'Testmarke Lagertopf (erfunden)', 5, 19.99, -3, -3, 19, now())", [T, `DE-KAP-${m}`, `TEST-DE-KAP-${m}`]);
    await sql("insert into sellerboard_inventory (tenant_id, sb_id, sku, asin, name, fba_stock, sales_velocity, synced_at) values ($1, $2, $3, 'B0TESTKAP9', 'Testmarke Lagertopf (erfunden)', 200, 0.5, now())", [T, `DE-KAP-INV-${m}`, `TEST-DE-KAP-${m}`]);
    await sql("insert into sellerboard_sku_months (tenant_id, month, sku, asin, name, units, sales, net_profit, synced_at) values ($1, to_char(now(), 'YYYY-MM'), $2, 'B0TESTKAP9', 'Testmarke Lagertopf (erfunden)', 15, 299.85, 30, now())", [T, `TEST-DE-KAP-${m}`]);

    await anmelden(page, "inhaber");

    // 1) Reiner Text → ASIN über die Titelsuche (6er-Pack passend), Ampel, empfohlene Menge, max. EK
    await page.goto("/deal-eingang");
    await page.locator('[data-testid="de-form"] textarea[name="text"]').fill(`Testmarke Pearl Styler 6x 150ml 19,50 netto ab 50 Stk (${m})`);
    await Promise.all([page.waitForURL(/\/deal-eingang\/[0-9a-f-]{36}/), page.getByTestId("de-pruefen").click()]);
    const textId = /\/deal-eingang\/([0-9a-f-]{36})/.exec(page.url())![1];
    await fertig(textId);
    const [z1] = await zeilen(textId);
    expect(z1.asin).toBe("B0TESTW006");
    expect(["gruen", "gelb", "rot"]).toContain(z1.ampel);
    expect(z1.maxEk.length).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByTestId("de-zeile")).toHaveAttribute("data-asin", "B0TESTW006");
    await expect(page.getByTestId("de-maxek")).toContainText("Max. EK für Ziel-ROI");
    await expect(page.getByTestId("de-antwort")).toContainText("Hallo");

    // Knöpfe: in Bestellvorschläge (Einkaufsentwurf) und als B2B-Deal (Entwurf)
    await Promise.all([aktion(page), page.getByTestId("de-bestellvorschlag").click()]);
    await expect(page.getByRole("status")).toContainText("als Einkaufsentwurf angelegt");
    expect((await sql<{ c: string }>("select count(*) c from purchase_order_items where tenant_id = $1 and asin = 'B0TESTW006'", [T]))[0].c).not.toBe("0");
    await Promise.all([aktion(page), page.getByTestId("de-b2b").click()]);
    await expect(page.getByRole("status")).toContainText("B2B-Deal Nr.");
    expect((await sql<{ c: string }>("select count(*) c from deals where tenant_id = $1 and asin = 'B0TESTW006'", [T]))[0].c).not.toBe("0");

    // 2) „Screenshot“ mit 3 Angeboten (eins nur EAN, eins mit falscher Packungsgröße) über das Teilen-Ziel → Push
    const vorher = (await pushes()).filter((p) => p.pfad === `/push/de-${m}`).length;
    const t0 = Date.now();
    const bild = screenshot([`Konrad: B0TESTDE01 Testsocken 2,10 netto ab 20 Stk ${m}`, "Konrad: 4000000000017 Testware Dose 3,50 netto", "Konrad: Testmarke Shampoo 4x 300ml 12,90 netto"].join("\n"));
    const r2 = await page.request.post("/api/deal-eingang", { multipart: { text: "", datei: { name: `whatsapp-${m}.png`, mimeType: "image/png", buffer: bild } }, maxRedirects: 0 });
    expect(r2.status()).toBe(303);
    const shotId = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r2.headers().location ?? "")![1];
    await fertig(shotId);
    const z2 = await zeilen(shotId);
    expect(z2).toHaveLength(3);
    expect(z2.some((z) => z.asin?.startsWith("B0EAN") && z.zuordnung === "ean")).toBe(true);
    expect(z2.some((z) => z.gruende.join(" ").includes("Packungsgröße prüfen") || z.ampel === "gelb")).toBe(true);
    await expect.poll(async () => (await pushes()).filter((p) => p.pfad === `/push/de-${m}`).length, { timeout: 60_000 }).toBeGreaterThan(vorher);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect((await pushes()).filter((p) => p.pfad === `/push/de-${m}`).every((p) => p.vapid)).toBe(true);
    const neueste = await (await page.request.get("/api/push/neueste")).json();
    expect(neueste.titel).toMatch(/^Deal /);
    expect(neueste.link).toBe(`/deal-eingang/${shotId}`);

    // 3) iPhone-Kurzbefehl mit Geräte-Schlüssel; ASIN mit roter Kapital-Ampel → Rot mit „Bestand reicht … Tage“
    await page.goto("/deal-eingang/kurzbefehl");
    await page.locator('[data-testid="de-token-form"] input[name="name"]').fill(`Test-iPhone ${m}`);
    await page.locator('[data-testid="de-token-form"] button').click();
    const token = (await page.getByTestId("de-token-wert").textContent())!.trim();
    expect(token).toMatch(/^dk_/);
    const r3 = await fetch(`${baseURL}/api/deal-eingang`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: `B0TESTKAP9 Testmarke Lagertopf 4,00 netto ab 10 Stk (${m})`, quelle: "Konrad" }) });
    expect(r3.status).toBeLessThan(300);
    const kurzId = ((await r3.json()) as { id: string }).id;
    await fertig(kurzId);
    const [z3] = await zeilen(kurzId);
    expect(z3.ampel).toBe("rot");
    expect(z3.gruende.join(" ")).toMatch(/Bestand reicht \d+ Tage/);
    // Schlüssel widerrufen → abgelehnt
    await page.reload();
    await Promise.all([aktion(page), page.locator('[data-testid="de-token"]').filter({ hasText: `Test-iPhone ${m}` }).getByRole("button", { name: "widerrufen" }).click()]);
    const r4 = await fetch(`${baseURL}/api/deal-eingang`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: "B0TESTDE01 2,00 netto" }) });
    expect([401, 403]).toContain(r4.status);

    // 4) XLSX mit 500 Zeilen → Preisliste (Scanner), Push mit Zusammenfassung
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["EAN", "Artikel", "Preis netto", "VPE"], ...Array.from({ length: 500 }, (_, i) => [String(4000000100000 + i), `Testartikel ${i} (erfunden ${m})`, (2 + (i % 50) / 10).toFixed(2), 6])]), "Liste");
    const xlsx = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const vorXl = (await pushes()).filter((p) => p.pfad === `/push/de-${m}`).length;
    const r5 = await page.request.post("/api/deal-eingang", { multipart: { text: "Preisliste Testgroßhandel", quelle: `Testgroßhandel ${m}`, datei: { name: `preisliste-${m}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlsx } }, maxRedirects: 0 });
    const xlId = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r5.headers().location ?? "")![1];
    await fertig(xlId);
    const [xl] = await sql<{ status: string; preisliste_id: string | null; zusammenfassung: string }>("select status, preisliste_id, zusammenfassung from deal_eingaenge where id = $1", [xlId]);
    expect(xl.status).toBe("preisliste");
    expect(xl.preisliste_id).not.toBeNull();
    await expect.poll(async () => (await pushes()).filter((p) => p.pfad === `/push/de-${m}`).length, { timeout: 30_000 }).toBeGreaterThan(vorXl);

    // 5) Mail mit „Deal prüfen“ im Betreff (Weiterleitung) → Deal-Eingang statt Posteingang
    const eml = [`From: Konrad Test <konrad@example.invalid>`, `To: ich@example.invalid`, `Subject: Deal prüfen: Testangebot ${m}`, `Message-ID: <deal-${m}@example.invalid>`, `Date: ${new Date().toUTCString()}`, `Content-Type: text/plain; charset=utf-8`, "", `B0TESTDE02 Testtasse 3,10 netto ab 10 Stk ${m}`].join("\r\n");
    await page.goto("/posteingang");
    const emlForm = page.getByTestId("eml-upload").first();
    await emlForm.locator("input[type=file]").setInputFiles({ name: `deal-${m}.eml`, mimeType: "message/rfc822", buffer: Buffer.from(eml) });
    await emlForm.getByRole("button", { name: "Hochladen", exact: true }).click();
    await expect(emlForm).toContainText(/neu/);
    await expect.poll(async () => (await sql<{ c: string }>("select count(*) c from deal_eingaenge where tenant_id = $1 and weg = 'mail' and quelle_ref = $2", [T, `mail:<deal-${m}@example.invalid>`]))[0]?.c, { timeout: 30_000 }).toBe("1");
    expect((await sql<{ c: string }>("select count(*) c from emails where tenant_id = $1 and subject like $2", [T, `%Testangebot ${m}%`]))[0].c).toBe("0");

    // 6) ProfitPath über Discord: Meldung → Gegenprüfung; gleiche ASIN/EK zusammengefasst; neuer EK = Update
    const pp = (ek: string) => fetch(`${TD}/__discord-va/profitpath`, { method: "POST", body: JSON.stringify({ kanal: "810000000000000001", name: "dealwatch-drogerie", titel: `Testmarke Haarspray ${m} (erfunden)`, asin: "B0TESTPP01", ek }) });
    await pp("€8,99");
    await page.goto("/deal-eingang");
    await Promise.all([aktion(page), page.getByTestId("de-profitpath").click()]);
    await expect(page.getByRole("status")).toContainText("ProfitPath: 1 neu");
    const [ppE] = await sql<{ id: string; quelle: string; ampel: string | null; push_am: Date | null }>("select id, quelle, ampel, push_am from deal_eingaenge where tenant_id = $1 and weg = 'profitpath' order by created_at desc limit 1", [T]);
    expect(ppE.quelle).toBe("ProfitPath · Dealwatch");
    // Push nur bei Grün/Gelb – Rot steht nur in der Liste
    if (ppE.ampel === "rot") expect(ppE.push_am).toBeNull();
    else expect(ppE.push_am).not.toBeNull();
    await pp("€8,99");
    await Promise.all([aktion(page), page.getByTestId("de-profitpath").click()]);
    await expect(page.getByRole("status")).toContainText("1 übersprungen");
    await pp("€7,49");
    await Promise.all([aktion(page), page.getByTestId("de-profitpath").click()]);
    await expect(page.getByRole("status")).toContainText("1 Updates");
    expect((await sql<{ c: string }>("select count(*) c from deal_eingaenge where tenant_id = $1 and weg = 'profitpath'", [T]))[0].c).toBe("1");
    await expect(page.getByTestId("de-quellen")).toContainText("ProfitPath · Dealwatch");

    // 7) Claude: deal_eingang (seit heute), Einzelheiten, Quellen, Deal prüfen aus dem Chat
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    expect(await mcp.tools()).toEqual(expect.arrayContaining(["deal_eingang", "deal_eingang_detail", "deal_quellen", "deal_eingang_pruefen", "deal_eingang_status"]));
    const liste = JSON.parse(await mcp.call("deal_eingang", { seit: new Date().toISOString().slice(0, 10) }));
    expect(liste.eingaenge.some((e: { id: string }) => e.id === kurzId)).toBe(true);
    const detail = JSON.parse(await mcp.call("deal_eingang_detail", { id: kurzId }));
    expect(detail.angebote[0].ampel).toBe("rot");
    const quellen = JSON.parse(await mcp.call("deal_quellen"));
    expect(quellen.quellen.some((q: { quelle: string }) => q.quelle === "Konrad")).toBe(true);
    const chat = JSON.parse(await mcp.call("deal_eingang_pruefen", { asin: "B0TESTDE03", ek: 2.1, menge: 20, quelle: `Chat ${m}` }));
    expect(chat.pruefung).toBe("fertig");
    expect(chat.angebote[0].asin).toBe("B0TESTDE03");
  });
});
