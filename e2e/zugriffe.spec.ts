// Zugriffsrechte (B19.2) mit erfundenen Konten: Warnung „Privat voll bei Nicht-Inhaber“ in der Benutzerliste, Rolle
// „VA“ per Vorlage (kein Privat, keine Finanzen), neues Konto „Nur Familie“; „nur Familie“ sieht Familien-Termine
// und Schulbriefe, aber keine Paar-/Arzt-Termine, kein Tagebuch, keine Therapie, kein Geld.
import bcrypt from "bcryptjs";
import type { Page } from "@playwright/test";
import { aktion, alsPerson, anmelden, expect, marke, sql, test } from "./helfer";

const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const chip = (p: Page, name: string, value: string) => p.locator(`label:has(input[name="${name}"][value="${value}"])`).click();

test.describe("Zugriffsrechte (B19.2)", () => {
  test("Benutzerliste: Privat voll bei Nicht-Inhaber rot, Rolle „VA“ setzen, neues Konto „Nur Familie“", async ({ page }) => {
    const m = marke().toLowerCase();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [u] = await sql<{ id: string }>("insert into users (email, name, password_hash) values ($1, $2, $3) returning id", [`test-${m}`, `Testkonto ${m}`, await bcrypt.hash(`Erfunden-${m}-Passwort`, 4)]);
    await sql("insert into memberships (tenant_id, user_id, role, areas, read_only, private_access, private_scope) values ($1, $2, 'staff', null, false, true, 'voll')", [T, u.id]);

    await anmelden(page, "inhaber");
    await page.goto("/einstellungen");
    await expect(page.getByTestId("zugriff-warnungen")).toContainText(`Testkonto ${m}: Privat „voll“ bei Nicht-Inhaber`);
    await expect(page.getByTestId("zugriff-warnungen")).toContainText(`Testkonto ${m}: Mitarbeiter mit allen Bereichen`);
    const zeile = page.locator("tr", { hasText: `test-${m}` });
    await expect(zeile.getByTestId("user-privat")).toContainText("voll");
    await expect(zeile.getByTestId("user-privat")).toContainText("Privat voll bei Nicht-Inhaber");

    // Rolle „VA“: Aufgaben, Amazon (Fälle, Ansprüche), Service (Retouren) – kein Privat, kein Geld
    await zeile.getByTestId("user-rolle").locator("select").selectOption("va");
    await Promise.all([aktion(page), zeile.getByTestId("user-rolle").getByRole("button", { name: "Rolle setzen" }).click()]);
    await expect.poll(async () => (await sql<{ areas: string[] | null; private_access: boolean }>("select areas, private_access from memberships where user_id = $1", [u.id]))[0]).toEqual({ areas: ["start", "amazon", "service"], private_access: false });
    await page.reload();
    await expect(page.locator("main")).not.toContainText(`Testkonto ${m}: Privat „voll“`);
    await expect(page.locator("tr", { hasText: `test-${m}` }).getByTestId("user-privat")).toContainText("kein");

    // Neues Konto mit Rolle „Nur Familie“: Privat nur Familie, keine Geschäftsbereiche
    const form = page.getByTestId("add-user");
    await form.locator("#u-login").fill(`fam-${m}`);
    await form.getByTestId("add-user-rolle").selectOption("familie");
    await Promise.all([aktion(page), form.getByRole("button", { name: "Hinzufügen" }).click()]);
    await expect(page.getByTestId("add-user-result")).toContainText("Einmal-Passwort");
    const [fam] = await sql<{ role: string; areas: string[]; private_access: boolean; private_scope: string }>("select m.role, m.areas, m.private_access, m.private_scope from memberships m join users u on u.id = m.user_id where u.email = $1", [`fam-${m}`]);
    expect(fam).toEqual({ role: "staff", areas: [], private_access: true, private_scope: "familie" });
  });

  test("„Nur Familie“: Familien-Termin und Schulbriefe ja – Paar-Termin, Tagebuch, Therapie, Geld nein", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const m = marke();
    const tag = plus(berlin(new Date()), 3);
    await anmelden(page, "inhaber");
    // Inhaberin legt einen Familien-Termin und einen Paar-Termin an (erfunden)
    for (const [mit, titel] of [["familie", `Elternabend ${m}`], ["paar", `Paartermin ${m}`]] as const) {
      await page.goto(`/privat/eintragen?art=termin&tag=${tag}`);
      await page.fill("#f-title", titel);
      await chip(page, "with", mit);
      await page.fill("#f-time", "19:00");
      await Promise.all([page.waitForURL(/\/privat\/kalender/), page.click('[data-testid="entry-form"] button[type=submit]')]);
    }

    const fp = await alsPerson(browser, "familie");
    await fp.goto(`/privat/kalender?ansicht=tag&tag=${tag}`);
    await expect(fp.locator('[data-testid="pk-item"]', { hasText: `Elternabend ${m}` })).toHaveCount(1);
    await expect(fp.locator("main")).not.toContainText(`Paartermin ${m}`);
    // Schulbriefe: Seite offen (vorher nur mit vollem Zugang)
    await fp.goto("/privat/schulbriefe");
    await expect(fp).toHaveURL(/\/privat\/schulbriefe/);
    await expect(fp.getByTestId("sb-upload")).toBeVisible();
    // Tagebuch, Therapie-Bogen, Geld, Paar: gesperrt
    for (const pfad of ["/privat/tagebuch", "/privat/therapie-bogen", "/privat/geld", "/privat/paar"]) {
      await fp.goto(pfad);
      await expect(fp, pfad).toHaveURL(/nurfamilie=1/);
    }
    // Paar-Termin auch nicht per direktem Link
    await page.goto(`/privat/kalender?ansicht=tag&tag=${tag}`);
    const href = await page.locator('[data-testid="pk-item"]', { hasText: `Paartermin ${m}` }).getAttribute("href");
    await fp.goto(href!);
    await expect(fp.locator("body")).not.toContainText(`Paartermin ${m}`);
  });
});
