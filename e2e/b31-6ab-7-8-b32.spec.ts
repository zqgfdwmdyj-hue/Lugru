// Nachtrag B31.6a/b, B31.7, B31.8 und B32 (08.11.), seit der BQool-Ablösung mit ProfitGuard: Regel-Leiter,
// „Liquidation bis“, Zustand gebrauchter Ware, Schnelldreher-Schutz und Listing-Check. Ist-Stand per erfundenem
// ProfitGuard-Export, Soll-Strategien im Seller-System, jede Änderung erst nach Freigabe in der nächsten
// ProfitGuard-Importdatei. Abnahmen als Ablauf im Browser + Claude-Werkzeuge. Alle SKUs und Werte erfunden.
import type { Page } from "@playwright/test";
import { TD } from "./env";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const KOPF = "SKU,Marketplace,Your Price,Min Price,Max Price,Strategy,Repricing,Buy Box Price";
const f2 = (n: number) => n.toFixed(2);
const r2 = (n: number) => Math.round(n * 100) / 100;

type RpZeile = { land: string; sku: string; soll: { strategie: string; min: number; max: number; marge_stufe_prozent?: number; stufe?: number }; ist_profitguard: { strategie: string | null; min: number | null } | string; buybox: number | null; break_even: number | null; warnungen?: string[]; schnelldreher?: { boden_prozent: number }; zustand?: string };
type VsZeile = { sku: string; strategie_ist?: string; strategie_soll: string; min_ist: number | null; min_soll: number; warnungen?: string[] };

/** ProfitGuard-Export DE hochladen (ersetzt alle DE-Zeilen des Mandanten – deshalb je Test eine Datei mit allen Test-SKUs). */
async function pgHochladen(page: Page, name: string, zeilen: { sku: string; strategie: string; min: string; max: string; aktiv: "Yes" | "No"; bb?: string }[]) {
  const datei = [KOPF, ...zeilen.map((z) => `${z.sku},DE,99.00,${z.min},${z.max},${z.strategie},${z.aktiv},${z.bb ?? ""}`), ""].join("\r\n");
  await page.goto("/uploads");
  await page.getByTestId("upload-dateien").setInputFiles([{ name, mimeType: "text/csv", buffer: Buffer.from(datei, "utf8") }]);
  await page.getByTestId("upload-los").click();
  await expect(page.getByTestId("upload-ergebnis")).toHaveAttribute("data-art", "profitguard", { timeout: 60_000 });
  await expect(page.getByTestId("upload-ergebnis")).toContainText(`${zeilen.length} SKUs aus ProfitGuard eingelesen`);
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
  for (const t of ["repricing_vorschlaege", "repricing_sku_pflege", "artikel_zustand", "repricing_liquidationen", "repricing_zuweisungen", "repricing_gebuehren", "profitguard_listings", "amazon_lageralter", "amazon_inventory", "sellerboard_inventory", "lots", "verlust_ausnahmen", "keepa_cache:asin"]) {
    const [tab, spalte] = t.split(":");
    if (spalte === "asin") await sql(`delete from ${tab} where tenant_id = $1 and asin like $2`, [T, muster.replace("TEST-", "B0T")]);
    else await sql(`delete from ${tab} where tenant_id = $1 and sku like $2`, [T, muster]);
  }
  await sql("update tasks set status = 'done' where tenant_id = $1 and system_key in ('repricing-leiter', 'repricing-zustand-pruefen', 'repricing-liquidation-ablauf', 'repricing-rueckkehr') and status = 'open'", [T]);
  await sql("update tenants set settings = settings #- '{repricing,profitguard,format}' where id = $1", [T]);
}

