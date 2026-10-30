// Privatbereich: Serien (wöchentlich) mit Ausnahme, „dieser und alle folgenden“ ändern und löschen, Abendritual als
// Abfolge „zweimal Streicheln, danach Massage“ – und dass private Inhalte nirgends sonst auftauchen (Suche,
// Geschäftskalender, Fragefeld, Claude ohne Privat-Freigabe, Konto „nur Familie“). Testdaten: scripts/testdaten.ts.
import type { Page } from "@playwright/test";
import { aktion, alsPerson, anmelden, expect, marke, mcpVerbinden, sql, test, testdienste } from "./helfer";

const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const HEUTE = berlin(new Date());
/** Nächster Montag, mindestens zwei Tage entfernt (damit alles „geplant“ ist). */
const MONTAG = (() => {
  let d = plus(HEUTE, 2);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = plus(d, 1);
  return d;
})();
const GEHEIM = "PRIVATGEHEIM";

const chip = (p: Page, name: string, value: string) => p.locator(`label:has(input[name="${name}"][value="${value}"])`).click();
/** Einträge der Art an einem Tag (Tagesansicht), deren Text `marker` enthält. */
async function amTag(p: Page, day: string, marker: string) {
  await p.goto(`/privat/kalender?ansicht=tag&tag=${day}`);
  return p.locator('[data-testid="pk-item"]', { hasText: marker }).evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? "", label: e.getAttribute("aria-label") ?? "", href: e.getAttribute("href") ?? "" })));
}
async function speichern(p: Page) {
  await Promise.all([aktion(p), p.click('[data-testid="entry-form"] button[type=submit]')]);
  await expect(p.locator('[data-testid="entry-form-result"]')).toBeVisible();
  return (await p.locator('[data-testid="entry-form-result"]').textContent()) ?? "";
}

