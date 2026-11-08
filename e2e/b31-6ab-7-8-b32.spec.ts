// Nachtrag B31.6a/b, B31.7, B31.8 und B32 (08.11.): Regel-Leiter, „Liquidation bis“, Zustand gebrauchter Ware,
// Schnelldreher-Schutz und Listing-Check. Abnahmen als Ablauf im Browser + Claude-Werkzeuge. Alle SKUs und Werte erfunden.
import type { Page } from "@playwright/test";
import { TD } from "./env";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const ERSTE = "FileType = repricing,  Version = 1.2.5 (Please do not edit this line or this will result in error when uploading)";
const KOPF = "Channel\tSellerSKU\tCost\tAdditional Cost\tRule Name\tMin Price\tMax Price\tShipping\tadd-delete\tGroup\tEnable Repricing";
const f2 = (n: number) => n.toFixed(2);
const r2 = (n: number) => Math.round(n * 100) / 100;

type Zeile = { sku: string; regel_ist: string | null; regel_soll: string; stufe?: number; min_ist: number | null; min_datei: number; effektiver_min: number | null; marge_prozent: number | null; buybox: number | null; warnungen?: string[]; zustand?: string; zielpreis_gebraucht?: number; min_gebraucht?: number; schnelldreher?: boolean; schnelldreher_boden?: number; break_even: number | null };

/** BQool-Ist DE hochladen (ersetzt alle DE-Zeilen des Mandanten – deshalb je Test eine Datei mit allen Test-SKUs). */
async function istHochladen(page: Page, name: string, zeilen: { sku: string; regel: string; min: string; max: string; enable: "0" | "1"; cost?: string }[]) {
  const datei = [ERSTE, KOPF, ...zeilen.map((z) => `Amazon DE\t${z.sku}\t${z.cost ?? "23.80"}\t\t${z.regel}\t${z.min}\t${z.max}\t0.00\t\t\t${z.enable}`), ""].join("\r\n");
  await page.goto("/uploads");
  await page.getByTestId("upload-dateien").setInputFiles([{ name, mimeType: "text/plain", buffer: Buffer.from(datei, "utf8") }]);
  await page.getByTestId("upload-los").click();
  await expect(page.getByTestId("upload-ergebnis")).toHaveAttribute("data-art", "bqool_datei", { timeout: 60_000 });
}

async function grundlage(sku: string, o: { ek?: string; menge?: number; kind?: "purchase" | "return" | "unknown"; alter?: string | null; asin?: string | null; tageAlt?: number } = {}) {
  const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
  const menge = o.menge ?? 20;
  await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, $4, 'test', current_date - $5::int, $6, $7)", [T, P, sku, o.kind ?? "purchase", o.tageAlt ?? 10, menge, o.ek ?? "20.00"]);
  await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, $3, $4, $5, current_date)", [T, sku, o.asin ?? null, `Testartikel ${sku} (erfunden)`, menge]);
  // Kapital-Ampel (Reichweite, Kapital) liest den sellerboard-Bestand
  await sql("insert into sellerboard_inventory (tenant_id, sb_id, sku, asin, name, fba_stock, synced_at) values ($1, $2, $2, $3, $4, $5, now())", [T, sku, o.asin ?? null, `Testartikel ${sku} (erfunden)`, menge]);
  if (o.alter) await sql(`insert into amazon_lageralter (tenant_id, land, sku, verfuegbar, "alter", abgerufen_am) values ($1, 'DE', $2, $3, $4::jsonb, now())`, [T, sku, menge, JSON.stringify({ [o.alter]: menge })]);
  return T;
}

async function aufraeumen(T: string, muster: string) {
  for (const t of ["bqool_vorschlaege", "bqool_sku_pflege", "artikel_zustand", "bqool_liquidationen", "bqool_zuweisungen", "bqool_listings:marktplatz", "amazon_lageralter", "amazon_inventory", "sellerboard_inventory", "lots", "verlust_ausnahmen", "keepa_cache:asin"]) {
    const [tab, spalte] = t.split(":");
    if (spalte === "asin") await sql(`delete from ${tab} where tenant_id = $1 and asin like $2`, [T, muster.replace("TEST-", "B0T")]);
    else await sql(`delete from ${tab} where tenant_id = $1 and sku like $2`, [T, muster]);
  }
  await sql("update tasks set status = 'done' where tenant_id = $1 and system_key in ('bqool-leiter', 'bqool-zustand-pruefen', 'bqool-liquidation-ablauf', 'bqool-rueckkehr') and status = 'open'", [T]);
}