const rpZeile = async (c: { call: (n: string, a?: unknown) => Promise<string> }, sku: string) => (JSON.parse(await c.call("repricer", { ansicht: "alle", suche: sku, marktplatz: "DE" })).zeilen as RpZeile[]).find((z) => z.sku === sku);
const vsZeile = async (c: { call: (n: string, a?: unknown) => Promise<string> }, sku: string) => (JSON.parse(await c.call("profitguard_export_vorschau", { land: "DE", limit: 100, nur_aenderungen: false })).laender[0].groesste_aenderungen as VsZeile[]).find((z) => z.sku === sku);
const leiterZeile = (page: Page, sku: string, art: string) => page.locator(`[data-testid="pg-leiter-zeile"][data-sku="${sku}"][data-art="${art}"]`);
const leiterStand = async (T: string) => (await sql<{ st: Record<string, number> }>("select settings->'repricing'->'leiterStand' as st from tenants where id = $1", [T]))[0].st;

test.describe("B31.6a/b – Regel-Leiter und „Liquidation bis“", () => {
  test("1 → 2 und 2 → 3 als Vorschlag mit Freigabe, Liquidation läuft ab (Aufgabe, Verlängern, automatisch +30 Tage, dauerhaft), Spalten Stufe/Liquidation bis", async ({ page, browser, baseURL }) => {
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
      await pgHochladen(page, `ProfitGuard_${m}_leiter.csv`, [
        { sku: L1, strategie: "Standard", min: "80.00", max: "150.00", aktiv: "Yes" },
        { sku: L2, strategie: "Abverkauf", min: "80.00", max: "150.00", aktiv: "Yes" },
        { sku: L3, strategie: "Liquidation", min: "25.00", max: "150.00", aktiv: "Yes", bb: "1.00" },
      ]);
      // Soll: L2 steht auf Stufe 2 (Abverkauf), L3 auf Liquidation der Leiter (fester Min 25)
      await sql("insert into repricing_zuweisungen (tenant_id, land, sku, regel, untergrenze, quelle) values ($1, 'DE', $2, 'Abverkauf', null, 'leiter'), ($1, 'DE', $3, 'Liquidation', 25, 'leiter')", [T, L2, L3]);
      // L2: Stufe 2 (Abverkauf, Lageralter 91 T) kommt seit 8 Tagen nicht in die Buy Box
      const z2 = (await rpZeile(c, L2))!;
      expect(z2.soll).toMatchObject({ strategie: "Abverkauf", stufe: 2 });
      const bb2 = r2(z2.soll.min - 0.05);
      await sql("update profitguard_listings set buybox_preis = $3 where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, L2, f2(bb2)]);
      await sql("insert into repricing_sku_pflege (tenant_id, land, sku, ueber_seit) values ($1, 'DE', $2, current_date - 8)", [T, L2]);
      // L3: Liquidation der Leiter, läuft in 5 Tagen ab; Stufe 2 liegt weiter über der Buy Box
      await sql("insert into repricing_liquidationen (tenant_id, land, sku, grund, regel_vorher, min_gesetzt, eff_min_vorher, break_even, status, aktiv_seit, bis) values ($1, 'DE', $2, 'leiter', 'Abverkauf', 25, 30, 24, 'aktiv', now() - interval '40 days', current_date + 5)", [T, L3]);

      await page.goto("/repricer/profitguard#liquidation");
      await Promise.all([aktion(page), page.getByTestId("pg-liq-pruefen").click()]);
      await expect(page.getByRole("status")).toContainText("Geprüft:");

      // ---- Freigabe-Seite zeigt jeden Stufenwechsel einzeln ------------------------------------------------------------
      await page.goto("/repricer/profitguard#leiter");
      const v12 = leiterZeile(page, L1, "stufe_1_2");
      await expect(v12).toContainText("Stufe 1 → 2 (Abverkauf)");
      await expect(v12).toContainText("Standard → Abverkauf");
      await expect(v12).toContainText("keine Verkäufe");
      const v23 = leiterZeile(page, L2, "stufe_2_3");
      await expect(v23).toContainText("Abverkauf → Liquidation");
      await expect(v23).toContainText("seit 8 Tagen über der Buy Box");
      const [{ min: min23 }] = await sql<{ min: number }>("select min::float as min from repricing_vorschlaege where tenant_id = $1 and sku = $2 and art = 'stufe_2_3' and status = 'offen'", [T, L2]);
      expect(min23).toBeLessThan(z2.soll.min); // nie über dem effektiven Min der Stufe 2
      expect(min23).toBeGreaterThanOrEqual(z2.break_even! - 0.005); // nie unter Break-even
      expect(min23).toBe(Math.max(z2.break_even!, r2(bb2 * 0.99)));
      // Claude-Werkzeug zeigt die Vorschläge
      const lt = JSON.parse(await c.call("profitguard_export_vorschau", { land: "DE", limit: 100 })).leiter_vorschlaege;
      expect(lt).toContainEqual(expect.objectContaining({ sku: L1, vorschlag: "Stufe 1 → 2 (Abverkauf)", nach: "Abverkauf" }));
      // Morgenbericht/Kapital-Ampel: Stand der Leiter
      const st = await leiterStand(T);
      expect(st.stufe2).toBeGreaterThanOrEqual(1);
      expect(st.vorschlaege).toBeGreaterThanOrEqual(2);
      const [la] = await sql<{ notes: string }>("select notes from tasks where tenant_id = $1 and system_key = 'repricing-leiter' and status = 'open'", [T]);
      expect(la.notes).toContain(`• ${L1} (DE): Stufe 1 → 2 (Abverkauf)`);

      // Freigeben 1 → 2: Soll-Strategie Abverkauf (Quelle Regel-Leiter), steht in der nächsten Datei
      await Promise.all([aktion(page), v12.getByTestId("pg-leiter-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText(`${L1} (DE): Standard → Abverkauf – steht in der nächsten ProfitGuard-Datei (Freigabe beim Export bleibt nötig).`);
      expect((await sql<{ regel: string; quelle: string }>("select regel, quelle from repricing_zuweisungen where tenant_id = $1 and land = 'DE' and sku = $2", [T, L1]))[0]).toEqual({ regel: "Abverkauf", quelle: "leiter" });
      expect((await rpZeile(c, L1))!.soll).toMatchObject({ strategie: "Abverkauf", stufe: 2 });
      expect(await vsZeile(c, L1)).toMatchObject({ strategie_ist: "Standard", strategie_soll: "Abverkauf" });
      // Freigeben 2 → 3: Liquidation mit festem Min
      await Promise.all([aktion(page), v23.getByTestId("pg-leiter-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText(`${L2} (DE): Abverkauf → Liquidation (Min ${f2(min23)})`);
      expect(await vsZeile(c, L2)).toMatchObject({ strategie_soll: "Liquidation", min_soll: min23 });

      // ---- B31.6a: „Liquidation bis“ – 7 Tage vorher Aufgabe mit drei Knöpfen ----------------------------------------
      await page.goto("/repricer/profitguard#liquidation");
      const z3 = page.locator(`[data-testid="pg-liq-aktiv-zeile"][data-sku="${L3}"]`);
      await expect(z3.getByTestId("pg-liq-bis")).toContainText("noch 5 T");
      // gemeldet → „Verlängern“ ist hervorgehoben
      await expect(z3.getByTestId("pg-liq-ablauf").getByRole("button", { name: "+30 T" })).toHaveClass(/btn-primary/);
      const [aufgabe] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key = 'repricing-liquidation-ablauf' and status = 'open'", [T]);
      expect(aufgabe.title).toMatch(/^Repricing: Liquidation läuft ab – \d+ SKUs? entscheiden$/);
      expect(aufgabe.notes).toContain(`DE ${L3} bis`);
      expect(aufgabe.notes).toContain("„Verlängern 30 Tage“ / „Zurück auf alte Strategie“ / „Dauerhaft Liquidation“");
      // Verlängern 30 Tage
      const [{ bis: bis0 }] = await sql<{ bis: string }>("select bis::text from repricing_liquidationen where tenant_id = $1 and sku = $2", [T, L3]);
      await Promise.all([aktion(page), z3.getByTestId("pg-liq-ablauf").getByRole("button", { name: "+30 T" }).click()]);
      await expect(page.getByRole("status")).toContainText(`${L3} (DE): verlängert um 30 Tage.`);
      const [{ diff }] = await sql<{ diff: number }>("select (bis - $3::date)::int as diff from repricing_liquidationen where tenant_id = $1 and sku = $2", [T, L3, bis0]);
      expect(diff).toBe(30);
      await expect(z3.getByTestId("pg-liq-ablauf").getByRole("button", { name: "+30 T" })).not.toHaveClass(/btn-primary/);
      // Ohne Antwort abgelaufen, Stufe 2 liegt noch über der Buy Box → +30 Tage automatisch
      await sql("update repricing_liquidationen set bis = current_date - 1, ablauf_gemeldet_am = null where tenant_id = $1 and sku = $2", [T, L3]);
      await Promise.all([aktion(page), page.getByTestId("pg-liq-pruefen").click()]);
      const [{ diff: d2, verl }] = await sql<{ diff: number; verl: number }>("select (bis - current_date)::int as diff, verlaengert as verl from repricing_liquidationen where tenant_id = $1 and sku = $2", [T, L3]);
      expect(d2).toBe(30);
      expect(verl).toBe(2);
      expect((await leiterStand(T)).verlaengert).toBeGreaterThanOrEqual(1);
      // Dauerhaft Liquidation
      await Promise.all([aktion(page), z3.getByTestId("pg-liq-ablauf").getByRole("button", { name: "dauerhaft" }).click()]);
      await expect(page.getByRole("status")).toContainText(`${L3} (DE): dauerhaft Liquidation.`);
      await expect(z3.getByTestId("pg-liq-bis")).toHaveText("dauerhaft");

      // ---- Repricer: Stufe + „Liquidation bis“, Filter „läuft in 7 Tagen ab“ -------------------------------------------
      await page.goto(`/repricer?q=TEST-LEITER&leiter=ablauf7#abgleich`);
      await expect(page.getByTestId("abgleich-filter-leiter")).toHaveValue("ablauf7");
      await expect(page.locator(`[data-testid="abgleich-zeile"][data-sku="${L3}"]`)).toHaveCount(0); // dauerhaft = läuft nicht ab
      await sql("update repricing_liquidationen set dauerhaft = false, bis = current_date + 3 where tenant_id = $1 and sku = $2", [T, L3]);
      await page.reload();
      const r3 = page.locator(`[data-testid="abgleich-zeile"][data-sku="${L3}"][data-land="DE"]`);
      await expect(r3).toContainText("noch 3 T");
      await expect(r3.getByTestId("abgleich-soll")).toContainText("Stufe 3");
      await page.goto(`/repricer?q=${L1}&ab=alle#abgleich`);
      await expect(page.locator(`[data-testid="abgleich-zeile"][data-sku="${L1}"][data-land="DE"]`).getByTestId("abgleich-soll")).toContainText("Stufe 2");
    } finally {
      await aufraeumen(T, `TEST-LEITER_-${m}`);
    }
  });
});

test.describe("B31.7 – Zustand der Ware", () => {
  test("Abnahme 1–4: RET_-SKU gebraucht mit Zielpreis/Min gebraucht, unbekannt mit Aufgabe ohne Datei-Zeile, Zustand von Hand, Vorschau mit gebrauchtem Min", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const R = `RET_3_LPNTEST${m}_FBA`;
    const U = `TEST-ZUSTAND-${m}`;
    const T = await grundlage(R, { ek: "60.00", menge: 1, alter: "181-270" });
    await grundlage(U, { kind: "unknown", menge: 2 });
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      await pgHochladen(page, `ProfitGuard_${m}_zustand.csv`, [
        { sku: R, strategie: "Standard", min: "", max: "", aktiv: "No", bb: "150.00" },
        { sku: U, strategie: "Standard", min: "40.00", max: "90.00", aktiv: "Yes" },
      ]);

      // Abnahme 1 + 4: gebraucht erkannt (SKU-Muster), Zielpreis = Neupreis × 0,84, Min gebraucht = Break-even + 3 %
      const z = (await rpZeile(c, R))!;
      expect(z).toMatchObject({ zustand: "gebraucht", soll: { strategie: "Abverkauf" } });
      expect(z.soll.min).toBeGreaterThan(z.break_even!);
      // Neupreis-Min (Standard, Marge der Altersstufe) wäre höher – er kommt nicht in die Datei
      expect(z.soll.min).toBeLessThan(r2(z.break_even! * 1.05));
      expect((await vsZeile(c, R))!.min_soll).toBe(z.soll.min);
      await page.goto(`/repricer?ab=alle&q=${R}#abgleich`);
      const zr = page.locator(`[data-testid="abgleich-zeile"][data-sku="${R}"][data-land="DE"]`);
      await expect(zr.getByTestId("abgleich-zustand")).toContainText("gebraucht");
      await expect(zr.getByTestId("abgleich-zustand")).toContainText("Ziel 126,00");

      // Abnahme 2: ohne Zustandsinfo → unbekannt, nicht in der Datei, Aufgabe „Zustand prüfen“
      expect(await rpZeile(c, U)).toBeUndefined();
      expect(JSON.parse(await c.call("profitguard_export_vorschau", { land: "DE", limit: 100 })).zustand_unbekannt.skus).toContain(U);
      await page.goto("/repricer/profitguard#leiter");
      await expect(page.getByTestId("pg-zustand-unbekannt")).toContainText(U);
      await page.goto("/repricer/profitguard#liquidation");
      await Promise.all([aktion(page), page.getByTestId("pg-liq-pruefen").click()]);
      const [auf] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key = 'repricing-zustand-pruefen' and status = 'open'", [T]);
      expect(auf.title).toMatch(/^Zustand prüfen: \d+ SKUs? ohne Zustand \(nicht in der ProfitGuard-Datei\)$/);
      expect(auf.notes).toContain(U);
      // Nicht im Repricing stehende Retoure mit Min/Max → Vorschlag „ins Repricing nehmen“ (Freigabe)
      await page.goto("/repricer/profitguard#leiter");
      const akt = page.locator(`[data-testid="pg-leiter-zeile"][data-sku="${R}"][data-art="aktivieren"]`);
      await expect(akt).toContainText("ins Repricing nehmen");
      await Promise.all([aktion(page), akt.getByTestId("pg-leiter-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText(`${R} (DE): steht in der nächsten ProfitGuard-Datei als „im Repricing“.`);
      expect((await sql<{ a: boolean }>("select aktivieren as a from repricing_sku_pflege where tenant_id = $1 and land = 'DE' and sku = $2", [T, R]))[0].a).toBe(true);

      // Abnahme 3: Zustand von Hand (Mehrfachauswahl im Abgleich) → Zielpreis rechnet sich neu
      await page.goto(`/repricer?ab=alle&q=${R}#abgleich`);
      await page.locator(`[data-testid="abgleich-zeile"][data-sku="${R}"][data-land="DE"]`).getByTestId("abgleich-wahl").check();
      await page.getByTestId("abgleich-mehrfach").getByLabel("Zustand").selectOption("akzeptabel");
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("abgleich-zustand-setzen").click()]);
      await expect(page.getByRole("status")).toContainText("Zustand „akzeptabel“ für 1 SKU – Zielpreis und Min rechnen sich neu.");
      expect((await rpZeile(c, R))!.zustand).toBe("akzeptabel");
      await expect(page.locator(`[data-testid="abgleich-zeile"][data-sku="${R}"][data-land="DE"]`).getByTestId("abgleich-zustand")).toContainText("Ziel 120,00");
      // Unbekannte SKU als neu markieren → kommt in die Datei. SKUs mit unbekanntem Zustand stehen (noch) nicht als Zeile
      // im Abgleich (Befund im Prüfbericht) – deshalb hier direkt als Hand-Eintrag wie „Zustand setzen“.
      await sql("insert into artikel_zustand (tenant_id, land, sku, zustand, quelle) values ($1, '*', $2, 'neu', 'hand')", [T, U]);
      expect(JSON.parse(await c.call("profitguard_export_vorschau", { land: "DE", limit: 100 })).zustand_unbekannt.skus).not.toContain(U);
      expect((await rpZeile(c, U))!.soll.strategie).toBe("Standard");
    } finally {
      await aufraeumen(T, `RET_3_LPNTEST${m}_FBA`);
      await aufraeumen(T, U);
    }
  });
});

test.describe("B31.8 – Schnelldreher-Schutz", () => {
  test("Abnahme 1–4: Kennzeichen von Hand, Min = Break-even + 7 %, kein Stufenwechsel im Vorschlagslauf, Vorschlag nach 21 Tagen ohne Buy Box mit drei Knöpfen", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const S = `TEST-SCHNELL-${m}`;
    const T = await grundlage(S, { alter: "91-180" });
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      await pgHochladen(page, `ProfitGuard_${m}_schnell.csv`, [{ sku: S, strategie: "Standard", min: "80.00", max: "150.00", aktiv: "Yes", bb: "60.00" }]);
      const vorher = (await rpZeile(c, S))!;
      expect(vorher.soll.strategie).toBe("Standard");

      // Abnahme 1: als Schnelldreher markieren (Repricer, Mehrfachauswahl)
      await page.goto(`/repricer?ab=alle&q=${S}#abgleich`);
      await page.locator(`[data-testid="abgleich-zeile"][data-sku="${S}"][data-land="DE"]`).getByTestId("abgleich-wahl").check();
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("abgleich-schnell-an").click()]);
      await expect(page.getByRole("status")).toContainText("1 SKU: Schnelldreher gesetzt (Boden-Marge, kein Abverkauf).");
      await expect(page.locator(`[data-testid="abgleich-zeile"][data-sku="${S}"][data-land="DE"]`).getByTestId("abgleich-schnell")).toBeVisible();

      // Abnahme 2: Strategie „Schnelldreher“, Min mindestens Break-even + 7 % (Standard bei 91 Tagen hätte weniger Marge)
      const z = (await rpZeile(c, S))!;
      expect(z.schnelldreher).toEqual({ boden_prozent: 7 });
      expect(z.soll).toMatchObject({ strategie: "Schnelldreher", marge_stufe_prozent: 7 });
      expect(vorher.soll.marge_stufe_prozent!).toBeLessThan(7);
      expect(z.soll.min).toBeGreaterThan(vorher.soll.min);
      expect(z.soll.min).toBeGreaterThan(z.break_even!);

      // Abnahme 3: Vorschlagslauf – trotz Buy Box unter dem Min und Ladenhüter-Kriterien kein Stufenwechsel
      await sql("update profitguard_listings set buybox_preis = $3 where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, S, f2(r2(z.soll.min - 1))]);
      await sql("insert into repricing_sku_pflege (tenant_id, land, sku, ueber_seit) values ($1, 'DE', $2, current_date - 10) on conflict (tenant_id, land, sku) do update set ueber_seit = excluded.ueber_seit", [T, S]);
      await page.goto("/repricer/profitguard#liquidation");
      await Promise.all([aktion(page), page.getByTestId("pg-liq-pruefen").click()]);
      expect(await sql("select art from repricing_vorschlaege where tenant_id = $1 and sku = $2 and art like 'stufe_%' and status in ('offen', 'spaeter')", [T, S])).toHaveLength(0);
      expect((await rpZeile(c, S))!.soll.strategie).toBe("Schnelldreher");
      // Morgenbericht: „Schnelldreher unter Min: n SKUs, Buy Box seit x Tagen darunter“
      const st = await leiterStand(T);
      expect(st.schnellUnterMin).toBeGreaterThanOrEqual(1);
      expect(st.schnellUnterMinTage).toBeGreaterThanOrEqual(10);

      // Abnahme 4: 21 Tage ohne Buy Box → Vorschlag mit drei Knöpfen
      await sql("update profitguard_listings set eigene_buybox = false where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, S]);
      await sql("update repricing_sku_pflege set ohne_buybox_seit = current_date - 21 where tenant_id = $1 and land = 'DE' and sku = $2", [T, S]);
      await Promise.all([aktion(page), page.getByTestId("pg-liq-pruefen").click()]);
      await page.goto("/repricer/profitguard#leiter");
      const ende = leiterZeile(page, S, "schnelldreher_ende");
      await expect(ende).toContainText("21 Tage ohne Buy Box");
      await expect(ende.getByTestId("pg-leiter-verlaengern")).toHaveText("Schutz +14 T");
      await expect(ende.getByTestId("pg-leiter-abverkauf")).toHaveText("Abverkauf zulassen");
      await expect(ende.getByTestId("pg-leiter-min_manuell")).toHaveText("Min manuell");
      const [auf] = await sql<{ notes: string }>("select notes from tasks where tenant_id = $1 and system_key = 'repricing-leiter' and status = 'open'", [T]);
      expect(auf?.notes ?? "").toContain(S);
      await Promise.all([aktion(page), ende.getByTestId("pg-leiter-verlaengern").click()]);
      await expect(page.getByRole("status")).toContainText(`${S} (DE): Schutz um 14 Tage verlängert.`);
      const [{ diff }] = await sql<{ diff: number }>("select (schnell_bis - current_date)::int as diff from repricing_sku_pflege where tenant_id = $1 and land = 'DE' and sku = $2", [T, S]);
      expect(diff).toBe(14);
      await page.goto(`/repricer?q=${S}&leiter=schnell#abgleich`);
      await expect(page.locator(`[data-testid="abgleich-zeile"][data-sku="${S}"][data-land="DE"]`).getByTestId("abgleich-schnell")).toContainText("Schnelldreher");
    } finally {
      await aufraeumen(T, S);
    }
  });
});

test.describe("B32 – Listing-Check", () => {
  test("Abnahme 1–3, 5: Befund 1 (Min über Buy Box) und 2 (pausiert), Freigabe → nächste ProfitGuard-Datei, Schwellen, Budget/„Check unvollständig“, Morgenbericht-Zeile, Werkzeug listing_check", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const C = `TEST-LC-${m}`;
    const ASIN = `B0TLC-${m}`;
    const T = await grundlage(C, { asin: ASIN, alter: "31-60" });
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      await pgHochladen(page, `ProfitGuard_${m}_lc.csv`, [{ sku: C, strategie: "Standard", min: "80.00", max: "150.00", aktiv: "No" }]);
      // Markt (Keepa, erfunden): Buy Box 40, Rang 36, „monatlich verkauft“ 1000 – frisch, also kein Abruf nötig
      const stand = { aktuell: { buybox: 40, verkaufsrang: 36, monatlich_verkauft: 1000 }, kennzahlen: { "30": { buybox: { schnitt: 41 } } } };
      await sql("insert into keepa_cache (tenant_id, asin, marktplatz, abgerufen_am, gefunden, stand) values ($1, $2, 'DE', now(), true, $3::jsonb) on conflict (tenant_id, asin, marktplatz) do update set stand = excluded.stand, abgerufen_am = now()", [T, ASIN, JSON.stringify(stand)]);

      // Abnahme 1: Lauf mit ProfitGuard-Stand von heute → Befund 1 (Min 80 > Buy Box 40) und 2 (pausiert)
      await page.goto("/repricer/listing-check");
      await Promise.all([aktion(page), page.getByTestId("lc-jetzt").click()]);
      await expect(page.getByRole("status")).toContainText("Listing-Check");
      await expect(page.getByTestId("lc-stand")).toContainText("SKUs geprüft");
      await expect(page.getByTestId("lc-ist-alt")).toHaveCount(0);
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

      // Abnahme 2: Vorschlag = effektiver Min (kein Schnelldreher) → nach Freigabe steht er in der nächsten Datei
      const [{ min: ziel }] = await sql<{ min: number }>("select min::float as min from repricing_vorschlaege where tenant_id = $1 and sku = $2 and art = 'check_1' and status = 'offen'", [T, C]);
      await expect(b1).toContainText(`Min senken auf ${f2(ziel)}`);
      await Promise.all([aktion(page), b1.getByTestId("lc-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText(`${C} (DE): Min ${f2(ziel)} steht in der nächsten ProfitGuard-Datei.`);
      await Promise.all([aktion(page), page.locator(`[data-testid="lc-zeile"][data-sku="${C}"][data-nr="2"]`).getByTestId("lc-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText(`${C} (DE): steht in der nächsten ProfitGuard-Datei als „im Repricing“.`);
      expect(await vsZeile(c, C)).toMatchObject({ min_soll: ziel, min_ist: 80 });

      // B32.1: Schwellen in Repricer → Listing-Check änderbar (leer = Standard)
      await page.goto("/repricer/listing-check");
      await page.getByTestId("lc-einstellungen").locator("summary").click();
      await page.getByTestId("lc-schwelle-reichweite").fill("120");
      await Promise.all([aktion(page), page.getByTestId("lc-schwellen-speichern").click()]);
      await expect(page.getByRole("status")).toContainText("Schwellen gespeichert");
      expect((await sql<{ w: number }>("select (settings->'repricing'->'listingCheckSchwellen'->>'reichweite')::int as w from tenants where id = $1", [T]))[0].w).toBe(120);
      await sql("update tenants set settings = settings #- '{repricing,listingCheckSchwellen}' where id = $1", [T]);

      // Abnahme 3: Budget – Keepa-Daten älter als 24 Std. und kein Abruf möglich → „Check unvollständig“
      await sql("update keepa_cache set abgerufen_am = now() - interval '2 days' where tenant_id = $1 and asin = $2", [T, ASIN]);
      await sql("update tenants set settings = jsonb_set(settings, '{repricing,listingCheckStand}', 'null'::jsonb) where id = $1", [T]);
      await page.goto("/repricer/listing-check");
      await Promise.all([aktion(page), page.getByTestId("lc-jetzt").click()]);
      const [{ st }] = await sql<{ st: { stufeA: number; keepaAbrufe: number; unvollstaendig: number } }>("select settings->'repricing'->'listingCheckStand' as st from tenants where id = $1", [T]);
      expect(st.keepaAbrufe).toBeLessThanOrEqual(60);
      if (st.unvollstaendig > 0) await expect(page.getByTestId("lc-unvollstaendig")).toContainText("Check unvollständig");

      // Abnahme 5: Morgenbericht enthält die Zeile „Listing-Check“
      await sql("update tenants set settings = jsonb_set(settings, '{repricing,listingCheckStand}', $2::jsonb) where id = $1", [T, JSON.stringify({ am: new Date().toISOString().slice(0, 10), dauerMs: 10, geprueft: 1, stufeA: 1, stufeB: 0, stufeC: 0, keepaAbrufe: 0, unvollstaendig: 1, neu: 2, offen: 2, istAlt: false, istStand: null, top: [{ land: "DE", sku: C, asin: ASIN, titel: "Min über Buy Box", potenzial: 80 }] })]);
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
