// Bauauftrag B35 Lead-Maschine – Abnahme (B35.8 + B35.9): 50-Zeilen-CSV mit Dubletten (Name+PLZ, Website, USt-IdNr.),
// eigener Lieferant ausgeschlossen, Bewertung und Empfehlung sichtbar; ohne Anschrift, gesperrt oder unter dem
// Mindestabstand nie in einer Charge; Charge mit 20 Entwürfen nur nach Freigabe (Vorschau, nichts verschickt);
// AdelPrep-Beilage nur bei „Zielgruppe AdelPrep“ und je Brief abwählbar; keine Werbe-E-Mail an Leads; Stufe 2 gesperrt bis
// zur rechtlichen Prüfung; Apify-Lauf bricht bei Budget-Überschreitung ab; Captcha → Seite übersprungen und gemeldet.
// Alle Firmen, Adressen, Nummern und Websites erfunden (Test…, example.invalid, DE7…).
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { E2E_ENV, TD } from "./env";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

function versiegeln(plain: string) {
  const key = createHash("sha256").update(`integrations:${E2E_ENV.APP_SECRET}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
type LeadNb = { runs: { id: string; status: string; usd: number }[]; abbrueche: { id: string; usd: number }[]; places: { text: string; pageToken: string | null }[]; abrufe: { at: number; host: string; pfad: string; ua: string }[] };
const nachbau = () => fetch(`${TD}/__leads`).then((r) => r.json() as Promise<LeadNb>);
const briefJobs = () => fetch(`${TD}/__briefe`).then((r) => r.json() as Promise<unknown[]>);

test.describe("B35 Lead-Maschine", () => {
  const m = marke();
  const ml = m.toLowerCase();
  const SKU = `TEST-LM-${m}`;
  const versand = (i: number) => `Testversand ${m} ${i} GmbH`;
  const ust = (i: number) => `DE7${String(parseInt(m, 36) % 100000).padStart(5, "0")}${String(i).padStart(3, "0")}`;
  const lieferant = `Testlieferant ${m} GmbH`;
  const ohneAdresse = `Testversand ohne Adresse ${m} GmbH`;
  const wein = `Testweinhandel ${m} GmbH`;
  const kinder = `Testkinderwelt ${m} GmbH`;
  const obst = `Testobsthof ${m} GmbH`;
  const captcha = `Testcaptcha ${m} GmbH`;
  const impressum = `Testimpressum ${m} GmbH`;
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const start = new Date();
  let T = "";

  const fremd = "(l.firma like $2 or l.firma like 'Testsalon Apify %' or l.firma like 'Testfriseur Places %')";
  test.afterAll(async () => {
    if (!T) return;
    const muster = `%${m}%`;
    await sql(`delete from abverkauf_briefe where tenant_id = $1 and anschreiben_id in (select a.id from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where ${fremd})`, [T, muster]);
    await sql(`delete from abverkauf_chargen where tenant_id = $1 and id in (select charge_id from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where ${fremd})`, [T, muster]);
    await sql(`delete from abverkauf_anschreiben where tenant_id = $1 and lead_id in (select l.id from abverkauf_leads l where ${fremd})`, [T, muster]);
    await sql(`delete from abverkauf_leads l where tenant_id = $1 and ${fremd}`, [T, muster]);
    await sql("delete from abverkauf_lead_laeufe where tenant_id = $1 and created_at >= $2", [T, start]);
    await sql("delete from abverkauf_sperrliste where tenant_id = $1 and created_at >= $2", [T, start]);
    await sql("delete from abverkauf_preislisten where tenant_id = $1 and positionen::text like $2", [T, muster]);
    await sql("delete from sellerboard_inventory where tenant_id = $1 and sku = $2", [T, SKU]);
    await sql("delete from lots where tenant_id = $1 and sku = $2", [T, SKU]);
    await sql("delete from suppliers where tenant_id = $1 and code = $2", [T, `TL${m}`]);
    await sql("delete from integrations where tenant_id = $1 and provider in ('apify', 'google_places')", [T]);
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);
  });

  test("Abnahme B35.8/B35.9: Dubletten, Schutzregeln, Bewertung, Charge 20 nur mit Freigabe, Beilage, Stufe 2 mit Budget, Captcha", async ({ page }) => {
    test.setTimeout(420_000);
    const [{ tenant_id, product_id }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    T = tenant_id;
    // Vorbereitung: Ladenhüter (für die Preisliste), eigener Lieferant, Lager-Standort, Reste früherer Läufe weg
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);
    await sql("update tenants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{abverkauf}', $2::jsonb, true) where id = $1", [T, JSON.stringify({ lager: { name: "Testlager (erfunden)", lat: 50, lng: 8, preisJePaletteMonat: null } })]);
    await sql("delete from abverkauf_anschreiben where tenant_id = $1 and lead_id in (select id from abverkauf_leads where firma like 'Testsalon Apify %' or firma like 'Testfriseur Places %')", [T]);
    await sql("delete from abverkauf_leads where tenant_id = $1 and (firma like 'Testsalon Apify %' or firma like 'Testfriseur Places %')", [T]);
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date - 120, 20, '20.00')", [T, product_id, SKU]);
    await sql("insert into sellerboard_inventory (tenant_id, sb_id, sku, asin, name, fba_stock, synced_at) values ($1, $2, $2, null, $3, 20, now())", [T, SKU, `Testkissen ${m} (erfunden)`]);
    await sql("insert into suppliers (tenant_id, code, name, sku_kuerzel) values ($1, $2, $3, false)", [T, `TL${m}`, lieferant]);
    await fetch(`${TD}/__leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zuruecksetzen: true }) });

    await anmelden(page, "inhaber");
    const meldungAv = page.getByTestId("av-meldung");
    const meldung = page.getByTestId("ld-meldung");

    // Preisliste aus dem Ladenhüter (für Briefe an Amazon-Händler)
    await page.goto("/b2b/abverkauf");
    for (const z of await page.locator('[data-testid="av-kandidat"]').all()) if ((await z.getAttribute("data-sku")) !== SKU) await z.locator('input[name="sku"]').uncheck();
    await Promise.all([aktion(page), page.getByTestId("av-preisliste-los").click()]);
    await expect(meldungAv).toContainText("Preisliste erzeugt (1 Positionen)");

    // Schutzregeln: Konfliktbranche (eigene Marke) eintragen
    await page.goto("/b2b/leads");
    await expect(page.getByTestId("ld-stufe2")).toContainText("Stufe 2 gesperrt");
    await expect(page.getByTestId("ld-lauf-apify")).toHaveCount(0);
    await page.getByTestId("ld-konflikt").fill("Kinderprodukte");
    await expect(page.getByTestId("ld-abstand")).toHaveValue("12");
    await Promise.all([aktion(page), page.getByTestId("ld-schutz-speichern").click()]);
    await expect(meldung).toContainText("Schutzregeln gespeichert");

    // 1. 50-Zeilen-CSV
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const kopf = ["Firma", "Straße", "PLZ", "Ort", "Kategorie", "Website", "USt-IdNr.", "Latitude", "Longitude", "Stück je Artikel", "AdelPrep"];
    const zeilen: string[][] = [];
    const web = (s: string) => `https://${s}-${ml}.example.invalid`;
    for (let i = 1; i <= 24; i++) zeilen.push([versand(i), `Versandweg ${i}`, String(20000 + i), "Musterstadt", "Online-Händler (Amazon)", web(`testversand${i}`), ust(i), "", "", i <= 3 ? "2000" : "500", i <= 3 ? "ja" : ""]);
    zeilen.push([versand(1), "Versandweg 1", "20001", "Musterstadt", "Online-Händler (Amazon)", "", "", "", "", "", ""]); // gleiche Firma + PLZ
    zeilen.push([`Testversand ${m} 2 Handel GmbH`, "Anderer Weg 2", "29002", "Anderstadt", "Online-Händler (Amazon)", "", ust(2), "", "", "", ""]); // gleiche USt-IdNr.
    zeilen.push([`Testversand Drei ${m} GmbH`, "Anderer Weg 3", "29003", "Anderstadt", "Online-Händler (Amazon)", web("testversand3"), "", "", "", "", ""]); // gleiche Website
    zeilen.push([lieferant, "Lieferweg 1", "21000", "Musterstadt", "Online-Händler (Amazon)", web("testlieferant"), "", "", "", "500", ""]);
    zeilen.push([ohneAdresse, "", "", "", "Online-Händler (Amazon)", web("ohneadresse"), "", "", "", "500", ""]);
    for (let i = 1; i <= 10; i++) zeilen.push([`Testspielwaren ${m} ${i} GmbH`, `Spielweg ${i}`, "12345", "Musterstadt", "Spielwarengeschäft", web(`testspielwaren${i}`), "", "50.05", "8.0", "", ""]);
    zeilen.push([wein, "Rebweg 1", "22000", "Musterstadt", "Weinhandel Online-Shop", web("testwein"), "", "", "", "500", ""]);
    zeilen.push([kinder, "Kinderweg 1", "23000", "Musterstadt", "Kinderprodukte Online-Shop", web("testkinder"), "", "", "", "500", ""]);
    zeilen.push([obst, "Obstweg 1", "24000", "Musterstadt", "Obst und Gemüse", web("testobst"), "", "", "", "", ""]);
    for (let i = 1; i <= 8; i++) zeilen.push([`Testfriseur ${m} ${i} GmbH`, `Salonweg ${i}`, "12345", "Musterstadt", "Friseursalon", web(`testfriseur${i}`), "", "50.1", "8.0", "", ""]);
    expect(zeilen).toHaveLength(50);
    await page.goto("/b2b/abverkauf");
    const imp = page.getByTestId("av-import");
    await imp.locator('input[name="datei"]').setInputFiles({ name: `lead-maschine-${m}.csv`, mimeType: "text/csv", buffer: Buffer.from([kopf.join(","), ...zeilen.map((z) => z.map(q).join(","))].join("\n"), "utf8") });
    await imp.locator('input[name="quelle"]').fill(`Testverzeichnis ${m} (erfunden)`);
    await Promise.all([aktion(page), page.getByTestId("av-import-los").click()]);
    await expect(meldungAv).toContainText("47 Leads neu, 0 schon vorhanden, 0 auf der Sperrliste");
    await expect(meldungAv).toContainText("3 Dubletten in der Datei zusammengeführt");
    // Zusammengeführt: Lead 2 bleibt einer (USt-IdNr.), Verlauf mit Quelle
    expect((await sql<{ n: number }>("select count(*)::int n from abverkauf_leads where tenant_id = $1 and firma like $2", [T, `%${m}%`]))[0].n).toBe(47);
    expect((await sql<{ n: number }>("select count(*)::int n from abverkauf_leads where tenant_id = $1 and ust_id = $2", [T, ust(2)]))[0].n).toBe(1);

    // Erneuter Import nur mit gleicher USt-IdNr. (anderer Name/Ort) → kein neuer Lead, sondern zusammengeführt
    await imp.locator('input[name="datei"]').setInputFiles({ name: `nachtrag-${m}.csv`, mimeType: "text/csv", buffer: Buffer.from([kopf.join(","), [`Testversand Fuenf Neu ${m} GmbH`, "Neuer Weg 5", "29005", "Neustadt", "Online-Händler (Amazon)", "", ust(5), "", "", "", ""].map(q).join(",")].join("\n"), "utf8") });
    await Promise.all([aktion(page), page.getByTestId("av-import-los").click()]);
    await expect(meldungAv).toContainText("0 Leads neu, 1 schon vorhanden");
    const [l5] = await sql<{ verlauf: { was: string }[] }>("select verlauf from abverkauf_leads where tenant_id = $1 and ust_id = $2", [T, ust(5)]);
    expect(l5.verlauf.map((v) => v.was).join(" | ")).toContain("Zusammengeführt mit");

    // Bewertung und Schutzregeln auf der Seite „Leads“
    await page.goto(`/b2b/leads?q=${m}`);
    const zeile = (f: string) => page.locator(`[data-testid="ld-lead"][data-firma="${f}"]`);
    await expect(zeile(versand(1))).toHaveAttribute("data-ziel", "fba_prep");
    await expect(zeile(versand(1))).toHaveAttribute("data-prio", "100");
    await expect(zeile(versand(1))).toContainText("AdelPrep FBA-Prep");
    await expect(zeile(versand(5))).toHaveAttribute("data-prio", "90");
    await expect(zeile(`Testspielwaren ${m} 1 GmbH`)).toHaveAttribute("data-ziel", "spielwaren");
    await expect(zeile(`Testspielwaren ${m} 1 GmbH`)).toContainText("6 km");
    await expect(zeile(`Testfriseur ${m} 1 GmbH`)).toHaveAttribute("data-ziel", "friseure");
    await expect(zeile(lieferant)).toHaveAttribute("data-sperre", "1");
    await expect(zeile(lieferant).getByTestId("ld-sperre")).toContainText("eigener Lieferant");
    await expect(zeile(ohneAdresse).getByTestId("ld-sperre")).toContainText("ohne vollständige Postadresse");
    await expect(zeile(wein).getByTestId("ld-sperre")).toContainText("Lagerbedingungen klären");
    await expect(zeile(kinder).getByTestId("ld-sperre")).toContainText("Konfliktbranche");
    await expect(zeile(obst).getByTestId("ld-sperre")).toContainText("Frischware");
    await expect(page.getByTestId("ld-karte")).toBeVisible();
    // Umkreis 8 km: nur Spielwaren (≈ 6 km), nicht die Friseure (≈ 11 km)
    await page.goto(`/b2b/leads?q=${m}&km=8`);
    await expect(page.locator('[data-testid="ld-lead"]')).toHaveCount(10);
    await expect(page.getByTestId("ld-karte")).toHaveAttribute("data-punkte", "10");

    // 2. Sperre (Widerspruch) per Klick und Mindestabstand (Brief vor 30 Tagen)
    const id = async (f: string) => (await sql<{ id: string }>("select id from abverkauf_leads where tenant_id = $1 and firma = $2", [T, f]))[0].id;
    await page.goto(`/b2b/leads/${await id(versand(24))}`);
    await expect(page.getByTestId("lead-herkunft")).toContainText(`Testverzeichnis ${m} (erfunden)`);
    await expect(page.getByTestId("lead-herkunft")).toContainText("Art. 6 Abs. 1 lit. f DSGVO");
    await Promise.all([aktion(page), page.getByTestId("lead-sperren").click()]);
    await expect(meldung).toContainText("Lead gesperrt");
    await expect(page.getByTestId("lead-sperre")).toContainText("Sperrliste");
    await sql("update abverkauf_leads set letzter_brief_am = (current_date - 30)::text where tenant_id = $1 and firma = $2", [T, versand(23)]);
    await page.goto(`/b2b/leads/${await id(versand(23))}`);
    await expect(page.getByTestId("lead-sperre")).toContainText("Mindestabstand");
    // Auskunft (JSON) je Lead
    const ausk = await page.request.get(`/b2b/leads/${await id(versand(5))}/auskunft`);
    expect(ausk.status()).toBe(200);
    const json = (await ausk.json()) as { herkunft: { quelle: string; rechtsgrundlage: string; loeschenAm: string }; stammdaten: { ustId: string } };
    expect(json.herkunft.quelle).toBe(`Testverzeichnis ${m} (erfunden)`);
    expect(json.stammdaten.ustId).toBe(ust(5));
    expect(json.herkunft.loeschenAm > heute).toBe(true);

    // 3. Charge mit 20: nur Entwürfe, nichts freigegeben oder verschickt
    const jobsVorher = (await briefJobs()).length;
    await page.goto("/b2b/leads");
    await page.getByTestId("ld-charge-anzahl").fill("20");
    await Promise.all([aktion(page), page.getByTestId("ld-charge").click()]);
    await expect(meldung).toContainText("20 Entwürfe für die nächste Charge vorbereitet – nichts verschickt, Freigabe nötig");
    const entw = await sql<{ firma: string; status: string; charge_id: string | null; beilage: boolean }>("select l.firma, a.status, a.charge_id, a.adelprep_beilage beilage from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where a.tenant_id = $1 and l.firma like $2", [T, `%${m}%`]);
    expect(entw).toHaveLength(20);
    expect(entw.every((e) => e.status === "entwurf" && e.charge_id === null)).toBe(true);
    for (const f of [versand(23), versand(24), lieferant, ohneAdresse, wein, kinder, obst]) expect(entw.map((e) => e.firma), f).not.toContain(f);
    // 4. Beilage nur bei Zielgruppe AdelPrep
    for (const e of entw) expect(e.beilage, e.firma).toBe([versand(1), versand(2), versand(3)].includes(e.firma));
    expect((await sql<{ n: number }>("select count(*)::int n from abverkauf_briefe b join abverkauf_anschreiben a on a.id = b.anschreiben_id join abverkauf_leads l on l.id = a.lead_id where b.tenant_id = $1 and l.firma like $2", [T, `%${m}%`]))[0].n).toBe(0);
    expect((await briefJobs()).length).toBe(jobsVorher);
    await page.goto(`/b2b/leads/${await id(versand(1))}`);
    await expect(page.getByTestId("lead-verlauf")).toContainText("Entwurf vorbereitet (Charge, AdelPrep FBA-Prep)");

    // Beilage je Brief abwählbar, dann Freigabe als Charge → Vorschau mit Kosten, weiter nichts verschickt
    await page.goto("/b2b/abverkauf");
    const brief1 = page.locator('[data-testid="av-anschreiben-zeile"]').filter({ hasText: versand(1) });
    await expect(brief1.getByTestId("av-beilage-schalter")).toHaveAttribute("data-an", "1");
    await Promise.all([aktion(page), brief1.getByTestId("av-beilage-schalter").click()]);
    await expect(meldungAv).toContainText("Beilage für diesen Brief abgewählt");
    await expect(brief1.getByTestId("av-beilage-schalter")).toHaveAttribute("data-an", "0");
    for (const z of await page.locator('[data-testid="av-anschreiben-zeile"][data-status="entwurf"]').all()) if (!(await z.innerText()).includes(m)) await z.locator('input[name="anschreiben"]').uncheck();
    await Promise.all([aktion(page), page.getByTestId("av-freigeben").click()]);
    await expect(meldungAv).toContainText("20 freigegeben");
    await Promise.all([page.waitForURL(/\/b2b\/abverkauf\/versand\//), page.getByTestId("av-versand").first().click()]);
    await expect(page.getByTestId("versand-vorschau")).toBeVisible();
    await expect(page.getByTestId("versand-zeile")).toHaveCount(20);
    expect((await briefJobs()).length).toBe(jobsVorher);

    // 5. Keine Werbe-E-Mail: auch eine gefundene Adresse bleibt für den Versand gesperrt (siehe auch b34-abverkauf)
    // 6. Stufe 2: erst nach eingetragener rechtlicher Prüfung; Apify-Budget wird durchgesetzt
    await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'apify', 'Test', '{}'::jsonb, $2)", [T, versiegeln(JSON.stringify({ token: "test-apify-token" }))]);
    await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'google_places', 'Test', '{}'::jsonb, $2)", [T, versiegeln(JSON.stringify({ apiKey: "test-places-schluessel" }))]);
    await page.goto("/b2b/leads");
    const f = page.getByTestId("ld-quellen-form");
    await f.getByTestId("ld-apify").check();
    await f.getByTestId("ld-apify-actor").fill("testanbieter/test-leads");
    await f.getByTestId("ld-apify-lauf").fill("0,10");
    await f.getByTestId("ld-apify-monat").fill("5");
    await f.getByTestId("ld-apify-eingabe").fill('{"suche":"Friseur","ort":"Musterstadt"}');
    await Promise.all([aktion(page), page.getByTestId("ld-quellen-speichern").click()]);
    await expect(meldung).toContainText("Stufe 2 bleibt gesperrt");
    await expect(page.getByTestId("ld-lauf-apify")).toHaveCount(0);
    await page.getByTestId("ld-geprueft-am").fill(heute);
    await f.locator('input[name="geprueftVon"]').fill("Testkanzlei (erfunden)");
    await Promise.all([aktion(page), page.getByTestId("ld-quellen-speichern").click()]);
    await expect(meldung).toContainText("Quellen gespeichert.");
    await expect(page.getByTestId("ld-stufe2")).toContainText("Stufe 2 freigegeben");
    await Promise.all([aktion(page), page.getByTestId("ld-lauf-apify").click()]);
    await expect(meldung).toContainText("Budget überschritten");
    await expect(meldung).toContainText("Lauf abgebrochen");
    await expect(page.locator('[data-testid="ld-lauf"][data-quelle="apify"]').first()).toHaveAttribute("data-status", "abgebrochen");
    const nb = await nachbau();
    expect(nb.abbrueche.length).toBe(1);
    expect(nb.abbrueche[0].usd).toBeGreaterThan(0.1);
    expect(nb.abbrueche[0].usd).toBeLessThanOrEqual(0.2);
    expect((await sql<{ n: number }>("select count(*)::int n from abverkauf_leads where tenant_id = $1 and firma like 'Testsalon Apify %' and quelle_typ = 'apify'", [T]))[0].n).toBe(1);

    // Google Places: Abruf kostet je Seite – zweite Seite würde das Budget sprengen → abgebrochen
    await f.getByTestId("ld-places").check();
    await f.getByTestId("ld-places-preis").fill("0,04");
    await f.getByTestId("ld-places-lauf").fill("0,05");
    await f.getByTestId("ld-places-monat").fill("1");
    await f.getByTestId("ld-places-suchen").fill("Friseur mehr | 12345 | 20");
    await Promise.all([aktion(page), page.getByTestId("ld-quellen-speichern").click()]);
    await expect(meldung).toContainText("Quellen gespeichert.");
    const placesVorher = (await nachbau()).places.length;
    await Promise.all([aktion(page), page.getByTestId("ld-lauf-places").click()]);
    await expect(meldung).toContainText("Budget erreicht");
    await expect(meldung).toContainText("2 Treffer");
    expect((await nachbau()).places.length - placesVorher).toBe(1);

    // 7. Impressum-Abruf: robots.txt, eigener User-Agent, Pause; Captcha → übersprungen, gemeldet, nicht erneut
    await page.goto("/b2b/abverkauf");
    const imp2 = page.getByTestId("av-import");
    await imp2.locator('input[name="datei"]').setInputFiles({ name: `impressum-${m}.csv`, mimeType: "text/csv", buffer: Buffer.from(["Firma,Straße,PLZ,Ort,Kategorie,Website", `${captcha},Testweg 1,12345,Musterstadt,Friseur,https://captcha-${ml}.example.invalid`, `${impressum},Testweg 2,12345,Musterstadt,Friseur,https://testimpressum-${ml}.example.invalid`].join("\n"), "utf8") });
    await Promise.all([aktion(page), page.getByTestId("av-import-los").click()]);
    await expect(meldungAv).toContainText("2 Leads neu");
    // Nur diese beiden sind noch nicht abgerufen
    await sql("update abverkauf_leads set impressum_am = now() where tenant_id = $1 and firma not in ($2, $3) and impressum_am is null", [T, captcha, impressum]);
    await page.goto("/b2b/leads");
    await f.getByTestId("ld-impressum").check();
    await Promise.all([aktion(page), page.getByTestId("ld-quellen-speichern").click()]);
    await expect(meldung).toContainText("Quellen gespeichert.");
    const abrufeVorher = (await nachbau()).abrufe.length;
    await Promise.all([aktion(page), page.getByTestId("ld-lauf-impressum").click()]);
    await expect(meldung).toContainText("2 Websites: 1 Impressum gelesen");
    await expect(meldung).toContainText("1 mit Captcha/Sperre übersprungen (gemeldet, nicht erneut versucht)");
    await expect(page.getByTestId("ld-gemeldet")).toContainText("Captcha");
    const abrufe = (await nachbau()).abrufe.slice(abrufeVorher);
    expect(abrufe.every((a) => a.ua.startsWith("SellerSystem-Leadsuche/"))).toBe(true);
    expect(abrufe.filter((a) => a.host === `captcha-${ml}.example.invalid`)).toHaveLength(1);
    expect(abrufe.map((a) => a.pfad)).toEqual(expect.arrayContaining(["/robots.txt", "/impressum"]));
    for (let i = 1; i < abrufe.length; i++) expect(abrufe[i].at - abrufe[i - 1].at).toBeGreaterThanOrEqual(250);
    // Angereichert: USt-IdNr. und E-Mail aus dem Impressum (nur für Antworten)
    await page.goto(`/b2b/leads/${await id(impressum)}`);
    await expect(page.getByTestId("lead-ust")).toContainText("DE000000099");
    await expect(page.getByTestId("lead-herkunft")).toContainText(`https://testimpressum-${ml}.example.invalid/impressum`);
    await page.goto(`/b2b/leads/${await id(captcha)}`);
    await expect(page.getByTestId("lead-herkunft")).toContainText("Captcha/Sperre");
    await page.goto("/b2b/abverkauf");
    await expect(page.locator(`[data-testid="av-lead"][data-firma="${impressum}"]`).getByTestId("av-lead-email")).toHaveAttribute("data-mail", "gesperrt");
    // Zweiter Lauf: Captcha-Seite wird nicht erneut versucht
    await page.goto("/b2b/leads");
    await Promise.all([aktion(page), page.getByTestId("ld-lauf-impressum").click()]);
    await expect(meldung).toContainText("0 Websites");
  });
});
