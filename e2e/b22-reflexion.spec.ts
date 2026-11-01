// B22.1: Über Claude diktierte Beobachtungen ÜBER die Partnerin (Verfasser = ich) erscheinen unter Privat →
// Beobachtungen, im Wochenrückblick (jeden Tag, Woche wählbar), im Monatsrückblick, auf der Startseite und im
// Therapie-Bogen – nach Tag sortiert, mit „[?] unvollständig“. Neue Art „reflexion“ (Zettel für die nächste
// Sitzung) per Claude und Oberfläche, Block „Für die nächste Sitzung“. Sitzungsdatum auch aus dem Kalender
// (Titel „Paartherapie“). Nur erfundene Texte.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const montag = (iso: string) => plus(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const HEUTE = berlin(new Date());
const dmy = (iso: string) => iso.split("-").reverse().join(".");

test.describe("B22.1 – Beobachtungen und Reflexion sichtbar", () => {
  test("Claude-Beobachtungen über die Partnerin überall sichtbar; Reflexion; Woche wählbar; Sitzung aus Kalender", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const gestern = plus(HEUTE, -1);
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    // Paartherapie nur im (abgeglichenen) Kalender – morgen
    const uid = `b22-${m}`;
    await sql("insert into calendar_events (tenant_id, calendar_name, uid, title, starts_at, ends_at, all_day, day) values ($1, 'Testkalender', $2, $3, ($4::date + time '17:00') at time zone 'Europe/Berlin', ($4::date + time '18:00') at time zone 'Europe/Berlin', false, $4::date)", [T, uid, `Paartherapie ${m}`, plus(HEUTE, 1)]);
    try {
      const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true, privat: true });
      const json = async <T,>(name: string, args: Record<string, unknown>) => {
        const out = await mcp.call(name, args);
        try {
          return JSON.parse(out) as T;
        } catch {
          throw new Error(`${name}: ${out}`);
        }
      };

      // Wie am 30.10.: diktierte Zeilen über die Partnerin (an_person b), eine mit „[?]“
      const zeilen = [`Zeile 1 ${m}: Streit beim Frühstück`, `Zeile 2 ${m}: Abholung vergessen [?]`, `Zeile 3 ${m}: Abend ruhig`];
      for (const text of zeilen) {
        const r = await json<{ ok: boolean; link: string; konto: string }>("privat_eintrag_anlegen", { art: "beobachtung", an_person: "b", tag: gestern, text });
        expect(r.ok).toBe(true);
        expect(r.link).toMatch(/\/privat\/beobachtungen$/);
        expect(r.konto).toBeTruthy();
      }
      // Reflexion: einmal mit Sitzungsdatum, einmal ohne (→ nächste Sitzung laut Kalender = spätestens morgen)
      const r1 = await json<{ ok: boolean; meldung: string; link: string }>("privat_eintrag_anlegen", { art: "reflexion", text: `Ansprechen: Wochenplanung ${m}`, sitzung: plus(HEUTE, 14) });
      expect(r1.ok).toBe(true);
      expect(r1.meldung).toContain(dmy(plus(HEUTE, 14)));
      expect(r1.link).toMatch(/\/privat\/beobachtungen#reflexion$/);
      expect((await json<{ ok: boolean }>("privat_eintrag_anlegen", { art: "reflexion", text: `Ansprechen: Danke sagen ${m}` })).ok).toBe(true);
      const liste = await json<{ eintraege: { id: string; art: string; daten: { text: string; sitzung?: string }; eigener: boolean }[] }>("privat_eintraege", { arten: ["reflexion"], limit: 200 });
      const ohne = liste.eintraege.find((e) => e.daten.text.includes(`Danke sagen ${m}`))!;
      expect(ohne.eigener).toBe(true);
      expect(ohne.daten.sitzung && ohne.daten.sitzung >= HEUTE && ohne.daten.sitzung <= plus(HEUTE, 1)).toBe(true);

      // feierabend(rueckblick, mit_privat): Beobachtungen + „Für die nächste Sitzung“
      type P = { beobachtungen: { situation: string; unvollstaendig: boolean }[]; fuerNaechsteSitzung: { text: string }[]; naechsteSitzung: string | null };
      const fa = await json<{ wochenrueckblick: { privat: P } }>("feierabend", { rueckblick: true, mit_privat: true });
      expect(fa.wochenrueckblick.privat.beobachtungen.filter((b) => b.situation.includes(m)).map((b) => b.unvollstaendig)).toEqual([false, true, false]);
      expect(fa.wochenrueckblick.privat.fuerNaechsteSitzung.map((r) => r.text)).toEqual(expect.arrayContaining([`Ansprechen: Wochenplanung ${m}`, `Ansprechen: Danke sagen ${m}`]));
      expect(fa.wochenrueckblick.privat.naechsteSitzung! <= plus(HEUTE, 1)).toBe(true);
      // frühere Woche über woche_bis: dort nicht
      const alt = await json<{ wochenrueckblick: { privat: P } }>("feierabend", { mit_privat: true, woche_bis: plus(HEUTE, -9) });
      expect(alt.wochenrueckblick.privat.beobachtungen.some((b) => b.situation.includes(m))).toBe(false);

      // Oberfläche: Privat → Beobachtungen
      await anmelden(page, "inhaber");
      await page.goto("/privat/beobachtungen");
      const meine = page.getByTestId("beob-meine").getByTestId("beob-zeile").filter({ hasText: m });
      await expect(meine).toHaveCount(3);
      await expect(meine.nth(0)).toContainText("Zeile 1");
      await expect(meine.nth(1)).toContainText("[?] unvollständig");
      await expect(meine.nth(2)).toContainText("Zeile 3");
      await expect(meine.nth(0)).toContainText(dmy(gestern));
      await expect(page.getByTestId("beob-claude-hinweis")).toContainText("mit deinem Konto verbunden");
      // Reflexion in der Oberfläche anlegen
      const rf = page.getByTestId("reflexion-form");
      await expect(rf.locator("#r-sitzung")).not.toHaveValue("");
      await rf.locator("#r-text").fill(`Zettel aus der Oberfläche ${m}`);
      await Promise.all([aktion(page), rf.locator("button[type=submit]").click()]);
      await expect(page.getByTestId("reflexion-form-result")).toContainText("gespeichert");
      await expect(page.getByTestId("reflexion-zeile").filter({ hasText: m })).toHaveCount(3);

      // Wochenrückblick: jeden Tag, Woche wählbar
      await page.goto("/privat/rueckblick/woche");
      await expect(page.getByTestId("woche-beobachtung").filter({ hasText: m })).toHaveCount(3);
      await expect(page.getByTestId("woche-beobachtung").filter({ hasText: "Zeile 2" }).filter({ hasText: m })).toContainText("[?] unvollständig");
      await expect(page.getByTestId("woche-reflexion")).toContainText(`Zettel aus der Oberfläche ${m}`);
      await expect(page.getByTestId("woche-reflexion")).toContainText(`Wochenplanung ${m}`);
      await page.getByTestId("woche-wahl").locator("#woche").selectOption(montag(gestern));
      await Promise.all([page.waitForURL(/woche=/), page.getByTestId("woche-wahl").locator("button[type=submit]").click()]);
      await expect(page.getByTestId("wochenrueckblick").locator("h2")).toContainText(dmy(montag(gestern)));
      await expect(page.getByTestId("woche-beobachtung").filter({ hasText: m })).toHaveCount(3);
      await page.goto(`/privat/rueckblick/woche?woche=${plus(montag(gestern), -14)}`);
      await expect(page.getByTestId("woche-beobachtung").filter({ hasText: m })).toHaveCount(0);

      // Therapie-Bogen: Zettel unter „Für die nächste Sitzung“; Startseite und Monatsrückblick verlinken
      await page.goto(`/privat/therapie-bogen?ab=${plus(HEUTE, -3)}&bis=${HEUTE}`);
      await expect(page.getByTestId("tb-zeile").filter({ hasText: m })).toHaveCount(3);
      await expect(page.getByTestId("tb-reflexion")).toContainText(`Danke sagen ${m}`);
      await page.goto("/privat");
      await expect(page.getByTestId("start-reflexion")).toContainText("Beobachtungen");
      await page.goto(`/privat/rueckblick?monat=${gestern.slice(0, 7)}`);
      await expect(page.getByTestId("rb-beobachtungen")).not.toContainText("keine");

      // Feierabend-Seite: Block „Für die nächste Sitzung“, Wochen blättern
      await page.goto("/kalender/feierabend?rueckblick=1&privat=1");
      await expect(page.getByTestId("fa-reflexion")).toContainText(`Danke sagen ${m}`);
      await page.getByTestId("fa-woche-nav").getByText("‹ Vorwoche").click();
      await expect(page).toHaveURL(/bis=/);
      await expect(page.getByTestId("fa-beobachtung").filter({ hasText: m })).toHaveCount(0);
    } finally {
      await sql("delete from calendar_events where tenant_id = $1 and uid = $2", [T, uid]);
    }
  });
});
