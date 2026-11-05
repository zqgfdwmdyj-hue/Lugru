// Nachtrag B28 (Deal-Eingang: Marge, Preis-Szenario, Gründe bei 👍, Bestellmail) gegen die Testdienste – erfundene
// Testpfanne (B0PFANNE01/02: Buy Box 79 €, vor 31–120 Tagen 57,99 €, in IT nur 1 Angebot), erfundener Lieferant mit
// example.com-Adresse. Abnahmen 1–5 aus dem Nachtrag.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

type Zeile = { nr: number; asin: string | null; ampel: string; wert?: { wert: number; dafuer: string[] } | null; merkmale?: { angeboteMinLand?: number | null } | null };
const fertig = (id: string) => expect.poll(async () => (await sql<{ p: string }>("select pruefung p from deal_eingaenge where id = $1", [id]))[0]?.p, { timeout: 60_000 }).toMatch(/fertig|fehler/);
const zeilen = async (id: string) => (await sql<{ zeilen: Zeile[] }>("select zeilen from deal_eingaenge where id = $1", [id]))[0].zeilen;
const GRUND_LAND = "In einem Land (FR/IT/ES …) kein oder nur 1 Angebot";

test.describe("B28 Deal-Eingang: Marge, Preis-Szenario, Gründe bei 👍, Bestellmail", () => {
  test("Abnahmen 1–5", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    // Frühere Läufe dieses Tests: 👍-Gründe zurücksetzen, damit der Anstieg des Deal-Werts messbar bleibt.
    await sql("update deal_eingaenge set daumen = null, daumen_grund = null, daumen_gruende = '[]'::jsonb, daumen_freitext = null where tenant_id = $1 and zeilen::text like '%B0PFANNE%'", [T]);
    await anmelden(page, "inhaber");

    // Deal-Quelle (Einstellungen → Deal-Quellen): erfundener Lieferant, Quelle = Ansprechpartner
    const lieferant = `Testgroßhandel ${m}`;
    const mail = `bestellung-${m}@example.com`;
    const kontakt = `Testkontakt ${m}`;
    await page.goto("/deal-eingang/quellen");
    await page.getByTestId("dq-name").fill(lieferant);
    await page.getByTestId("dq-email").fill(mail);
    await page.getByTestId("dq-ansprechpartner").fill(kontakt);
    await page.getByTestId("dq-zahlungsweg").fill("Überweisung Vorkasse");
    await page.getByTestId("dq-quellen").fill(`Test-WhatsApp ${m}`);
    await Promise.all([aktion(page), page.getByTestId("dq-speichern").click()]);
    await expect(page.getByTestId("dq-meldung")).toContainText("gespeichert");
    await expect(page.locator(`[data-testid="dq-eintrag"][data-name="${lieferant}"]`)).toBeVisible();

    // 1) Deal wie im Anlass: je Land Gewinn, Marge, ROI; max. EK für Ziel-ROI und Ziel-Marge
    const r = await page.request.post("/api/deal-eingang", { multipart: { text: `B0PFANNE01 Testpfanne 24 cm (erfunden) 25,00 netto ab 84 Stk ${m}`, quelle: kontakt }, maxRedirects: 0 });
    expect(r.status()).toBe(303);
    const idA = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r.headers().location ?? "")![1];
    await fertig(idA);
    await page.goto(`/deal-eingang/${idA}`);
    const de = page.locator('[data-testid="de-land"][data-land="DE"]').first();
    await expect(de.getByTestId("de-gewinn")).toContainText("€");
    await expect(de.getByTestId("de-marge")).toContainText(/\d+(,\d)? %/);
    await expect(de.getByTestId("de-roi")).toContainText(/\d+(,\d)? %/);
    await expect(page.getByTestId("de-maxek-roi").first()).toContainText("Max. EK für Ziel-ROI");
    await expect(page.getByTestId("de-maxek-marge").first()).toContainText("Max. EK für Ziel-Marge (10 %)");
    // 4) Verk./Monat gefüllt: Keepa „gekauft“ bzw. Schätzung aus dem Verkaufsrang (IT: Keepa liefert dort nichts)
    const verk = await page.getByTestId("de-verkaeufe").allTextContents();
    expect(verk.length).toBeGreaterThan(1);
    expect(verk.every((t) => t.trim() !== "–" && t.trim() !== "")).toBe(true);
    await expect(page.locator('[data-testid="de-land"][data-land="IT"]').first().getByTestId("de-verkaeufe")).toContainText("geschätzt");
    // B28.4: Verkaufsfreigabe-Hinweis bleibt, dazu der Seller-Central-Knopf
    await expect(page.getByTestId("de-freischaltung").first()).toHaveAttribute("href", /sellercentral\.amazon\.[a-z.]+\/abis\/listing\/syh\?asin=B0PFANNE01/);

    // 2) Ziel-VK DE 56 € → Gewinn/Marge/ROI neu, Hinweis auf Verkäufe bei diesem Preisniveau (Juli–September-Phase)
    const sz = page.getByTestId("de-szenario").first();
    await sz.locator("summary").click();
    const vkDe = sz.getByTestId("de-szenario-vk-DE");
    await expect(vkDe).toHaveValue("79,00");
    const gewinn79 = (await sz.getByTestId("de-szenario-gewinn-DE").textContent()) ?? "";
    await vkDe.fill("56");
    await expect(sz.getByTestId("de-szenario-gewinn-DE")).not.toHaveText(gewinn79);
    await expect(sz.getByTestId("de-szenario-marge-DE")).toContainText("%");
    await expect(sz.getByTestId("de-szenario-roi-DE")).toContainText("%");
    await expect(sz.getByTestId("de-szenario-verkaeufe-DE")).toContainText(/Bei diesem Preis zuletzt \d\d\.\d\d\.–\d\d\.\d\d\. \(\d+ Tage\): ca\. \d+ Verkäufe\/Monat \(Keepa „gekauft“\)/);
    await vkDe.fill("30");
    await expect(sz.getByTestId("de-szenario-verkaeufe-DE")).toContainText("nicht vor");

    // 3) 👍 mit Grund „In einem Land kein Angebot“ → Lernbericht; Deal-Wert eines ähnlichen Deals steigt
    const r2 = await page.request.post("/api/deal-eingang", { multipart: { text: `B0PFANNE02 Testpfanne 28 cm (erfunden) 27,00 netto ab 40 Stk ${m}`, quelle: `Anderer Händler ${m}` }, maxRedirects: 0 });
    const idB = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r2.headers().location ?? "")![1];
    await fertig(idB);
    const [zB1] = await zeilen(idB);
    expect(zB1.merkmale?.angeboteMinLand).toBe(1);
    const wertVorher = zB1.wert!.wert;
    await page.goto(`/deal-eingang/${idA}#bewerten`);
    const bew = page.getByTestId("de-bewerten");
    await bew.getByTestId("de-daumen-hoch").check();
    await bew.getByTestId("de-grund-hoch-2").check();
    await Promise.all([aktion(page), page.getByTestId("de-bewerten-knopf").click()]);
    await expect(page.getByRole("status")).toContainText("👍 gespeichert – mit Grund");
    await expect(page.getByTestId("de-daumen")).toContainText(GRUND_LAND);
    await page.goto(`/deal-eingang/${idB}`);
    await Promise.all([aktion(page), page.getByRole("button", { name: "Neu prüfen" }).click()]);
    await fertig(idB);
    await expect.poll(async () => (await zeilen(idB))[0].wert?.wert ?? 0, { timeout: 30_000 }).toBeGreaterThan(wertVorher);
    const dafuer = (await zeilen(idB))[0].wert!.dafuer.join(" ");
    expect(dafuer).toContain("👍-Grund „In einem Land");
    expect(dafuer).toContain("trifft zu (IT: 1 Angebot)");
    const monat = new Date().toISOString().slice(0, 7);
    await page.goto(`/deal-eingang/lernen?monat=${monat}`);
    await expect(page.getByTestId("dl-gruende-hoch")).toContainText(`${GRUND_LAND}:`);

    // 3b) Discord: nach 👍 fragt der Bot im Thread nach dem Grund (Zahl-Reaktionen), Antwort optional
    const pp = await (await fetch(`${TD}/__discord-va/profitpath`, { method: "POST", body: JSON.stringify({ kanal: "810000000000000001", name: "dealwatch-haushalt", titel: `Testpfanne 20 cm ${m} (erfunden)`, asin: "B0PFANNE03", ek: "€19,99" }) })).json();
    await page.goto("/deal-eingang");
    await Promise.all([aktion(page), page.getByTestId("de-profitpath").click()]);
    const [ppE] = await sql<{ id: string }>("select id from deal_eingaenge where tenant_id = $1 and discord_ref = $2", [T, `810000000000000001/${pp.id}`]);
    expect(ppE).toBeTruthy();
    await fetch(`${TD}/__discord-va/reaktion`, { method: "POST", body: JSON.stringify({ nachricht: pp.id, emoji: "👍" }) });
    await Promise.all([aktion(page), page.getByTestId("de-profitpath").click()]);
    await expect(page.getByRole("status")).toContainText("1 Bewertung (👍/👎) aus Discord");
    const [frage] = await sql<{ ref: string | null }>("select daumen_frage_ref ref from deal_eingaenge where id = $1", [ppE.id]);
    expect(frage.ref).toMatch(/^\d+\/\d+$/);
    const [thread, frageId] = frage.ref!.split("/");
    const zustand = (await (await fetch(`${TD}/__discord-va`)).json()) as { nachrichten: { id: string; channel_id: string; content: string; reactions: { emoji: { name: string }; me?: boolean }[] }[] };
    const f = zustand.nachrichten.find((x) => x.id === frageId)!;
    expect(f.channel_id).toBe(thread);
    expect(f.content).toContain("Warum passt der Deal?");
    expect(f.content).toContain(`2️⃣ ${GRUND_LAND}`);
    expect(f.reactions.filter((x) => x.me).map((x) => x.emoji.name)).toEqual(["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"]);
    await fetch(`${TD}/__discord-va/reaktion`, { method: "POST", body: JSON.stringify({ nachricht: frageId, emoji: "2️⃣" }) });
    await fetch(`${TD}/__discord-va/nachricht`, { method: "POST", body: JSON.stringify({ kanal: thread, text: `FR fast leer (${m})` }) });
    await Promise.all([aktion(page), page.getByTestId("de-profitpath").click()]);
    const [ppG] = await sql<{ g: string[]; f: string | null }>("select daumen_gruende g, daumen_freitext f from deal_eingaenge where id = $1", [ppE.id]);
    expect(ppG).toEqual({ g: [GRUND_LAND], f: `FR fast leer (${m})` });

    // 5) Gekauft → Entwurf an den Lieferanten mit 84 × 25 € netto; Senden → Mail raus, Beleg am Deal und im Einkauf
    await page.goto(`/deal-eingang/${idA}#gekauft`);
    const form = page.getByTestId("de-gekauft-form");
    await form.locator('input[name="menge"]').fill("84");
    await form.locator('input[name="preis"]').fill("25");
    await form.getByTestId("de-verpackung").selectOption("eingeschweisst");
    await form.getByTestId("de-ean-abweichend").selectOption("ja");
    await expect(form.getByTestId("de-bestellmail-schalter")).toBeChecked();
    await Promise.all([aktion(page), page.getByTestId("de-gekauft-knopf").click()]);
    await expect(page.getByRole("status")).toContainText(`Entwurf der Bestellmail an ${mail}`);
    await expect(page.getByTestId("de-fnsku-hinweis")).toContainText("FNSKU-Etikett nötig");
    const entwurf = page.getByTestId("de-bestellmail-entwurf");
    await expect(entwurf.getByTestId("de-bestellmail-an")).toHaveValue(mail);
    await expect(entwurf.getByTestId("de-bestellmail-betreff")).toHaveValue(/^Bestellung .+: 84 × .+ \(ASIN B0PFANNE01\)$/);
    const text = await entwurf.getByTestId("de-bestellmail-text").inputValue();
    expect(text).toContain(`Hallo ${kontakt},`);
    expect(text).toContain("ASIN: B0PFANNE01");
    expect(text).toContain("eingeschweißt");
    expect(text).toContain("Menge: 84 Stück");
    expect(text).toContain("Preis: 25,00 € netto je Stück, gesamt 2.100,00 € netto");
    expect(text).toContain("Zahlung: Überweisung Vorkasse");
    expect(text).toContain("Sendungsnummer");
    // Vor „Senden“ geht nichts raus
    expect((await sql("select 1 from test_mails where \"to\" like $1", [`${mail}%`])).length).toBe(0);
    await entwurf.getByTestId("de-bestellmail-text").fill(`${text}\n\nPS: bitte bis Freitag (${m}).`);
    await Promise.all([aktion(page), entwurf.getByTestId("de-bestellmail-senden").click()]);
    await expect(page.getByRole("status")).toContainText(`Bestellmail an ${mail} gesendet`);
    const gesendet = await sql<{ subject: string; text: string }>("select subject, text from test_mails where \"to\" like $1", [`${mail}%`]);
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0].subject).toContain("ASIN B0PFANNE01");
    await expect(page.getByTestId("de-bestellmail-gesendet")).toContainText(`Bestellung gesendet am`);
    await expect(page.getByTestId("de-bestellmail-gesendet")).toContainText(mail);
    const [bm] = await sql<{ message_id: string; bestellung_id: string; text: string }>("select message_id, bestellung_id, text from deal_bestellmails where deal_id = $1 and status = 'gesendet'", [idA]);
    expect(bm.bestellung_id).toBeTruthy();
    await page.goto(`/einkauf/${bm.bestellung_id}`);
    await expect(page.getByTestId("ek-bestellmail")).toContainText("Bestellung gesendet");

    // Antwort des Lieferanten (Rechnung + Sendungsnummer) über den Posteingang → am Deal und an der Bestellung
    const eml = [`From: ${lieferant} <${mail}>`, `To: einkauf@example.invalid`, `Subject: AW: Rechnung zu Ihrer Bestellung (${m})`, `Message-ID: <antwort-${m}@example.com>`, `In-Reply-To: ${bm.message_id}`, `References: ${bm.message_id}`, `Date: ${new Date().toUTCString()}`, `Content-Type: text/plain; charset=utf-8`, "", "Danke, Ware ist unterwegs.", "Sendungsnummer: JJD000390007000000001"].join("\r\n");
    await page.goto("/posteingang");
    const emlForm = page.getByTestId("eml-upload").first();
    await emlForm.locator("input[type=file]").setInputFiles({ name: `antwort-${m}.eml`, mimeType: "message/rfc822", buffer: Buffer.from(eml) });
    await emlForm.getByRole("button", { name: "Hochladen", exact: true }).click();
    await expect.poll(async () => (await sql<{ s: string | null }>("select sendungsnummer s from deal_bestellmails where deal_id = $1 and status = 'gesendet'", [idA]))[0].s, { timeout: 30_000 }).toBe("JJD000390007000000001");
    expect((await sql<{ r: boolean }>("select rechnung_erhalten r from deal_bestellmails where deal_id = $1 and status = 'gesendet'", [idA]))[0].r).toBe(true);
    expect((await sql<{ t: string | null }>("select tracking_number t from purchase_orders where id = $1", [bm.bestellung_id]))[0].t).toBe("JJD000390007000000001");
    await page.goto(`/deal-eingang/${idA}#bestellmail`);
    await expect(page.getByTestId("de-bestellmail-sendungsnr")).toHaveText("JJD000390007000000001");
    await expect(page.getByTestId("de-bestellmail-antwort")).toContainText("Rechnung erhalten");

    // Claude: deal_bewerten mit Gründen, Bericht mit Gründen, deal_gekauft legt nur einen Entwurf an
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    expect(JSON.parse(await mcp.call("deal_bewerten", { deal_id: idB, daumen: "hoch", gruende: ["Großer Posten, lange Laufzeit ok"], freitext: `Testgrund ${m}` })).ok).toBe(true);
    expect((await sql<{ g: string[]; f: string }>("select daumen_gruende g, daumen_freitext f from deal_eingaenge where id = $1", [idB]))[0]).toEqual({ g: ["Großer Posten, lange Laufzeit ok"], f: `Testgrund ${m}` });
    const bericht = JSON.parse(await mcp.call("deal_lernen_bericht", { monat }));
    expect(bericht.gruende.daumen_hoch.map((g: { grund: string }) => g.grund)).toEqual(expect.arrayContaining([GRUND_LAND, "Großer Posten, lange Laufzeit ok"]));
    const detail = JSON.parse(await mcp.call("deal_eingang_detail", { id: idA }));
    expect(detail.bestellmails[0]).toMatchObject({ status: "gesendet", an: mail, sendungsnummer: "JJD000390007000000001", rechnung_erhalten: true });
    expect(detail.fnsku_etikett_noetig).toBe(true);
    const r3 = await page.request.post("/api/deal-eingang", { multipart: { text: `B0PFANNE04 Testpfanne 32 cm (erfunden) 30,00 netto ab 10 Stk ${m}`, quelle: `Test-WhatsApp ${m}` }, maxRedirects: 0 });
    const idC = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r3.headers().location ?? "")![1];
    await fertig(idC);
    const gek = JSON.parse(await mcp.call("deal_gekauft", { deal_id: idC, menge: 10, preis: 30, verpackung: "originalkarton" }));
    expect(gek.bestellmail).toMatchObject({ entwurf: true, an: mail });
    expect((await sql<{ status: string }>("select status from deal_bestellmails where deal_id = $1", [idC])).map((x) => x.status)).toEqual(["entwurf"]);
    expect((await sql("select 1 from test_mails where \"to\" like $1", [`${mail}%`])).length).toBe(1);
  });
});
