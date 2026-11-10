// Bauauftrag B34.2 Download-Ordner – Abnahme: Testordner mit 5 Rechnungen + 2 Dubletten wird vom echten
// Agent-Programm sortiert und umbenannt, Dubletten verschoben, nichts gelöscht; dazu Kontoauszug (nicht als Rechnung)
// und Löschen einer Dublette erst nach Freigabe. Alle Firmen, Nummern und Beträge erfunden.
import { mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";
// @ts-expect-error – Programm des Druckagenten (JavaScript, läuft ohne Abhängigkeiten auf dem Arbeits-PC)
import { Agent } from "../druckagent/lugru-druckagent.mjs";

type BelegAgent = { heartbeat(): Promise<unknown>; belegePruefen(): Promise<{ verschoben: number; geloescht: number }>; einstellungen: Record<string, unknown> };

async function pdf(zeilen: string[]) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([595, 842]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  zeilen.forEach((t, i) => p.drawText(t, { x: 50, y: 780 - i * 20, size: 11, font: f }));
  return Buffer.from(await doc.save());
}

/** Alle Dateien unter einem Ordner (relativ), ohne die Stand-Datei des Agenten. */
function dateien(ordner: string, basis = ordner): string[] {
  return readdirSync(ordner).flatMap((n) => {
    const p = path.join(ordner, n);
    if (statSync(p).isDirectory()) return dateien(p, basis);
    return n === ".lugru-belege.json" ? [] : [path.relative(basis, p).split(path.sep).join("/")];
  });
}

async function agentAnlegen(page: Page, name: string) {
  await page.goto("/einstellungen/drucker");
  await page.getByTestId("agent-name").fill(name);
  await Promise.all([aktion(page), page.getByTestId("agent-anlegen-los").click()]);
  const token = (await page.getByTestId("agent-token").innerText()).trim();
  expect(token).toMatch(/^da_/);
  return token;
}

test.describe("B34.2 Download-Ordner", () => {
  const m = marke();
  const ordner = { dl: "", ab: "" };
  test.afterAll(async () => {
    await sql("delete from invoices where source = 'ordner' and file_name like $1", [`%RE-${m}-%`]);
    await sql("delete from beleg_ablage where dateiname like $1", [`%${m}%`]);
    await sql("delete from bank_umsaetze where gegenpartei like $1", [`Testlieferant%${m}%`]);
    await sql("update druck_agenten set deaktiviert_am = now() where name = $1", [`Arbeits-PC Belege ${m}`]);
    for (const o of Object.values(ordner)) if (o && existsSync(o)) rmSync(o, { recursive: true, force: true });
  });

  test("Abnahme: 5 Rechnungen + 2 Dubletten sortiert und umbenannt, Dubletten verschoben, nichts gelöscht; Kontoauszug; Löschen nur nach Freigabe", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    await anmelden(page, "inhaber");
    const name = `Arbeits-PC Belege ${m}`;
    const token = await agentAnlegen(page, name);
    ordner.dl = mkdtempSync(path.join(os.tmpdir(), "b34-download-"));
    ordner.ab = mkdtempSync(path.join(os.tmpdir(), "b34-ablage-"));

    // Ordner beim Agenten einstellen (Einstellungen → Drucker)
    const form = page.locator("section", { hasText: `${name}: Strom, Ordner, Leerlauf` }).getByTestId("agent-einstellungen");
    await form.locator('input[name="belege_pfad"]').fill(ordner.dl);
    await form.locator('input[name="belege_ablage"]').fill(ordner.ab);
    await Promise.all([aktion(page), form.getByRole("button", { name: "Speichern" }).click()]);
    await expect(page.getByText("Gespeichert – der Agent übernimmt es")).toBeVisible();

    // Testordner: 5 Rechnungen (5 Lieferanten), 1 Dublette = gleiche Datei, 1 Dublette = gleiche Nr. + Betrag (neu gedruckt)
    const R = [
      { l: "A", nr: 1, betrag: "119,00", tag: "03" },
      { l: "B", nr: 2, betrag: "49,90", tag: "04" },
      { l: "C", nr: 3, betrag: "1.234,56", tag: "05" },
      { l: "D", nr: 4, betrag: "7,50", tag: "06" },
      { l: "E", nr: 5, betrag: "300,00", tag: "07" },
    ];
    const text = (r: (typeof R)[number], extra: string[] = []) => ["Rechnung", `Testlieferant ${r.l} ${m} GmbH · Handelsweg ${r.nr} · 12345 Musterstadt`, "Rechnung an: Testempfänger GmbH", `Rechnungsnummer: RE-${m}-${r.nr}`, `Rechnungsdatum: ${r.tag}.11.2026`, `Gesamtbetrag ${r.betrag} EUR`, ...extra];
    for (const r of R) writeFileSync(path.join(ordner.dl, `rechnung_${r.l}_${m}.pdf`), await pdf(text(r)));
    writeFileSync(path.join(ordner.dl, `rechnung_A_${m} (1).pdf`), await pdf(text(R[0])));
    writeFileSync(path.join(ordner.dl, `RE-${m}-2_nochmal.pdf`), await pdf(text(R[1], ["Zweitschrift"])));
    const alt = new Date(Date.now() - 60_000);
    for (const n of readdirSync(ordner.dl)) utimesSync(path.join(ordner.dl, n), alt, alt);
    expect(readdirSync(ordner.dl)).toHaveLength(7);

    const agent: BelegAgent = new Agent({ server: baseURL, token, drucker: [] }, { log: () => undefined });
    await agent.heartbeat();
    expect(agent.einstellungen.belege).toEqual({ pfad: ordner.dl, ablage: ordner.ab });
    expect(await agent.belegePruefen()).toEqual({ verschoben: 7, geloescht: 0 });

    // Download-Ordner leer, Ablage: 5 Rechnungen nach Monat/Lieferant umbenannt, 2 in „Dubletten“ – 7 Dateien, nichts gelöscht
    expect(readdirSync(ordner.dl)).toEqual([]);
    const liste = dateien(ordner.ab);
    expect(liste).toHaveLength(7);
    for (const r of R) {
      const lief = `Testlieferant-${r.l}-${m}-GmbH`;
      const betrag = r.betrag.replace(".", "");
      expect(liste).toContain(`2026-11/${lief}/2026-11-${r.tag}_${lief}_${betrag}_RE-${m}-${r.nr}.pdf`);
    }
    expect(liste.filter((x) => x.startsWith("Dubletten/"))).toHaveLength(2);
    const zeilen = await sql<{ status: string; dublette_grund: string | null; pfad: string | null }>("select status, dublette_grund, pfad from beleg_ablage where dateiname like $1 order by status", [`%${m}%`]);
    expect(zeilen.filter((z) => z.status === "ablegen")).toHaveLength(5);
    const dubl = zeilen.filter((z) => z.status === "dublette");
    expect(dubl.map((z) => z.dublette_grund).sort()).toEqual([`gleiche Rechnungsnummer RE-${m}-2 und Betrag 49,90 €`, "gleiche Datei (Prüfsumme)"].sort());
    expect(zeilen.every((z) => z.pfad)).toBe(true);
    expect((await sql<{ n: string }>("select count(*) n from invoices where source = 'ordner' and file_name like $1", [`%RE-${m}-%`]))[0].n).toBe("5");

    // Kontoauszug im Download-Ordner → importiert bzw. erkannt, nach „Kontoauszüge/2026-11“, keine Rechnung
    const auszug = await pdf(["Testbank", "Kontoauszug Nr. 11/2026", "IBAN DE00 1234 5678 9012 3456 78", "Buchungstag Wert Vorgang Betrag", `03.11.2026 03.11.2026 Lastschrift Testlieferant A ${m} -119,00`, "04.11.2026 04.11.2026 Gutschrift Testkunde 250,00", "Neuer Kontostand 1.234,56"]);
    writeFileSync(path.join(ordner.dl, `Kontoauszug_${m}.pdf`), auszug);
    utimesSync(path.join(ordner.dl, `Kontoauszug_${m}.pdf`), alt, alt);
    expect((await agent.belegePruefen()).verschoben).toBe(1);
    expect(dateien(ordner.ab)).toContain(`Kontoauszüge/2026-11/Kontoauszug_${m}.pdf`);
    expect((await sql<{ status: string; art: string }>("select status, art from beleg_ablage where dateiname = $1", [`Kontoauszug_${m}.pdf`]))[0]).toEqual({ status: "kontoauszug", art: "kontoauszug" });
    expect((await sql("select 1 from invoices where file_name like $1", [`%Kontoauszug_${m}%`])).length).toBe(0);

    // Löschen erst nach Freigabe: ohne Freigabe löscht der Agent nichts
    expect((await agent.belegePruefen()).geloescht).toBe(0);
    await page.goto("/rechnungsstation/ablage");
    const zeile = page.getByTestId("ablage-dublette").filter({ hasText: `RE-${m}-2` }).first();
    await expect(zeile).toBeVisible();
    await Promise.all([aktion(page), zeile.getByTestId("ablage-freigeben").click()]);
    await expect(page.getByTestId("ablage-meldung")).toContainText("1 Dublette zum Löschen freigegeben");
    expect(await agent.belegePruefen()).toEqual({ verschoben: 0, geloescht: 1 });
    const nachher = dateien(ordner.ab);
    expect(nachher.filter((x) => x.startsWith("Dubletten/"))).toHaveLength(1);
    expect(nachher).toHaveLength(7); // 5 Rechnungen + 1 Dublette + 1 Kontoauszug
    expect((await sql<{ n: string }>("select count(*) n from beleg_ablage where dateiname like $1 and geloescht_am is not null", [`%${m}%`]))[0].n).toBe("1");
  });
});
