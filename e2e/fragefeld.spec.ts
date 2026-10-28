// Fragefeld: altes Gespräch nach einem „Update“ fortsetzen (früher 400 „thinking block bound to a different
// conversation“) und Prep-Center-Frage mit exakten Zahlen aus den Testdaten.
import type { Page } from "@playwright/test";
import { aktion, anmelden, expect, marke, test, testdienste } from "./helfer";
import { TD } from "./env";

const antworten = (p: Page) => p.locator('[data-testid="asst-msg-assistant"]').allTextContents();
async function fragen(p: Page, feld: string, text: string) {
  const n = (await antworten(p)).length;
  await p.fill(feld, text);
  await p.keyboard.press("Enter");
  await expect.poll(async () => (await antworten(p)).length).toBeGreaterThan(n);
  await expect(p.locator('[data-testid="asst-status"]')).toHaveCount(0);
  return (await antworten(p)).at(-1)!;
}
async function aendernErlauben(p: Page, an: boolean) {
  await p.goto("/einstellungen/claude");
  const box = p.locator('[data-testid="assistant-settings"] input[name="allowWrite"]');
  if ((await box.isChecked()) !== an) {
    await box.setChecked(an);
    await Promise.all([aktion(p), p.click('[data-testid="assistant-settings"] button[type=submit]')]);
  }
  await p.reload();
  await expect(box).toBeChecked({ checked: an });
}

test.describe("Fragefeld (KI-Assistent)", () => {
  test("Altes Gespräch nach geänderter Werkzeugliste fortsetzen: kein 400, alter Denk-Schritt wird verworfen", async ({ page, browser }) => {
    const m = marke();
    await anmelden(page, "inhaber");
    await aendernErlauben(page, true);
    await page.goto("/");
    expect(await fragen(page, '[data-testid="asst-input"]', `Hallo ${m}-C1`)).toContain("Hallo aus der Test-KI");
    const erste = (await testdienste.kiZu(`${m}-C1`))!;
    expect(erste.thinking?.block_binding?.prefix_mismatch_behavior).toBe("drop_block");
    expect(erste.beta).toContain("thinking-binding-controls-2026-08-01");
    // „Update“: Werkzeugliste ändert sich → gespeicherte Denk-Schritte passen nicht mehr zum Präfix
    await aendernErlauben(page, false);
    const p2 = await (await browser.newContext({ locale: "de-DE" })).newPage();
    await anmelden(p2, "inhaber");
    await fragen(p2, '[data-testid="asst-input"]', `Neu ${m}-C0`);
    await p2.click('[data-testid="asst-panel"] button:has-text("Verlauf")');
    await p2.click(`.asst-history button:has-text("Hallo ${m}-C1")`);
    await expect(p2.locator('[data-testid="asst-msg-user"]', { hasText: `${m}-C1` })).toBeVisible();
    const a2 = await fragen(p2, '[data-testid="asst-input2"]', `Weiter ${m}-C2`);
    const weiter = (await testdienste.kiZu(`${m}-C2`))!;
    expect(weiter.staleThinking).toBeGreaterThanOrEqual(1);
    expect(weiter.prefix).not.toBe(erste.prefix);
    expect(a2).toContain("alter Denk-Schritt verworfen");
    await expect(p2.locator('[data-testid="asst-panel"] .notice-error')).toHaveCount(0);
    // Gegenprobe: ohne drop_block antwortet die Test-KI wie die echte API mit 400
    const probe = (drop: boolean) =>
      fetch(`${TD}/anthropic/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "x", system: "neu", tools: [], thinking: drop ? { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } } : { type: "adaptive" }, messages: [{ role: "user", content: "a" }, { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig:alt" }, { type: "text", text: "b" }] }, { role: "user", content: "c" }] }) });
    const ohne = await probe(false);
    expect(ohne.status).toBe(400);
    expect(await ohne.text()).toContain("bound to a different conversation");
    expect((await probe(true)).status).toBe(200);
    await aendernErlauben(page, true);
  });

  test("Prep Center: Werkzeug „prep_center“ liefert Sendungen, Stück, Kosten je Monat und die Erklärung", async ({ page }) => {
    const m = marke();
    await anmelden(page, "inhaber");
    await page.goto("/");
    const antwort = await fragen(page, '[data-testid="asst-input"]', `Was kostet uns das Prep Center? ${m}-PC`);
    const ki = await testdienste.ki();
    const i = ki.findLastIndex((k) => k.text.includes(`${m}-PC`));
    const ergebnis = ki.slice(i + 1).find((k) => k.toolResult);
    const d = JSON.parse(ergebnis!.toolResult!);
    type Monat = { monat: string; sendungen: number; stueck: number; erwartete_kosten?: number };
    const v: Record<string, Monat> = Object.fromEntries((d.verlauf as Monat[]).map((x) => [x.monat, x]));
    const monate = Object.keys(v).sort();
    expect(monate).toHaveLength(3);
    // Testdaten: dieser Monat 2 Sendungen (1 + 3 Stück), Vormonat 1 Sendung (2 Stück); 2,50 € + 0,50 € je weiteres Stück
    expect(v[monate[2]]).toMatchObject({ sendungen: 2, stueck: 4, erwartete_kosten: 6 });
    expect(v[monate[1]]).toMatchObject({ sendungen: 1, stueck: 2, erwartete_kosten: 3 });
    expect(v[monate[0]]).toMatchObject({ sendungen: 0, stueck: 0 });
    expect(d.einstellungen.gebuehr_je_sendung).toBe(2.5);
    expect(d.so_funktioniert_es).toContain("verschickt von");
    expect(d.so_funktioniert_es).toContain("Palettenlager");
    expect(d.link).toContain("/auftraege/prep-center?monat=");
    expect(antwort).toContain("Verlauf:");
    expect(antwort).toContain("So funktioniert es");
  });
});