test.describe("Privat – Kalender, Serien und Schutz", () => {
  test("Serie anlegen, einen Termin einzeln ändern (Ausnahme), ab hier ändern, ab hier löschen @handy", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    const tage = [0, 7, 14, 21].map((n) => plus(MONTAG, n));
    await anmelden(page, "inhaber");
    // Anlegen: Kinderzeit, wöchentlich bis zum vierten Montag
    await page.goto(`/privat/eintragen?art=kinder&tag=${tage[0]}`);
    await chip(page, "person", "a");
    await page.fill("#f-from", "15:00");
    await page.fill("#f-to", "17:00");
    await page.fill("#f-what", `Serie ${m}`);
    await expect(page.locator('[data-testid="repeat"] #f-bis')).toBeHidden(); // „bis“ erst nach Wahl einer Wiederholung
    await chip(page, "wiederholung", "woche");
    await page.fill("#f-bis", tage[3]);
    await Promise.all([page.waitForURL(/\/privat\/kalender/), page.click('[data-testid="entry-form"] button[type=submit]')]);
    await expect(page.locator('[data-testid="pk-saved"]')).toContainText("4 Termine, wöchentlich");
    for (const d of tage) {
      const it = await amTag(page, d, `Serie ${m}`);
      expect(it, `Termin am ${d}`).toHaveLength(1);
      expect(it[0].label).toContain("Serie");
      expect(it[0].text).toContain("15:00–17:00");
    }

    // Ausnahme: nur den zweiten Termin eine Stunde später
    await page.goto((await amTag(page, tage[1], `Serie ${m}`))[0].href);
    await expect(page.locator('[data-testid="entry-series"]')).toContainText("(2/4)");
    await page.fill("#f-from", "16:00");
    expect(await speichern(page)).toContain("Geändert");
    await page.reload();
    await expect(page.locator('[data-testid="entry-series"]')).toContainText("Ausnahme");

    // Ab dem ersten: neue Uhrzeit und neuer Text für „diesen und alle folgenden“ – die Ausnahme bleibt
    await page.goto((await amTag(page, tage[0], `Serie ${m}`))[0].href);
    await page.fill("#f-from", "14:00");
    await page.fill("#f-to", "16:00");
    await page.fill("#f-what", `Neu ${m}`);
    await page.locator('[data-testid="series-scope"] label:has(input[value="folgende"])').click();
    const r = await speichern(page);
    expect(r).toContain("3 Einträge der Serie geändert");
    expect(r).toContain("1 bleibt unverändert");
    for (const d of [tage[0], tage[2], tage[3]]) expect((await amTag(page, d, m))[0].text, `nach Serienänderung am ${d}`).toContain(`14:00–16:00`);
    for (const d of [tage[0], tage[2], tage[3]]) expect((await amTag(page, d, m))[0].text).toContain(`Neu ${m}`);
    const ausnahme = (await amTag(page, tage[1], m))[0];
    expect(ausnahme.text).toContain("16:00–17:00");
    expect(ausnahme.text).toContain(`Serie ${m}`);
    expect(ausnahme.label).toContain("einzeln geändert");

    // Ab dem dritten löschen → nur noch die ersten beiden
    await page.goto((await amTag(page, tage[2], m))[0].href);
    await page.click('[data-testid="entry-delete"]');
    await page.locator('[data-testid="delete-scope"] label:has(input[value="folgende"])').click();
    await Promise.all([page.waitForURL(/\/privat\/kalender/), page.click('[data-testid="entry-delete-confirm"]')]);
    expect(await amTag(page, tage[0], m)).toHaveLength(1);
    expect(await amTag(page, tage[1], m)).toHaveLength(1);
    expect(await amTag(page, tage[2], m)).toHaveLength(0);
    expect(await amTag(page, tage[3], m)).toHaveLength(0);
  });

  test("Auszeit mit Übernachtung (Mo 08:00 – Di 18:00), Kinder beim Partner: ein Vorgang an beiden Tagen", async ({ page }) => {
    const mo = plus(MONTAG, 35);
    const di = plus(mo, 1);
    await anmelden(page, "inhaber");
    await page.goto(`/privat/eintragen?art=auszeit&tag=${mo}`);
    await chip(page, "person", "a");
    await page.fill("#f-toDay", di);
    await page.fill("#f-from", "08:00");
    await page.fill("#f-to", "18:00");
    await chip(page, "kidsBy", "partner");
    await Promise.all([page.waitForURL(/\/privat\/kalender/), page.click('[data-testid="entry-form"] button[type=submit]')]);
    await expect(page.locator('[data-testid="pk-saved"]')).toContainText("34 Std.");
    await expect(page.locator('[data-testid="pk-saved"]')).toContainText("eine Übernachtung");
    for (const d of [mo, di]) {
      const it = await amTag(page, d, "Kinder bei");
      expect(it, `Eintrag am ${d}`).toHaveLength(1);
    }
    // Ohne Uhrzeiten über mehrere Tage → klare Meldung, nichts gespeichert
    await page.goto(`/privat/eintragen?art=paarzeit&tag=${plus(mo, 3)}`);
    await page.fill("#f-toDay", plus(mo, 4));
    await page.fill("#f-hours", "30");
    expect(await speichern(page)).toContain("Über mehrere Tage bitte");
  });

  test("Abendritual als Abfolge: zweimal Streicheln, danach Massage – im Voraus geplant", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/privat/ritual");
    await chip(page, "modus", "abfolge");
    await expect(page.locator('[data-testid="ritual-grid"]')).toBeHidden();
    await expect(page.locator('[data-testid="ritual-evenings"]')).toBeVisible();
    await page.fill("#r-n", "2");
    await Promise.all([aktion(page), page.click('[data-testid="ritual-form"] button[type=submit]')]);
    await expect(page.locator('[data-testid="ritual-form-result"]')).toContainText("Abfolge: 2× Streicheln, dann Massage");
    await page.reload();
    const folge = await page.locator('[data-testid="ritual-next"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(folge.slice(0, 6)).toEqual(["streicheln", "streicheln", "massage", "streicheln", "streicheln", "massage"]);
    // Ein geplanter Abend lässt sich einzeln öffnen (bestätigen, auslassen, verschieben)
    await page.locator('[data-testid="ritual-next"]').nth(2).click();
    await expect(page.locator('[data-testid="occurrence"]')).toContainText("massiert");
  });

  test("Privates bleibt privat: Suche, Geschäftskalender, Konto „nur Familie“, Fragefeld, Claude ohne Freigabe", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    // Ohne Privat-Zugang: kein Privatbereich, auch nicht per direktem Link
    const lp = await alsPerson(browser, "lager");
    await lp.goto("/privat/kalender");
    expect(new URL(lp.url()).pathname.startsWith("/privat")).toBe(false);
    expect(await lp.locator("body").textContent()).not.toContain(GEHEIM);
    // Suche und Geschäftskalender (Büro mit Kalender-Recht, Inhaberin) finden nichts Privates
    const bp = await alsPerson(browser, "buero");
    for (const p of [bp, page]) {
      if (p === page) await anmelden(page, "inhaber");
      await p.goto(`/suche?q=${GEHEIM}`);
      await expect(p.locator("main a", { hasText: GEHEIM })).toHaveCount(0);
      await p.goto(`/kalender?tag=${plus(HEUTE, 2)}`);
      expect(await p.locator("main").textContent()).not.toContain(GEHEIM);
    }
    // „nur Familie“: Kinderzeit ja, Paar-Termine und Paarzeit nein – auch nicht per direktem Link
    const fp = await alsPerson(browser, "familie");
    // Testdaten liegen „morgen“, „in 2 Tagen“ und „in 4 Tagen“ ab dem Anlegen – läuft die Prüfung über Mitternacht,
    // ist alles einen Tag früher. Deshalb je einen Tag Spielraum statt eines festen Datums.
    let ausflug = 0;
    for (const n of [0, 1]) {
      await fp.goto(`/privat/kalender?ansicht=tag&tag=${plus(HEUTE, n)}`);
      ausflug += await fp.locator('[data-testid="pk-item"]', { hasText: "Familienausflug" }).count();
    }
    expect(ausflug, "Kinderzeit für „nur Familie“ sichtbar").toBe(1);
    for (const n of [1, 2, 3, 4]) {
      await fp.goto(`/privat/kalender?ansicht=tag&tag=${plus(HEUTE, n)}`);
      expect(await fp.locator("main").textContent()).not.toContain(GEHEIM);
    }
    const [termin] = await sql<{ id: string }>("select id from private_entries where kind = 'termin' limit 1");
    await fp.goto(`/privat/eintrag/${termin.id}`);
    expect(await fp.locator("body").textContent()).not.toContain(GEHEIM);
    // Fragefeld (Mitarbeiter-Weg): nie Privates – auch nicht über den Kalender
    await page.goto("/");
    const von = HEUTE;
    const bis = plus(HEUTE, 7);
    const antworten = () => page.locator('[data-testid="asst-msg-assistant"]').count();
    const n0 = await antworten();
    await page.fill('[data-testid="asst-input"]', `werkzeug:kalender {"von":"${von}","bis":"${bis}"} ${m}-K`);
    await page.keyboard.press("Enter");
    await expect.poll(antworten).toBeGreaterThan(n0);
    await expect(page.locator('[data-testid="asst-status"]')).toHaveCount(0);
    const ki = await testdienste.ki();
    const i = ki.findLastIndex((k) => k.text.includes(`${m}-K`));
    expect(ki[i].tools.some((t) => t.startsWith("privat_"))).toBe(false);
    const ergebnis = ki.slice(i + 1).find((k) => k.toolResult);
    expect(ergebnis?.toolResult ?? "").not.toContain(GEHEIM);
    // Claude-Konnektor: ohne Privat-Freigabe nichts Privates, mit Freigabe (nur Inhaberin) schon
    const ohne = await mcpVerbinden(browser, baseURL!, "inhaber");
    expect((await ohne.tools()).some((t) => t.startsWith("privat_"))).toBe(false);
    expect(await ohne.call("kalender", { von, bis })).not.toContain(GEHEIM);
    expect(await ohne.call("privat_kalender", { von, bis })).toContain("nicht freigegeben");
    const mit = await mcpVerbinden(browser, baseURL!, "inhaber", { privat: true });
    expect(mit.scope).toContain("privat");
    // Mit Freigabe: „kalender“ zeigt private Termine nur als „Termin außer Haus“ + Uhrzeit, Einzelheiten nur privat_kalender
    const kal = await mit.call("kalender", { von, bis });
    expect(kal).not.toContain(GEHEIM);
    expect(kal).toContain("Termin außer Haus");
    expect(await mit.call("privat_kalender", { von, bis })).toContain(GEHEIM);
  });
});
