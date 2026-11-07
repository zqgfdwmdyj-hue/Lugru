// Nachtrag B31 (07.11.): BQool-Upload aus dem Seller-System. Täglicher Kreislauf gegen den BQool-Nachbau: Ist je Land
// (DE/FR/IT/ES) holen und einlesen, Soll erzeugen, Push „BQool-Upload freigeben“, ohne Freigabe nichts hochladen,
// nach „Freigeben“ Upload je Land (Dateityp „Repricing Central File“) mit Rückmeldung und Fehlerzeilen-Aufgabe,
// Nachkontrolle (Min/Regel je SKU), Verfall nach Frist, „automatisch“ nur mit bestätigtem Min-Verhalten.
// Abnahme 1 (ArbitrageOne ohne BQool) steht in arbitrageone.spec.ts. Alle SKUs und Werte erfunden.
import { TD } from "./env";
import { anmelden, expect, marke, mcpVerbinden, sql, test, testdienste } from "./helfer";

const bqool = (body: unknown) => fetch(`${TD}/__bqool`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const bqoolStand = async () => (await (await fetch(`${TD}/__bqool`)).json()) as { ist: Record<string, { sku: string; regel: string; min: number }[]> };
const LAENDER = ["DE", "FR", "IT", "ES"];

test.describe("B31 – täglicher BQool-Kreislauf", () => {
  test("Ist aller Länder → Push mit Zusammenfassung → ohne Freigabe nichts → Freigeben → Upload mit Rückmeldung → Nachkontrolle; Verfall; automatisch nur nach Prüfung", async ({ page, browser, baseURL }) => {
    test.setTimeout(420_000);
    const m = marke();
    const A = `TEST-BQK-${m}-A`;
    const F = `TEST-BQK-${m}-FEHLER`;
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const heute = new Date().toISOString().slice(0, 10);
    const [inhaber] = await sql<{ id: string }>("select m.user_id as id from memberships m where m.tenant_id = $1 and m.role = 'owner' and not m.read_only order by m.created_at limit 1", [T]);
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', $4, 10, '20.00'), ($1, $2, $5, 'purchase', 'test', $4, 10, '10.00')", [T, P, A, heute, F]);
    for (const sku of [A, F]) await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, null, $3, 4, $4)", [T, sku, `Testartikel ${sku} (erfunden)`, heute]);
    // Buy Box DE für A (stammt aus einem früheren „Manage Listings“-Export) – bleibt beim Einlesen der Repricing-Datei stehen
    await sql("insert into bqool_listings (tenant_id, marktplatz, sku, regel, min, max, buybox_preis, eingelesen_am) values ($1, 'DE', $2, 'ia', 75, 150, 60, now() - interval '8 days') on conflict (tenant_id, marktplatz, sku) do update set buybox_preis = 60", [T, A]);
    // BQool-Ist im Nachbau: alte Min-Preise (A in DE über der Buy Box), F nur in DE
    const altIst = (minA: number) => Object.fromEntries(LAENDER.map((l) => [l, [{ sku: A, regel: "ia", min: minA, max: 150, cost: 23.8 }, ...(l === "DE" ? [{ sku: F, regel: "ia", min: 99, max: 150, cost: 11.9 }] : [])]]));
    await bqool({ zuruecksetzen: true, ist: altIst(75) });
    await sql("delete from bqool_laeufe where tenant_id = $1", [T]);
    const vorherUploads = (await testdienste.web()).filter((w) => w.dienst === "bqool").length;
    const uploads = async () => (await testdienste.web()).filter((w) => w.dienst === "bqool").slice(vorherUploads) as { name: string; land?: string | null; typ?: string }[];
    const starten = async () => {
      await page.goto("/repricer/bqool#freigabe");
      await Promise.all([page.waitForURL(/meldung=/, { timeout: 180_000 }), page.getByTestId("bq-kreislauf-starten").click()]);
    };
    try {
      await anmelden(page, "inhaber");

      // ---- Abnahme 2: Ist aller vier Länder importiert, Datenstand = heute ----------------------------------
      await starten();
      await expect(page.getByRole("status")).toContainText("BQool: Freigabe angefragt – DE 2 / FR 1 / IT 1 / ES 1 Änderungen");
      const ist = await sql<{ land: string; n: number; heute: boolean }>("select marktplatz as land, count(*)::int as n, bool_and(eingelesen_am::date = now()::date) as heute from bqool_listings where tenant_id = $1 and sku in ($2, $3) group by marktplatz order by marktplatz", [T, A, F]);
      expect(ist.map((x) => [x.land, x.n, x.heute])).toEqual([["DE", 2, true], ["ES", 1, true], ["FR", 1, true], ["IT", 1, true]]);
      await expect(page.getByTestId("bq-stand")).toContainText("DE heute");
      await expect(page.getByTestId("bq-lauf-ist")).toContainText("DE 2 SKUs · FR 1 SKUs · IT 1 SKUs · ES 1 SKUs");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const rp = JSON.parse(await c.call("repricer", { ansicht: "alle", suche: A, marktplatz: "DE" }));
      expect(rp.bqool_stand).toMatch(/^heute \d\d:\d\d$/);
      const st = JSON.parse(await c.call("anbindungen_status", {}));
      expect(st.bqool.ist_holen.je_land.find((x: { land: string }) => x.land === "IT").stand).toMatch(/^heute/);
      expect(st.bqool.heute).toMatchObject({ freigabe: "offen" });
      expect(st.abrufe.find((x: { abruf: string }) => x.abruf === "BQool: Ist holen").letzter_erfolg).not.toBe("nie");

      // ---- Abnahme 3a: Push mit Zusammenfassung; Abnahme 4: ohne Freigabe nichts hochgeladen -------------------
      const [push] = await sql<{ titel: string; text: string; aktionen: { titel: string; link: string }[] }>("select titel, text, aktionen from meldungen where tenant_id = $1 and user_id = $2 and art = 'bqool' order by created_at desc limit 1", [T, inhaber.id]);
      expect(push.titel).toBe("BQool-Upload freigeben");
      expect(push.text).toMatch(/^DE 2 \/ FR 1 \/ IT 1 \/ ES 1 Änderungen, 0 Regelwechsel, \d+ Warnung/);
      expect(push.aktionen.map((a) => a.titel)).toEqual(["Freigeben", "Ansehen"]);
      expect(await uploads()).toEqual([]);
      const [aufgabe] = await sql<{ title: string }>("select title from tasks where tenant_id = $1 and system_key = 'bqool-freigabe' and status = 'open'", [T]);
      expect(aufgabe.title).toContain("BQool-Upload freigeben: DE 2 / FR 1 / IT 1 / ES 1 Änderungen");

      // ---- Abnahme 3b: Freigeben (Link aus dem Push) → Upload je Land mit Rückmeldung -------------------------
      await page.goto(push.aktionen[0].link);
      await expect(page.getByTestId("bq-freigabe")).toBeVisible();
      await Promise.all([page.waitForURL(/meldung=/, { timeout: 180_000 }), page.getByTestId("bq-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText("Freigegeben und hochgeladen: DE 1 / FR 1 / IT 1 / ES 1 übernommen, 1 Fehler");
      const hoch = await uploads();
      expect(hoch.map((u) => u.land)).toEqual(["amazonde", "amazonfr", "amazonit", "amazones"]);
      expect(hoch.every((u) => u.typ === "repricing")).toBe(true);
      await expect(page.getByTestId("bq-lauf-upload")).toContainText(`${F}: Zeile`);
      const [fz] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key like 'bqool-fehlerzeilen-%' and status = 'open' order by created_at desc limit 1", [T]);
      expect(fz.title).toBe("BQool-Upload: 1 Fehlerzeile");
      expect(fz.notes).toContain(`DE ${F}: Zeile`);
      expect(fz.notes).toContain("Invalid Min Price");
      expect((await sql("select 1 from tasks where tenant_id = $1 and system_key = 'bqool-freigabe' and status = 'open'", [T])).length).toBe(0);

      // Nachkontrolle (sonst automatisch 30 Min. später): Min/Regel in BQool = hochgeladene Datei
      await page.goto("/repricer/bqool#freigabe");
      await Promise.all([page.waitForURL(/meldung=/, { timeout: 180_000 }), page.getByTestId("bq-kontrolle-jetzt").click()]);
      await expect(page.getByRole("status")).toContainText("Nachkontrolle: Min und Regel stimmen bei allen 4 SKUs.");
      await expect(page.getByTestId("bq-kontrolle")).toContainText("stimmen bei allen 4 SKUs");
      // Neuer Min DE = effektiver Min (Standard), liegt jetzt unter der Buy Box 60
      const nach = JSON.parse(await c.call("repricer", { ansicht: "alle", suche: A, marktplatz: "DE" })).zeilen[0];
      expect(nach.min_bqool).toBe(nach.effektiver_min);
      expect(nach.min_bqool).toBeLessThan(60);
      expect(nach.buybox_preis).toBe(60);
      expect((await bqoolStand()).ist.DE.find((x) => x.sku === A)!.min).toBe(nach.min_bqool);
      const st2 = JSON.parse(await c.call("anbindungen_status", {}));
      expect(st2.bqool.letzter_upload).toMatchObject({ uebernommen: "DE 1 / FR 1 / IT 1 / ES 1", fehler: 1, nachkontrolle: "Min und Regel stimmen bei allen 4 SKUs." });

      // ---- Abnahme 4: neuer Lauf, keine Freigabe bis zur Frist → verfällt, nichts hochgeladen ------------------
      await bqool({ ist: altIst(75) });
      await starten();
      await expect(page.getByRole("status")).toContainText("Freigabe angefragt");
      const [offen] = await sql<{ id: string }>("select id from bqool_laeufe where tenant_id = $1 and freigabe = 'offen'", [T]);
      await sql("update bqool_laeufe set created_at = created_at - interval '1 day' where id = $1", [offen.id]);
      const vorVerfall = (await uploads()).length;
      await page.goto(`/repricer/bqool?lauf=${offen.id}#freigabe`);
      await Promise.all([page.waitForURL(/meldung=/, { timeout: 60_000 }), page.getByTestId("bq-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText("Der Lauf ist verfallen");
      expect((await uploads()).length).toBe(vorVerfall);
      expect((await sql<{ freigabe: string }>("select freigabe from bqool_laeufe where id = $1", [offen.id]))[0].freigabe).toBe("verfallen");

      // ---- „automatisch“ geht erst nach bestätigtem Min-Verhalten; dann ohne Freigabe hochgeladen --------------
      await page.goto("/repricer/bqool#kreislauf-einstellungen");
      const e = page.getByTestId("bq-kreislauf-einstellungen");
      await e.locator('input[name="automatisch"]').check();
      await Promise.all([page.waitForURL(/meldung=/), e.getByTestId("bq-kreislauf-speichern").click()]);
      await expect(page.getByRole("status")).toContainText("erst, wenn das Min-Verhalten in BQool bestätigt ist");
      await e.locator('input[name="min_geprueft"]').check();
      await e.locator('input[name="automatisch"]').check();
      await Promise.all([page.waitForURL(/meldung=/), e.getByTestId("bq-kreislauf-speichern").click()]);
      await expect(page.getByRole("status")).toContainText("täglich automatisch hochladen");
      await bqool({ ist: altIst(80) });
      const vorAuto = (await uploads()).length;
      await starten();
      await expect(page.getByRole("status")).toContainText("BQool automatisch hochgeladen");
      expect((await uploads()).length).toBe(vorAuto + 4);
      await expect(page.getByTestId("bq-freigabe-status")).toHaveText("automatisch");

      // Ohne Export-Seite (Ist nicht neu geholt): Vergleich mit dem zuletzt hochgeladenen Stand – keine doppelten Änderungen
      await sql("update integrations set config = config - 'exportUrl' where tenant_id = $1 and provider = 'bqool_web'", [T]);
      const vorOhne = (await uploads()).length;
      await starten();
      await expect(page.getByRole("status")).toContainText("BQool: keine Änderungen – nichts hochzuladen. Ist nicht aktualisiert (keine Export-Seite eingetragen).");
      expect((await uploads()).length).toBe(vorOhne);
    } finally {
      await sql("update integrations set config = config || jsonb_build_object('exportUrl', replace(config->>'uploadUrl', '/upload/', '/export/')) where tenant_id = $1 and provider = 'bqool_web'", [T]);
      await sql("update tenants set settings = settings #- '{bqool,kreislauf}' where id = $1", [T]);
      await sql("delete from bqool_laeufe where tenant_id = $1", [T]);
      await sql("update tasks set status = 'done' where tenant_id = $1 and (system_key like 'bqool-%' or system_key like 'automatik-bqool-%') and status = 'open'", [T]);
      await bqool({ zuruecksetzen: true });
      // Ist und Testartikel wieder weg – sonst hätten FR/IT/ES für spätere Tests einen BQool-Ist
      await sql("delete from bqool_listings where tenant_id = $1 and sku = any($2)", [T, [A, F]]);
      await sql("delete from amazon_inventory where tenant_id = $1 and sku = any($2)", [T, [A, F]]);
      await sql("delete from lots where tenant_id = $1 and sku = any($2)", [T, [A, F]]);
    }
  });
});
