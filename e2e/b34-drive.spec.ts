// Bauauftrag B34.2 (Drive) – Abnahme: Test-Ordner in Drive mit 5 Rechnungen + 2 Dubletten (+ Kontoauszug) → Vorschau mit
// neuen Namen und Dublettenliste; ohne Schreibrecht wird nichts verändert; nach Freigabe sortiert, nichts gelöscht;
// Dubletten erst nach eigener Freigabe in den Papierkorb. Google Drive läuft gegen den Nachbau, alles erfunden.
import { createCipheriv, createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { E2E_ENV, TD } from "./env";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

function versiegeln(plain: string) {
  const key = createHash("sha256").update(`integrations:${E2E_ENV.APP_SECRET}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

async function pdf(zeilen: string[]) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([595, 842]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  zeilen.forEach((t, i) => p.drawText(t, { x: 50, y: 780 - i * 20, size: 11, font: f }));
  return Buffer.from(await doc.save());
}

type DriveDatei = { id: string; name: string; pfad: string; trashed: boolean };
const nachbau = (body: unknown) => fetch(`${TD}/__drive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<{ ids: string[] }>);
const stand = () => fetch(`${TD}/__drive`).then((r) => r.json() as Promise<DriveDatei[]>);

test.describe.serial("B34.2 Drive-Rechnungsordner", () => {
  const m = marke();
  const W = `drv-wurzel-${m}`;
  let T = "";
  let ids: string[] = [];
  let alt: { config: unknown; secret_encrypted: string | null; label: string | null } | undefined;

  test.beforeAll(async () => {
    [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    [alt] = await sql<{ config: unknown; secret_encrypted: string | null; label: string | null }>("select config, secret_encrypted, label from integrations where tenant_id = $1 and provider = 'google_drive'", [T]);
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const sa = { type: "service_account", client_email: "rechnungen-test@example.invalid", private_key: privateKey, token_uri: `${TD}/google-oauth/token` };
    await sql("delete from integrations where tenant_id = $1 and provider = 'google_drive'", [T]);
    await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'google_drive', 'Test', $2::jsonb, $3)", [T, JSON.stringify({ folderId: W }), versiegeln(JSON.stringify({ serviceAccountJson: JSON.stringify(sa) }))]);
    await sql("update tenants set settings = settings - 'driveAblage' where id = $1", [T]);
  });

  test.afterAll(async () => {
    await sql("delete from invoices where tenant_id = $1 and source = 'drive' and external_id = any($2::text[])", [T, ids]);
    await sql("delete from drive_ablage where tenant_id = $1 and dateiname like $2", [T, `%${m}%`]);
    await sql("delete from bank_umsaetze where gegenpartei like $1", [`Testlieferant%${m}%`]);
    await sql("delete from integrations where tenant_id = $1 and provider = 'google_drive'", [T]);
    if (alt) await sql("insert into integrations (tenant_id, provider, label, config, secret_encrypted) values ($1, 'google_drive', $2, $3::jsonb, $4)", [T, alt.label, JSON.stringify(alt.config), alt.secret_encrypted]);
    await sql("update tenants set settings = settings - 'driveAblage' where id = $1", [T]);
    await nachbau({ zuruecksetzen: true });
  });

  test("Abnahme: 5 Rechnungen + 2 Dubletten → Vorschau mit neuen Namen + Dublettenliste; nach Freigabe sortiert; nichts gelöscht", async ({ page }) => {
    test.setTimeout(180_000);
    const R = [
      { l: "A", nr: 1, betrag: "119,00", tag: "03" },
      { l: "B", nr: 2, betrag: "49,90", tag: "04" },
      { l: "C", nr: 3, betrag: "1.234,56", tag: "05" },
      { l: "D", nr: 4, betrag: "7,50", tag: "06" },
      { l: "E", nr: 5, betrag: "300,00", tag: "07" },
    ];
    const text = (r: (typeof R)[number], extra: string[] = []) => ["Rechnung", `Testlieferant ${r.l} ${m} GmbH · Handelsweg ${r.nr} · 12345 Musterstadt`, "Rechnung an: Testempfänger GmbH", `Rechnungsnummer: RE-${m}-${r.nr}`, `Rechnungsdatum: ${r.tag}.11.2026`, `Gesamtbetrag ${r.betrag} EUR`, ...extra];
    const zeit = (i: number) => new Date(Date.UTC(2026, 10, 9, 8, i)).toISOString();
    const dateien = [
      ...(await Promise.all(R.map(async (r, i) => ({ name: `rechnung_${r.l}_${m}.pdf`, base64: (await pdf(text(r))).toString("base64"), createdTime: zeit(i), parents: [W] })))),
      { name: `rechnung_A_${m} (1).pdf`, base64: (await pdf(text(R[0]))).toString("base64"), createdTime: zeit(10), parents: [W] },
      { name: `RE-${m}-2_nochmal.pdf`, base64: (await pdf(text(R[1], ["Zweitschrift"]))).toString("base64"), createdTime: zeit(11), parents: [W] },
      { name: `Kontoauszug_${m}.pdf`, base64: (await pdf(["Testbank", "Kontoauszug Nr. 11/2026", "IBAN DE00 1234 5678 9012 3456 78", "Buchungstag Wert Vorgang Betrag", `03.11.2026 03.11.2026 Lastschrift Testlieferant A ${m} -119,00`, "04.11.2026 04.11.2026 Gutschrift Testkunde 250,00", "Neuer Kontostand 1.234,56"])).toString("base64"), createdTime: zeit(12), parents: [W] },
    ];
    ({ ids } = await nachbau({ zuruecksetzen: true, ordner: [{ id: W, name: "rechnungen" }], dateien }));
    ids = ids.filter((x) => x !== W);
    expect(ids).toHaveLength(8);

    await anmelden(page, "inhaber");
    await page.goto("/rechnungsstation/ablage");
    const box = page.getByTestId("drive-ablage");
    await expect(box).toHaveAttribute("data-modus", "service");
    await expect(box).toHaveAttribute("data-schreiben", "0");
    await Promise.all([aktion(page), box.getByTestId("drive-lesen").click()]);
    await expect(page.getByTestId("ablage-meldung")).toContainText("Drive gelesen: 8 neue Vorschläge, 5 Rechnungen übernommen");

    // Vorschau: 5 × ablegen mit neuem Namen + Zielordner Monat/Lieferant, 2 Dubletten, 1 Kontoauszug
    const zeilen = box.getByTestId("drive-vorschlag");
    await expect(zeilen).toHaveCount(8);
    await expect(box.locator('[data-testid="drive-vorschlag"][data-vorschlag="ablegen"]')).toHaveCount(5);
    for (const r of R) {
      const lief = `Testlieferant-${r.l}-${m}-GmbH`;
      const z = box.locator(`[data-testid="drive-vorschlag"][data-datei="rechnung_${r.l}_${m}.pdf"]`);
      await expect(z.getByTestId("drive-neuer-name")).toHaveText(`2026-11-${r.tag}_${lief}_${r.betrag.replace(".", "")}_RE-${m}-${r.nr}.pdf`);
      await expect(z.getByTestId("drive-ziel")).toHaveText(`2026-11/${lief}`);
    }
    await expect(box.locator(`[data-testid="drive-vorschlag"][data-datei="Kontoauszug_${m}.pdf"]`)).toHaveAttribute("data-vorschlag", "kontoauszug");
    await expect(box.locator(`[data-testid="drive-vorschlag"][data-datei="Kontoauszug_${m}.pdf"]`).getByTestId("drive-ziel")).toHaveText("Kontoauszüge/2026-11");
    const dubl = box.getByTestId("drive-dublette");
    await expect(dubl).toHaveCount(2);
    await expect(box.getByTestId("drive-dubletten")).toContainText("gleiche Datei (Prüfsumme)");
    await expect(box.getByTestId("drive-dubletten")).toContainText(`gleiche Rechnungsnummer RE-${m}-2 und Betrag 49,90 €`);
    // Vorschau-PDF aus Drive
    const vid = (await sql<{ id: string }>("select id from drive_ablage where tenant_id = $1 and dateiname = $2", [T, `rechnung_C_${m}.pdf`]))[0].id;
    const v = await page.request.get(`/rechnungsstation/ablage/drive/${vid}/pdf`);
    expect(v.headers()["content-type"]).toBe("application/pdf");
    expect((await v.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Rechnungen: nur die 5 Originale, keine Dublette und kein Kontoauszug als Rechnung
    expect((await sql<{ n: string }>("select count(*) n from invoices where tenant_id = $1 and source = 'drive' and external_id = any($2::text[])", [T, ids]))[0].n).toBe("5");
    expect((await sql("select 1 from invoices where tenant_id = $1 and file_name like $2", [T, `%Kontoauszug_${m}%`])).length).toBe(0);

    // Ohne Schreibrecht: Freigabe gesperrt, in Drive unverändert
    await expect(box.getByTestId("drive-alle-freigeben")).toBeDisabled();
    expect((await stand()).every((d) => d.pfad === "rechnungen" && !d.trashed)).toBe(true);

    // Inhaber gibt das Schreibrecht frei → Charge freigeben → sortiert und umbenannt
    await Promise.all([aktion(page), box.getByTestId("drive-schreiben-schalter").click()]);
    await expect(box).toHaveAttribute("data-schreiben", "1");
    await Promise.all([aktion(page), box.getByTestId("drive-alle-freigeben").click()]);
    await expect(page.getByTestId("ablage-meldung")).toContainText("8 in Drive abgelegt – nichts gelöscht.");
    const nachher = await stand();
    expect(nachher).toHaveLength(8);
    expect(nachher.some((d) => d.trashed)).toBe(false);
    for (const r of R) {
      const lief = `Testlieferant-${r.l}-${m}-GmbH`;
      expect(nachher.map((d) => `${d.pfad}/${d.name}`)).toContain(`rechnungen/2026-11/${lief}/2026-11-${r.tag}_${lief}_${r.betrag.replace(".", "")}_RE-${m}-${r.nr}.pdf`);
    }
    expect(nachher.filter((d) => d.pfad === "rechnungen/Dubletten").map((d) => d.name).sort()).toEqual([`RE-${m}-2_nochmal.pdf`, `rechnung_A_${m} (1).pdf`].sort());
    expect(nachher.find((d) => d.name === `Kontoauszug_${m}.pdf`)?.pfad).toBe("rechnungen/Kontoauszüge/2026-11");
    await expect(box.getByTestId("drive-vorschlag")).toHaveCount(0);
    await expect(box.locator('[data-testid="drive-dublette"][data-zustand="erledigt"]')).toHaveCount(2);
    await expect(box.getByTestId("drive-dubletten")).toContainText("liegt in „Dubletten“ – nicht gelöscht");

    // Erneut lesen: nichts Neues (abgelegte Dateien liegen nicht mehr direkt im Ordner)
    await Promise.all([aktion(page), box.getByTestId("drive-lesen").click()]);
    await expect(page.getByTestId("ablage-meldung")).toContainText("Drive gelesen: 0 neue Vorschläge");

    // Papierkorb nur nach eigener Freigabe – und nur für Dubletten
    await Promise.all([aktion(page), box.getByTestId("drive-papierkorb-alle").click()]);
    await expect(page.getByTestId("ablage-meldung")).toContainText("2 Dubletten nach Freigabe in den Drive-Papierkorb verschoben (30 Tage wiederherstellbar)");
    const ende = await stand();
    expect(ende.filter((d) => d.trashed).map((d) => d.pfad)).toEqual(["rechnungen/Dubletten", "rechnungen/Dubletten"]);
    expect(ende.filter((d) => !d.trashed)).toHaveLength(6);
    const log = await sql<{ n: string }>("select count(*) n from drive_ablage where tenant_id = $1 and dateiname like $2 and papierkorb_am is not null and loeschen_freigegeben_von is not null", [T, `%${m}%`]);
    expect(log[0].n).toBe("2");
  });
});