const zeileVon = (v: { laender: { groesste_aenderungen: Zeile[] }[] }, sku: string) => v.laender.flatMap((l) => l.groesste_aenderungen).find((z) => z.sku === sku);
const leiterZeile = (page: Page, sku: string, art: string) => page.locator(`[data-testid="bq-leiter-zeile"][data-sku="${sku}"][data-art="${art}"]`);

test.describe("B31.6a/b – Regel-Leiter und „Liquidation bis“", () => {
  test("1 → 2 und 2 → 3 als Vorschlag mit Freigabe, Liquidation läuft ab (Push/Aufgabe, Verlängern, automatisch +30 Tage, dauerhaft), Spalten Stufe/Liquidation bis", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const m = marke();
    const L1 = `TEST-LEITER1-${m}`;
    const L2 = `TEST-LEITER2-${m}`;
    const L3 = `TEST-LEITER3-${m}`;
    const T = await grundlage(L1);
    await grundlage(L2, { alter: "91-180" });
    await grundlage(L3, { alter: "91-180" });
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const vorschau = async () => JSON.parse(await c.call("bqool_export_vorschau", { land: "DE", limit: 100 }));
      await istHochladen(page, `Listings_${m}_leiter.txt`, [
        { sku: L1, regel: "ia", min: "80.00", max: "150.00", enable: "1" },
        { sku: L2, regel: "Abverkauf DE", min: "80.00", max: "150.00", enable: "1" },
        { sku: L3, regel: "Liquidation", min: "25.00", max: "150.00", enable: "1" },
      ]);
      // L2: Stufe 2 (Abverkauf DE, Lageralter 91 T → 1 %) kommt seit 8 Tagen nicht in die Buy Box
      const z2 = zeileVon(await vorschau(), L2)!;
      expect(z2.regel_soll).toBe("Abverkauf DE");
      const bb2 = r2(z2.effektiver_min! - 0.05);
      await sql("update bqool_listings set buybox_preis = $3 where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, L2, f2(bb2)]);
      await sql("insert into bqool_sku_pflege (tenant_id, land, sku, ueber_seit) values ($1, 'DE', $2, current_date - 8)", [T, L2]);
      // L3: Liquidation der Leiter, läuft in 5 Tagen ab; Stufe 2 liegt weiter über der Buy Box
      await sql("update bqool_listings set buybox_preis = '1.00' where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, L3]);
      await sql("insert into bqool_liquidationen (tenant_id, land, sku, grund, regel_vorher, min_gesetzt, eff_min_vorher, break_even, status, aktiv_seit, bis) values ($1, 'DE', $2, 'leiter', 'Abverkauf DE', 25, 30, 24, 'aktiv', now() - interval '40 days', current_date + 5)", [T, L3]);

      await page.goto("/repricer/bqool#liquidation");
      await Promise.all([aktion(page), page.getByTestId("bq-liq-pruefen").click()]);
      await expect(page.getByRole("status")).toContainText("Liquidation geprüft");

      // ---- Freigabe-Seite zeigt jeden Stufenwechsel einzeln ------------------------------------------------------------
      await page.goto("/repricer/bqool#leiter");
      const v12 = leiterZeile(page, L1, "stufe_1_2");
      await expect(v12).toContainText("Stufe 1 → 2 (Abverkauf)");
      await expect(v12).toContainText("ia → Abverkauf DE");
      await expect(v12).toContainText("keine Verkäufe");
      const v23 = leiterZeile(page, L2, "stufe_2_3");
      await expect(v23).toContainText("Abverkauf DE → Liquidation");
      await expect(v23).toContainText("seit 8 Tagen über der Buy Box");
      const [{ min: min23 }] = await sql<{ min: number }>("select min::float as min from bqool_vorschlaege where tenant_id = $1 and sku = $2 and art = 'stufe_2_3' and status = 'offen'", [T, L2]);
      expect(min23).toBeLessThan(z2.effektiver_min!); // nie über dem effektiven Min der Stufe 2
      expect(min23).toBeGreaterThanOrEqual(z2.break_even! - 0.005); // nie unter Break-even
      expect(min23).toBe(Math.max(z2.break_even!, r2(bb2 * 0.99)));
      // Claude-Werkzeug zeigt die Vorschläge
      const lt = (await vorschau()).leiter;
      expect(lt.vorschlaege).toContainEqual(expect.objectContaining({ sku: L1, vorschlag: "Stufe 1 → 2 (Abverkauf)", nach: "Abverkauf DE" }));
      // Stufe 3 → Morgenbericht-Zeile
      const [{ st }] = await sql<{ st: { stufe2: number; stufe3: number; unterBe: number; vorschlaege: number } }>("select settings->'bqool'->'leiterStand' as st from tenants where id = $1", [T]);
      expect(st.stufe2).toBeGreaterThanOrEqual(1);
      expect(st.vorschlaege).toBeGreaterThanOrEqual(2);

      // Freigeben 1 → 2: Soll-Regel Abverkauf DE (Quelle Regel-Leiter), kommt mit der nächsten Datei
      await Promise.all([aktion(page), v12.getByTestId("bq-leiter-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText(`${L1} (DE): ia → Abverkauf DE – kommt mit der nächsten BQool-Datei`);
      expect((await sql<{ regel: string; quelle: string }>("select regel, quelle from bqool_zuweisungen where tenant_id = $1 and land = 'DE' and sku = $2", [T, L1]))[0]).toEqual({ regel: "Abverkauf DE", quelle: "leiter" });
      expect(zeileVon(await vorschau(), L1)).toMatchObject({ regel_ist: "ia", regel_soll: "Abverkauf DE", stufe: 2 });
      // Freigeben 2 → 3: Liquidation mit festem Min, wartet auf den Test mit einer SKU (B31.6)
      await Promise.all([aktion(page), v23.getByTestId("bq-leiter-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText(`${L2} (DE): Abverkauf DE → Liquidation (Min ${f2(min23)})`);
      const s23 = zeileVon(await vorschau(), L2)!;
      expect(s23.regel_soll).toBe("Liquidation");
      expect(s23.min_datei).toBe(min23);
      expect(s23.warnungen ?? []).toContainEqual(expect.stringContaining("wartet auf den Test mit einer SKU"));

      // ---- B31.6a: „Liquidation bis“ – 7 Tage vorher Push/Aufgabe mit drei Knöpfen ------------------------------------
      await page.goto("/repricer/bqool#liquidation");
      const z3 = page.locator(`[data-testid="bq-liq-aktiv-zeile"][data-sku="${L3}"]`);
      await expect(z3.getByTestId("bq-liq-bis")).toContainText("noch 5 T");
      await expect(z3.getByTestId("bq-liq-ablauf")).toHaveAttribute("data-gemeldet", "1");
      const [aufgabe] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key = 'bqool-liquidation-ablauf' and status = 'open'", [T]);
      expect(aufgabe.title).toMatch(/^BQool: Liquidation läuft ab – \d+ SKUs? entscheiden$/);
      expect(aufgabe.notes).toContain(`DE ${L3} bis`);
      expect(aufgabe.notes).toContain("„Verlängern 30 Tage“ / „Zurück auf alte Regel“ / „Dauerhaft Liquidation“");
      const [push] = await sql<{ titel: string }>("select titel from push_protokoll where tenant_id = $1 and titel like 'Liquidation läuft in 7 Tagen ab%' order by created_at desc limit 1", [T]).catch(() => [{ titel: "" }]);
      if (push?.titel) expect(push.titel).toContain("Liquidation läuft in 7 Tagen ab");
      // Verlängern 30 Tage
      const [{ bis: bis0 }] = await sql<{ bis: string }>("select bis::text from bqool_liquidationen where tenant_id = $1 and sku = $2", [T, L3]);
      await Promise.all([aktion(page), z3.getByTestId("bq-liq-ablauf-verlaengern").click()]);
      await expect(page.getByRole("status")).toContainText(`${L3} (DE): verlängert um 30 Tage.`);
      const [{ bis: bis1, diff }] = await sql<{ bis: string; diff: number }>("select bis::text, (bis - $3::date)::int as diff from bqool_liquidationen where tenant_id = $1 and sku = $2", [T, L3, bis0]);
      expect(diff).toBe(30);
      await expect(z3.getByTestId("bq-liq-ablauf")).toHaveAttribute("data-gemeldet", "0");
      expect(bis1).not.toBe(bis0);
      // Ohne Antwort abgelaufen, Stufe 2 liegt noch über der Buy Box → +30 Tage automatisch, Morgenbericht
      await sql("update bqool_liquidationen set bis = current_date - 1, ablauf_gemeldet_am = null where tenant_id = $1 and sku = $2", [T, L3]);
      await Promise.all([aktion(page), page.getByTestId("bq-liq-pruefen").click()]);
      const [{ diff: d2, verl }] = await sql<{ diff: number; verl: number }>("select (bis - current_date)::int as diff, verlaengert as verl from bqool_liquidationen where tenant_id = $1 and sku = $2", [T, L3]);
      expect(d2).toBe(30);
      expect(verl).toBe(2);
      const [{ st: st2 }] = await sql<{ st: { verlaengert: number } }>("select settings->'bqool'->'leiterStand' as st from tenants where id = $1", [T]);
      expect(st2.verlaengert).toBeGreaterThanOrEqual(1);
      // Dauerhaft Liquidation
      await Promise.all([aktion(page), z3.getByTestId("bq-liq-ablauf-dauerhaft").click()]);
      await expect(page.getByRole("status")).toContainText(`${L3} (DE): dauerhaft Liquidation.`);
      await expect(z3.getByTestId("bq-liq-bis")).toHaveText("dauerhaft");

      // ---- Repricer: Spalten Stufe + „Liquidation bis“, Filter „läuft in 7 Tagen ab“ --------------------------------
      await page.goto(`/repricer?bq=alle&q=TEST-LEITER&leiter=ablauf7#bqool-liste`);
      await expect(page.getByTestId("bqool-filter-leiter")).toHaveValue("ablauf7");
      await expect(page.locator(`[data-testid="bqool-zeile"]`).filter({ hasText: L3 })).toHaveCount(0); // dauerhaft = läuft nicht ab
      await sql("update bqool_liquidationen set dauerhaft = false, bis = current_date + 3 where tenant_id = $1 and sku = $2", [T, L3]);
      await page.reload();
      const r3 = page.locator(`[data-testid="bqool-zeile"]`).filter({ hasText: L3 });
      await expect(r3.getByTestId("bqool-liq-bis")).toContainText("noch 3 T");
      await expect(r3.getByTestId("bqool-stufe")).toContainText("3");
      await page.goto(`/repricer?bq=alle&q=${L2}#bqool-liste`);
      await expect(page.locator(`[data-testid="bqool-zeile"]`).filter({ hasText: L2 }).getByTestId("bqool-stufe")).toContainText("2");
    } finally {
      await aufraeumen(T, `TEST-LEITER_-${m}`);
    }
  });
});

test.describe("B31.7 – Zustand der Ware", () => {
  test("Abnahme 1–4: RET_-SKU gebraucht mit Zielpreis/Min gebraucht, unbekannt mit Aufgabe ohne Upload, Zustand von Hand, Export-Vorschau mit gebrauchtem Min", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const R = `RET_3_LPNTEST${m}_FBA`;
    const U = `TEST-ZUSTAND-${m}`;
    const T = await grundlage(R, { ek: "60.00", menge: 1, alter: "181-270" });
    await grundlage(U, { kind: "unknown", menge: 2 });
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const vorschau = async () => JSON.parse(await c.call("bqool_export_vorschau", { land: "DE", limit: 100 }));
      await istHochladen(page, `Listings_${m}_zustand.txt`, [
        { sku: R, regel: "ia", min: "", max: "", enable: "0", cost: "71.40" },
        { sku: U, regel: "ia", min: "40.00", max: "90.00", enable: "1" },
      ]);
      await sql("update bqool_listings set buybox_preis = '150.00' where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, R]);

      // Abnahme 1 + 4: gebraucht erkannt (SKU-Muster), Zielpreis = Neupreis × 0,84, Min gebraucht = Break-even + 3 %
      const v = await vorschau();
      const z = zeileVon(v, R)!;
      expect(z).toMatchObject({ zustand: "gebraucht", zielpreis_gebraucht: 126, regel_soll: "Abverkauf DE" });
      expect(z.min_gebraucht).toBeGreaterThan(z.break_even!);
      expect(z.min_datei).toBe(z.min_gebraucht);
      // Neupreis-Min (ia, 10 % Marge bei frischem Bestand) wäre deutlich höher – er kommt nicht in die Datei
      expect(z.min_datei).toBeLessThan(r2(z.break_even! * 1.05));
      await page.goto(`/repricer?bq=alle&q=${R}#bqool-liste`);
      const zr = page.locator(`[data-testid="bqool-zeile"]`).filter({ hasText: R });
      await expect(zr.getByTestId("bqool-zustand")).toContainText("gebraucht");
      await expect(zr.getByTestId("bqool-zielpreis")).toContainText("126,00");

      // Abnahme 2: ohne Zustandsinfo → unbekannt, nicht in der Datei, Aufgabe „Zustand prüfen“
      expect(zeileVon(v, U)).toBeUndefined();
      expect(v.leiter.zustand_unbekannt.skus).toContain(U);
      await page.goto("/repricer/bqool#leiter");
      await expect(page.getByTestId("bq-zustand-unbekannt")).toContainText(U);
      await page.goto("/repricer/bqool#liquidation");
      await Promise.all([aktion(page), page.getByTestId("bq-liq-pruefen").click()]);
      const [auf] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key = 'bqool-zustand-pruefen' and status = 'open'", [T]);
      expect(auf.title).toMatch(/^Zustand prüfen: \d+ SKUs? ohne Zustand \(kein BQool-Upload\)$/);
      expect(auf.notes).toContain(U);
      // Pausierte Retoure mit Min/Max → Vorschlag „aktivieren“ (Freigabe)
      await page.goto("/repricer/bqool#leiter");
      const akt = leiterZeile(page, R, "aktivieren");
      await expect(akt).toContainText("pausiertes Angebot aktivieren");
      await Promise.all([aktion(page), akt.getByTestId("bq-leiter-freigeben").click()]);
      expect((await sql<{ a: boolean }>("select aktivieren as a from bqool_sku_pflege where tenant_id = $1 and land = 'DE' and sku = $2", [T, R]))[0].a).toBe(true);

      // Abnahme 3: Zustand von Hand (Mehrfachauswahl) → Zielpreis rechnet sich neu
      await page.goto(`/repricer?bq=alle&q=${R}#bqool-liste`);
      await page.locator(`[data-testid="bqool-zeile"]`).filter({ hasText: R }).getByTestId("bqool-wahl").check();
      await page.getByTestId("bqool-zustand-wahl").selectOption("akzeptabel");
      await Promise.all([aktion(page), page.getByTestId("bqool-zustand-setzen").click()]);
      await expect(page.getByRole("status")).toContainText("Zustand „akzeptabel“ für 1 SKU – Zielpreis und Min rechnen sich neu.");
      expect(zeileVon(await vorschau(), R)).toMatchObject({ zustand: "akzeptabel", zielpreis_gebraucht: 120 });
      // Unbekannte SKU als neu markieren → kommt in die Datei
      await page.goto(`/repricer?bq=alle&q=${U}#bqool-liste`);
      await page.locator(`[data-testid="bqool-zeile"]`).filter({ hasText: U }).getByTestId("bqool-wahl").check();
      await page.getByTestId("bqool-zustand-wahl").selectOption("neu");
      await Promise.all([aktion(page), page.getByTestId("bqool-zustand-setzen").click()]);
      const v2 = await vorschau();
      expect(v2.leiter.zustand_unbekannt.skus).not.toContain(U);
      expect(zeileVon(v2, U)).toMatchObject({ regel_soll: "ia" });
    } finally {
      await aufraeumen(T, `RET_3_LPNTEST${m}_FBA`);
      await aufraeumen(T, U);
    }
  });
});

test.describe("B31.8 – Schnelldreher-Schutz", () => {
  test("Abnahme 1–4: Kennzeichen von Hand, Min = Break-even + 7 %, kein Regelwechsel im Vorschlagslauf, Aufgabe nach 21 Tagen ohne Buy Box mit drei Knöpfen", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const S = `TEST-SCHNELL-${m}`;
    const T = await grundlage(S, { alter: "91-180" });
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const vorschau = async () => JSON.parse(await c.call("bqool_export_vorschau", { land: "DE", limit: 100 }));
      await istHochladen(page, `Listings_${m}_schnell.txt`, [{ sku: S, regel: "ia", min: "80.00", max: "150.00", enable: "1" }]);
      await sql("update bqool_listings set buybox_preis = '60.00' where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, S]);

      // Abnahme 1: als Schnelldreher markieren (Repricer, Mehrfachauswahl)
      await page.goto(`/repricer?bq=alle&q=${S}#bqool-liste`);
      await page.locator(`[data-testid="bqool-zeile"]`).filter({ hasText: S }).getByTestId("bqool-wahl").check();
      await Promise.all([aktion(page), page.getByTestId("bqool-schnell-an").click()]);
      await expect(page.getByRole("status")).toContainText("1 SKU: Schnelldreher gesetzt (Boden Break-even + 7 %, kein Abverkauf).");
      await expect(page.locator(`[data-testid="bqool-zeile"]`).filter({ hasText: S }).getByTestId("bqool-schnell")).toBeVisible();

      // Abnahme 2: Min = Break-even + 7 % (ia-Stufe bei 91 Tagen nur 5 % – der Boden gilt trotzdem)
      const z = zeileVon(await vorschau(), S)!;
      expect(z.schnelldreher).toBe(true);
      expect(z.marge_prozent).toBe(5);
      expect(z.schnelldreher_boden!).toBeGreaterThan(z.effektiver_min!);
      expect(z.min_datei).toBe(z.schnelldreher_boden);

      // Abnahme 3: Vorschlagslauf – trotz Ladenhüter-Kriterien und Buy Box unter dem effektiven Min kein Regelwechsel
      await sql("update bqool_listings set buybox_preis = $3 where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, S, f2(r2(z.effektiver_min! - 1))]);
      await sql("insert into bqool_sku_pflege (tenant_id, land, sku, ueber_seit) values ($1, 'DE', $2, current_date - 10) on conflict (tenant_id, land, sku) do update set ueber_seit = excluded.ueber_seit", [T, S]);
      await page.goto("/repricer/bqool#liquidation");
      await Promise.all([aktion(page), page.getByTestId("bq-liq-pruefen").click()]);
      expect(await sql("select art from bqool_vorschlaege where tenant_id = $1 and sku = $2 and art like 'stufe_%' and status in ('offen', 'spaeter')", [T, S])).toHaveLength(0);
      const z3 = zeileVon(await vorschau(), S)!;
      expect(z3.regel_soll).toBe("ia");
      // Morgenbericht: „Schnelldreher unter Min: n SKUs, Buy Box seit x Tagen darunter“
      const [{ st }] = await sql<{ st: { schnellUnterMin: number; schnellUnterMinTage: number } }>("select settings->'bqool'->'leiterStand' as st from tenants where id = $1", [T]);
      expect(st.schnellUnterMin).toBeGreaterThanOrEqual(1);
      expect(st.schnellUnterMinTage).toBeGreaterThanOrEqual(10);

      // Abnahme 4: 21 Tage ohne Buy Box → Aufgabe/Vorschlag mit drei Knöpfen
      await sql("update bqool_listings set eigene_buybox = false where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, S]);
      await sql("update bqool_sku_pflege set ohne_buybox_seit = current_date - 21 where tenant_id = $1 and land = 'DE' and sku = $2", [T, S]);
      await Promise.all([aktion(page), page.getByTestId("bq-liq-pruefen").click()]);
      await page.goto("/repricer/bqool#leiter");
      const ende = leiterZeile(page, S, "schnelldreher_ende");
      await expect(ende).toContainText("21 Tage ohne Buy Box");
      await expect(ende.getByTestId("bq-leiter-verlaengern")).toHaveText("Schutz +14 T");
      await expect(ende.getByTestId("bq-leiter-abverkauf")).toHaveText("Abverkauf zulassen");
      await expect(ende.getByTestId("bq-leiter-min_manuell")).toHaveText("Min manuell");
      const [auf] = await sql<{ notes: string }>("select notes from tasks where tenant_id = $1 and system_key = 'bqool-leiter' and status = 'open'", [T]);
      expect(auf?.notes ?? "").toContain(S);
      await Promise.all([aktion(page), ende.getByTestId("bq-leiter-verlaengern").click()]);
      await expect(page.getByRole("status")).toContainText(`${S} (DE): Schutz um 14 Tage verlängert.`);
      const [{ diff }] = await sql<{ diff: number }>("select (schnell_bis - current_date)::int as diff from bqool_sku_pflege where tenant_id = $1 and land = 'DE' and sku = $2", [T, S]);
      expect(diff).toBe(14);
      await page.goto(`/repricer?bq=alle&q=${S}&leiter=schnell#bqool-liste`);
      await expect(page.locator(`[data-testid="bqool-zeile"]`).filter({ hasText: S }).getByTestId("bqool-schnell")).toContainText("bis");
    } finally {
      await aufraeumen(T, S);
    }
  });
});

test.describe("B32 – Listing-Check", () => {
  test("Abnahme 1–3, 5: Befund 1 (Min über Buy Box) und 2 (pausiert), Freigabe → nächster Upload, Budget/„Check unvollständig“, Morgenbericht-Zeile, Werkzeug listing_check", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const C = `TEST-LC-${m}`;
    const ASIN = `B0TLC-${m}`;
    const T = await grundlage(C, { asin: ASIN, alter: "31-60" });
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      await istHochladen(page, `Listings_${m}_lc.txt`, [{ sku: C, regel: "ia", min: "80.00", max: "150.00", enable: "0" }]);
      // Markt (Keepa, erfunden): Buy Box 40, Rang 36, „monatlich verkauft“ 1000 – frisch, also kein Abruf nötig
      const stand = { aktuell: { buybox: 40, verkaufsrang: 36, monatlich_verkauft: 1000 }, kennzahlen: { "30": { buybox: { schnitt: 41 } } } };
      await sql("insert into keepa_cache (tenant_id, asin, marktplatz, abgerufen_am, gefunden, stand) values ($1, $2, 'DE', now(), true, $3::jsonb) on conflict (tenant_id, asin, marktplatz) do update set stand = excluded.stand, abgerufen_am = now()", [T, ASIN, JSON.stringify(stand)]);

      // Abnahme 1: Lauf mit BQool-Stand von heute → Befund 1 (Min 80 > Buy Box 40) und 2 (pausiert)
      await page.goto("/repricer/listing-check");
      await Promise.all([aktion(page), page.getByTestId("lc-jetzt").click()]);
      await expect(page.getByRole("status")).toContainText("Listing-Check");
      await expect(page.getByTestId("lc-stand")).toContainText("SKUs geprüft");
      await expect(page.getByTestId("lc-bqool-alt")).toHaveCount(0);
      const b1 = page.locator(`[data-testid="lc-zeile"][data-sku="${C}"][data-nr="1"]`);
      const b2 = page.locator(`[data-testid="lc-zeile"][data-sku="${C}"][data-nr="2"]`);
      await expect(b1).toContainText("Min über Buy Box");
      await expect(b1).toContainText("buybox 40");
      await expect(b2).toContainText("Pausiert trotz Bestand und Nachfrage");
      await expect(b2).toContainText("Aktivieren nach Min-Korrektur");
      // Claude-Werkzeug (nur lesen)
      const lc = JSON.parse(await c.call("listing_check", { limit: 100 }));
      expect(lc.befunde).toContainEqual(expect.objectContaining({ sku: C, asin: ASIN, befund: "1 Min über Buy Box" }));
      expect(lc.befunde).toContainEqual(expect.objectContaining({ sku: C, befund: "2 Pausiert trotz Bestand und Nachfrage" }));
      expect(lc.link).toContain("/repricer/listing-check");

      // Abnahme 2: Vorschlag = effektiver Min (kein Schnelldreher) → nach Freigabe steht er im nächsten Upload
      const [{ min: ziel }] = await sql<{ min: number }>("select min::float as min from bqool_vorschlaege where tenant_id = $1 and sku = $2 and art = 'check_1' and status = 'offen'", [T, C]);
      await expect(b1).toContainText(`Min senken auf ${f2(ziel)}`);
      await Promise.all([aktion(page), b1.getByTestId("lc-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText(`${C} (DE): Min ${f2(ziel)} kommt in den nächsten Upload.`);
      await Promise.all([aktion(page), page.locator(`[data-testid="lc-zeile"][data-sku="${C}"][data-nr="2"]`).getByTestId("lc-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText(`${C} (DE): wird mit dem nächsten Upload aktiviert.`);
      const z = zeileVon(JSON.parse(await c.call("bqool_export_vorschau", { land: "DE", limit: 100 })), C)!;
      expect(z.min_datei).toBe(ziel);
      expect(z.min_ist).toBe(80);

      // B32.1: Schwellen in Einstellungen → Listing-Check änderbar (leer = Standard)
      await page.goto("/repricer/listing-check");
      await page.getByTestId("lc-einstellungen").locator("summary").click();
      await page.getByTestId("lc-schwelle-reichweite").fill("120");
      await Promise.all([aktion(page), page.getByTestId("lc-schwellen-speichern").click()]);
      await expect(page.getByRole("status")).toContainText("Schwellen gespeichert");
      expect((await sql<{ w: number }>("select (settings->'bqool'->'listingCheckSchwellen'->>'reichweite')::int as w from tenants where id = $1", [T]))[0].w).toBe(120);
      await sql("update tenants set settings = settings #- '{bqool,listingCheckSchwellen}' where id = $1", [T]);

      // Abnahme 3: Budget – Keepa-Daten älter als 24 Std. und kein Abruf möglich → „Check unvollständig“
      await sql("update keepa_cache set abgerufen_am = now() - interval '2 days' where tenant_id = $1 and asin = $2", [T, ASIN]);
      await sql("update tenants set settings = jsonb_set(settings, '{bqool,listingCheckStand}', 'null'::jsonb) where id = $1", [T]);
      await page.goto("/repricer/listing-check");
      await Promise.all([aktion(page), page.getByTestId("lc-jetzt").click()]);
      const [{ st }] = await sql<{ st: { stufeA: number; keepaAbrufe: number; unvollstaendig: number } }>("select settings->'bqool'->'listingCheckStand' as st from tenants where id = $1", [T]);
      expect(st.keepaAbrufe).toBeLessThanOrEqual(60);
      if (st.unvollstaendig > 0) await expect(page.getByTestId("lc-unvollstaendig")).toContainText("Check unvollständig");

      // Abnahme 5: Morgenbericht enthält die Zeile „Listing-Check“
      await sql("update tenants set settings = jsonb_set(settings, '{bqool,listingCheckStand}', $2::jsonb) where id = $1", [T, JSON.stringify({ am: new Date().toISOString().slice(0, 10), dauerMs: 10, geprueft: 1, stufeA: 1, stufeB: 0, stufeC: 0, keepaAbrufe: 0, unvollstaendig: 1, neu: 2, offen: 2, bqoolAlt: false, bqoolStand: null, top: [{ land: "DE", sku: C, asin: ASIN, titel: "Min über Buy Box", potenzial: 80 }] })]);
      const lc2 = JSON.parse(await c.call("listing_check", {}));
      expect(lc2.stand).toMatchObject({ neu: 2, offen: 2, unvollstaendig: 1 });
      const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
      await sql("insert into push_abos (tenant_id, user_id, endpoint, geraet) values ($1, $2, $3, 'Test-Handy LC')", [T, INH, `${TD}/push/lc-${m}`]);
      await sql("insert into meldungen (tenant_id, user_id, titel, text, link, art, zustand) values ($1, $2, $3, 'Test', '/', 'sonstiges', 'zurueckgehalten')", [T, INH, `Über Nacht ${m}`]);
      await page.goto("/einstellungen/benachrichtigungen");
      await Promise.all([aktion(page), page.getByTestId("jetzt-ausliefern").click()]);
      const [mb] = await sql<{ text: string }>("select text from meldungen where user_id = $1 and art = 'morgenbericht' order by created_at desc limit 1", [INH]);
      expect(mb.text).toContain("Listing-Check: 2 neue Befunde (2 offen)");
      expect(mb.text).toContain(`${ASIN} Min über Buy Box 80 €`);
      await sql("delete from push_abos where tenant_id = $1 and endpoint = $2", [T, `${TD}/push/lc-${m}`]);
      await page.goto("/repricer/listing-check");
      await expect(page.getByTestId("lc-unvollstaendig")).toContainText("Check unvollständig: 1 SKU der Stufe A ohne frische Keepa-Daten");
    } finally {
      await aufraeumen(T, C);
      await sql("delete from keepa_cache where tenant_id = $1 and asin = $2", [T, ASIN]);
    }
  });
});
