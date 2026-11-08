// Bauauftrag Druckagent im Lager (08.11.): Agent anlegen (Token einmal), echtes Agent-Programm gegen das Seller-System
// mit nachgebautem Brother-Drucker (TCP 9100), Warteschlange/offline/Push, Papier leer, Umzug/Widerruf, Drucken vom
// iPhone, Seller-Central-PDFs, Scanner-Arbeitsplatz, Rechte. Alle SKUs, FNSKUs und Sendungsnummern erfunden.
import { createHash } from "node:crypto";
import net from "node:net";
import type { Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";
// @ts-expect-error – Programm des Druckagenten (JavaScript, läuft ohne Abhängigkeiten auf dem Arbeits-PC)
import { Agent } from "../druckagent/lugru-druckagent.mjs";

type DruckAgent = { heartbeat(): Promise<{ einstellungen?: Record<string, unknown> }>; abholen(): Promise<{ id: string; drucker: string; seiten: number; anzahl: number } | null>; auftragAusfuehren(a: unknown): Promise<void>; start(): Promise<void>; stoppen(): void; abgemeldet: boolean; einstellungen: Record<string, unknown> };

/** Nachgebauter Brother-Drucker im Netz (RAW, Port 9100): sammelt jeden Druckauftrag. */
async function drucker() {
  const auftraege: Buffer[] = [];
  const s = net.createServer((c) => {
    const teile: Buffer[] = [];
    c.on("data", (d: Buffer) => teile.push(d));
    c.on("end", () => teile.length && auftraege.push(Buffer.concat(teile)));
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  return { port: (s.address() as net.AddressInfo).port, auftraege, zu: () => new Promise((ok) => s.close(ok)) };
}

const zaehle = (b: Buffer, folge: number[]) => {
  let n = 0;
  for (let i = 0; i <= b.length - folge.length; i++) if (folge.every((x, k) => b[i + k] === x)) n++;
  return n;
};

/** Agent über die Einstellungen anlegen (Umzug: andere Agenten deaktivieren) → Token aus der einmaligen Anzeige. */
async function agentAnlegen(page: Page, name: string, umzug = true) {
  await page.goto("/einstellungen/drucker");
  await page.getByTestId("agent-name").fill(name);
  if (umzug) await page.getByTestId("agent-umzug").check();
  await Promise.all([aktion(page), page.getByTestId("agent-anlegen-los").click()]);
  await expect(page.getByTestId("agent-token-box")).toContainText(`Gerätetoken für „${name}“ – wird nur jetzt angezeigt`);
  const token = (await page.getByTestId("agent-token").innerText()).trim();
  expect(token).toMatch(/^da_[A-Za-z0-9_-]{40,}$/);
  return token;
}

const neuerAgent = (B: string, token: string, druckerListe: { name: string; modell: string; port: number }[]): DruckAgent =>
  new Agent({ server: B, token, drucker: druckerListe.map((d) => ({ name: d.name, modell: d.modell, anschluss: `tcp:127.0.0.1:${d.port}` })) }, { log: () => undefined });

const symbol = (page: Page, modell: string) => page.locator(`[data-testid="drucker-symbol"][data-modell="${modell}"]`).first();
const zeile = (page: Page, name: string) => page.locator(`[data-testid="agent-zeile"][data-name="${name}"]`);

/** Ältere wartende Aufträge (andere Prüfungen) beiseitelegen, damit der Agent genau die dieses Tests holt. */
async function warteschlangeLeeren() {
  await sql("update druck_auftraege set status = 'abgebrochen', meldung = 'Prüfung: beiseitegelegt' where status in ('wartet', 'abgeholt')");
}

async function status(id: string) {
  return (await sql<{ status: string }>("select status from druck_auftraege where id = $1", [id]))[0]?.status;
}

test.describe("Druckagent im Lager", () => {
  test("Abnahme 0/2/5c/6: Token einmal, Heartbeat online, Papier leer, offline rot + Aufträge warten, Push nach 15 Min., erneut drucken, Umzug, Widerruf", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const ql800 = await drucker();
    await warteschlangeLeeren();
    try {
      await anmelden(page, "inhaber");
      const token = await agentAnlegen(page, `Arbeits-PC ${m}`);
      // Token nur einmal: nach dem Neuladen nicht mehr sichtbar, gespeichert nur als Prüfsumme
      await page.reload();
      await expect(page.getByTestId("agent-token-box")).toHaveCount(0);
      expect(await page.locator("main").innerText()).not.toContain(token);
      const [{ token_hash }] = await sql<{ token_hash: string }>("select token_hash from druck_agenten where name = $1", [`Arbeits-PC ${m}`]);
      expect(token_hash).toBe(createHash("sha256").update(token).digest("hex"));
      await expect(zeile(page, `Arbeits-PC ${m}`)).toHaveAttribute("data-status", "offline");
      await expect(page.getByTestId("pc-einrichten")).toContainText("Windows");

      // Abnahme 0: Agent (Dienst) startet → Heartbeat mit Gerät, OS, Version, Druckerliste → online, grün
      const agent = neuerAgent(baseURL!, token, [{ name: "Brother QL-800", modell: "QL-800", port: ql800.port }]);
      await agent.heartbeat();
      await page.reload();
      await expect(zeile(page, `Arbeits-PC ${m}`)).toHaveAttribute("data-status", "online");
      await expect(zeile(page, `Arbeits-PC ${m}`).getByTestId("agent-drucker")).toContainText("QL-800");
      await expect(zeile(page, `Arbeits-PC ${m}`).getByTestId("agent-drucker-zustand")).toHaveText("bereit");
      await page.goto("/drucken");
      await expect(symbol(page, "QL-800")).toHaveAttribute("data-farbe", "gruen");

      // Abnahme 6: Drucker meldet „Papier leer“ → erscheint im Seller-System (Symbol rot + Einstellungen)
      const hb = (drucker: unknown[]) => page.request.post("/api/druckagent/heartbeat", { headers: { authorization: `Bearer ${token}` }, data: { geraet: `LAGER-PC-${m}`, os: "Windows 11", version: "1.0.0", drucker } });
      expect((await hb([{ name: "Brother QL-800", modell: "QL-800", zustand: "papier_leer", fehler: ["Etikettenrolle leer"] }])).ok()).toBe(true);
      await page.reload();
      await expect(symbol(page, "QL-800")).toHaveAttribute("data-farbe", "rot");
      await expect(symbol(page, "QL-800")).toHaveAttribute("title", `QL-800: Papier leer (Etikettenrolle leer) – LAGER-PC-${m}`);
      await page.goto("/einstellungen/drucker");
      await expect(zeile(page, `Arbeits-PC ${m}`).getByTestId("agent-drucker-zustand")).toContainText("Etikettenrolle leer");
      await agent.heartbeat(); // wieder bereit

      // Abnahme 0/2: PC aus (kein Heartbeat seit 5 Min.) → rot „nicht erreichbar seit …“, Druckauftrag wartet
      await sql("update druck_agenten set letzter_kontakt = now() - interval '5 minutes' where name = $1", [`Arbeits-PC ${m}`]);
      await page.goto("/drucken?vorlage=fnsku&e_fnsku=X00TEST0001&e_titel=Testsocken%20(erfunden)");
      await expect(symbol(page, "QL-800")).toHaveAttribute("data-farbe", "rot");
      await expect(symbol(page, "QL-800")).toHaveAttribute("title", /nicht erreichbar seit .* – Aufträge warten/);
      await expect(page.getByTestId("druck-vorschau")).toBeVisible();
      await page.getByTestId("druck-anzahl").fill("2");
      await Promise.all([page.waitForURL(/druck=/), page.getByTestId("druck-los").click()]);
      await expect(page.getByTestId("druck-meldung")).toContainText("2× FNSKU-Etikett an QL-800 gesendet.");
      const erste = page.getByTestId("druck-auftrag").first();
      await expect(erste).toHaveAttribute("data-status", "wartet");
      const id1 = (await erste.getAttribute("data-id"))!;

      // Push, wenn ein Auftrag > 15 Min. wartet (Hintergrund alle 2 Min.; hier „Wartende prüfen“), genau einmal
      await sql("update druck_auftraege set created_at = now() - interval '20 minutes' where id = $1", [id1]);
      const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from druck_auftraege where id = $1", [id1]);
      const vorher = (await sql<{ n: number }>("select count(*)::int n from meldungen where tenant_id = $1 and art = 'druck'", [T]))[0].n;
      await Promise.all([page.waitForURL(/druck=/), page.getByTestId("druck-pruefen").click()]);
      await expect(page.getByTestId("druck-meldung")).toContainText("Geprüft: 1 Push gesendet");
      const pushs = await sql<{ titel: string; text: string; link: string }>("select titel, text, link from meldungen where tenant_id = $1 and art = 'druck' order by created_at desc", [T]);
      expect(pushs.length).toBe(vorher + 1);
      expect(pushs[0].titel).toBe("🖨️ 1 Druckauftrag wartet seit 15 Min.");
      expect(pushs[0].text).toMatch(/nicht erreichbar seit/);
      expect(pushs[0].link).toBe("/drucken");
      await Promise.all([page.waitForURL(/druck=/), page.getByTestId("druck-pruefen").click()]);
      await expect(page.getByTestId("druck-meldung")).toContainText("Geprüft: 0 Push gesendet");

      // PC wieder an → Agent holt den wartenden Auftrag, druckt (Brother-Raster an den Drucker), meldet „gedruckt“
      await agent.heartbeat();
      const a1 = await agent.abholen();
      expect(a1).toMatchObject({ id: id1, drucker: "QL-800", anzahl: 2 });
      await agent.auftragAusfuehren(a1);
      await expect.poll(() => status(id1)).toBe("gedruckt");
      const daten = ql800.auftraege.at(-1)!;
      expect([...daten.subarray(200, 206)]).toEqual([0x1b, 0x40, 0x1b, 0x69, 0x61, 0x01]);
      expect(zaehle(daten, [0x1b, 0x69, 0x7a])).toBe(2); // zwei Etiketten
      expect(daten.at(-1)).toBe(0x1a);
      await page.goto("/drucken");
      await expect(symbol(page, "QL-800")).toHaveAttribute("title", /bereit .*zuletzt gedruckt/);
      const gedruckt = page.locator(`[data-testid="druck-auftrag"][data-id="${id1}"]`);
      await expect(gedruckt).toHaveAttribute("data-status", "gedruckt");

      // Erneut drucken → neuer Auftrag in der Warteschlange (gleiche Druckdaten)
      await Promise.all([page.waitForURL(/druck=/), gedruckt.getByTestId("druck-erneut").click()]);
      await expect(page.getByTestId("druck-meldung")).toContainText("Erneut in die Warteschlange gestellt.");
      const [neu] = await sql<{ id: string; status: string; sha256: string }>("select id, status, sha256 from druck_auftraege where erneut_von = $1", [id1]);
      expect(neu.status).toBe("wartet");
      const a2 = await agent.abholen();
      expect(a2?.id).toBe(neu.id);
      await agent.auftragAusfuehren(a2);
      await expect.poll(() => status(neu.id)).toBe("gedruckt");
      expect(createHash("sha256").update(ql800.auftraege.at(-1)!).digest("hex")).toBe(neu.sha256);

      // Abnahme 5c: Umzug auf den Mini-PC – neuer Token, alter Agent „deaktiviert“ und bekommt „abgemeldet“
      const token2 = await agentAnlegen(page, `Mini-PC ${m}`, true);
      await expect(page.getByTestId("agent-token-box")).toContainText("alter Agent deaktiviert (Umzug)");
      await page.reload();
      await expect(zeile(page, `Arbeits-PC ${m}`)).toHaveAttribute("data-status", "deaktiviert");
      await expect(agent.heartbeat()).rejects.toThrow(/abgemeldet/);
      expect(agent.abgemeldet).toBe(true);
      const mini = neuerAgent(baseURL!, token2, [{ name: "Brother QL-800", modell: "QL-800", port: ql800.port }]);
      await mini.heartbeat();
      await page.reload();
      await expect(zeile(page, `Mini-PC ${m}`)).toHaveAttribute("data-status", "online");

      // Einstellungen (Ordner, Leerlauf) gehen mit dem nächsten Heartbeat an den Agenten
      const form = page.locator("section", { has: page.getByRole("heading", { name: `Mini-PC ${m}: Strom, Ordner, Leerlauf` }) }).getByTestId("agent-einstellungen");
      await form.locator('input[name="ordner"]').fill("/tmp/scans-test");
      await form.locator('input[name="leerlauf"]').fill("15");
      await Promise.all([page.waitForURL(/meldung=/), form.getByRole("button", { name: "Speichern" }).click()]);
      await mini.heartbeat();
      expect(mini.einstellungen).toMatchObject({ ordner: { pfad: "/tmp/scans-test", intervallSek: 60 }, leerlaufAusMin: 15 });

      // Widerrufen → sofort „abgemeldet“ (401)
      page.once("dialog", (d) => d.accept());
      await Promise.all([page.waitForURL(/meldung=/), zeile(page, `Mini-PC ${m}`).getByTestId("agent-widerrufen").click()]);
      await expect(zeile(page, `Mini-PC ${m}`)).toHaveAttribute("data-status", "deaktiviert");
      const r = await page.request.post("/api/druckagent/heartbeat", { headers: { authorization: `Bearer ${token2}` }, data: {} });
      expect(r.status()).toBe(401);
      expect(await r.json()).toMatchObject({ abgemeldet: true });
      expect((await page.request.get("/api/druckagent/auftrag", { headers: { authorization: "Bearer da_falsch" } })).status()).toBe(401);
    } finally {
      await ql800.zu();
    }
  });

  test("Abnahme 1: iPhone „FNSKU-Etikett 3×“ → nach ≤ 30 s aus dem QL-800 (Agent im Dauerbetrieb); Etiketten-Seite sendet auch", async ({ page, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const ql800 = await drucker();
    await warteschlangeLeeren();
    await anmelden(page, "inhaber");
    const token = await agentAnlegen(page, `Arbeits-PC iPhone ${m}`);
    const agent = neuerAgent(baseURL!, token, [{ name: "Brother QL-800", modell: "QL-800", port: ql800.port }]);
    const lauf = agent.start();
    try {
      const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
      const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
      const mk = `mk_dr${m}${"z".repeat(24)}`;
      await sql("insert into api_tokens (tenant_id, user_id, name, zweck, token_hash, anfang) values ($1, $2, $3, 'mobil', $4, $5)", [T, INH, `iPhone ${m}`, createHash("sha256").update(mk).digest("hex"), mk.slice(0, 7)]);
      expect((await page.request.post("/api/mobil/drucken", { data: { sku: "TEST-SOCKEN", anzahl: 3 } })).status()).toBe(401);
      const t0 = Date.now();
      const r = await page.request.post("/api/mobil/drucken", { headers: { Authorization: `Bearer ${mk}` }, data: { sku: "TEST-SOCKEN", anzahl: 3 } });
      expect(r.status()).toBe(200);
      const j = (await r.json()) as { ok: boolean; text: string; auftragId: string };
      expect(j).toMatchObject({ ok: true, text: "3× FNSKU-Etikett X00TEST0001 (TEST-SOCKEN) an QL-800 gesendet." });
      await expect.poll(() => status(j.auftragId), { timeout: 30_000 }).toBe("gedruckt");
      expect(Date.now() - t0).toBeLessThan(30_000);
      expect(zaehle(ql800.auftraege.at(-1)!, [0x1b, 0x69, 0x7a])).toBe(3);
      expect((await page.request.post("/api/mobil/drucken", { headers: { Authorization: `Bearer ${mk}` }, data: { sku: "GIBT-ES-NICHT" } })).status()).toBe(404);

      // Etiketten-Seite (bisher Browser-Druck): „An QL-800 im Lager senden“
      await page.goto("/etikett?skus=TEST-TASSE:2");
      await expect(page.getByTestId("etikett-senden")).toBeVisible();
      await Promise.all([page.waitForURL(/druck=/), page.getByTestId("etikett-senden-los").click()]);
      await expect(page.getByTestId("etikett-druck-meldung")).toContainText("2× FNSKU-Etikett X00TEST0002 (TEST-TASSE) an QL-800 gesendet.");
      const [t2] = await sql<{ id: string }>("select id from druck_auftraege where titel = 'FNSKU X00TEST0002 (TEST-TASSE)' order by created_at desc limit 1");
      await expect.poll(() => status(t2.id), { timeout: 30_000 }).toBe("gedruckt");
    } finally {
      agent.stoppen();
      await lauf;
      await ql800.zu();
    }
  });

  test("Abnahme 3: Seller-Central-PDF (Kartonlabels) per Drag & Drop → QL-1100 alle Seiten, Sendung zugeordnet; FNSKU-Bogen vom iPhone → QL-800", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const ql1100 = await drucker();
    const ql800 = await drucker();
    await warteschlangeLeeren();
    await anmelden(page, "inhaber");
    const token = await agentAnlegen(page, `Arbeits-PC PDF ${m}`);
    const agent = neuerAgent(baseURL!, token, [{ name: "Brother QL-1100", modell: "QL-1100", port: ql1100.port }, { name: "Brother QL-800", modell: "QL-800", port: ql800.port }]);
    await agent.heartbeat();
    try {
      const [{ tenant_id: T, id: INH }] = await sql<{ tenant_id: string; id: string }>("select m.tenant_id, u.id from users u join memberships m on m.user_id = u.id where u.email = 'inhaber'");
      const nummer = `FBA15T${m}X`;
      const [sendung] = await sql<{ id: string }>("insert into inbound_shipments (tenant_id, name, status, created_by, amazon_shipment_id) values ($1, $2, 'shipped', $3, $4) returning id", [T, `Testsendung PDF ${m}`, INH, nummer]);

      // 3 Kartonlabels 4 × 6 Zoll (wie „Drucken → Datei“ aus Seller Central)
      const doc = await PDFDocument.create();
      const f = await doc.embedFont(StandardFonts.Helvetica);
      for (let i = 1; i <= 3; i++) {
        const p = doc.addPage([288, 432]);
        p.drawText(`${nummer} U00000${i} Karton ${i} von 3`, { x: 16, y: 390, size: 12, font: f });
        p.drawRectangle({ x: 20, y: 200, width: 248, height: 120, color: rgb(0, 0, 0) });
      }
      const pdf = Buffer.from(await doc.save());
      await page.goto("/drucken/datei");
      await expect(symbol(page, "QL-1100")).toHaveAttribute("data-farbe", "gruen");
      // Drag & Drop auf die Ablagefläche
      await page.getByTestId("pdf-ablage").evaluate((el, b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], "Kartonlabels-Test.pdf", { type: "application/pdf" }));
        el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, pdf.toString("base64"));
      await expect(page.getByTestId("pdf-ablage")).toContainText("Kartonlabels-Test.pdf");
      await page.getByTestId("pdf-drucken").check();
      await Promise.all([page.waitForURL(/druck=/, { timeout: 60_000 }), page.getByTestId("pdf-los").click()]);
      await expect(page.getByTestId("pdf-ergebnis")).toContainText(`FBA-Kartonlabels: 3 Seiten, 3 Etiketten, Sendung ${nummer} → Testsendung PDF ${m} – an QL-1100 gesendet`);
      const zeilePdf = page.getByTestId("pdf-zeile").first();
      await expect(zeilePdf).toHaveAttribute("data-art", "kartonlabel");
      await expect(zeilePdf.locator(`a[href="/inbound/${sendung.id}"]`)).toBeVisible();
      const [datei] = await sql<{ inbound_shipment_id: string; sendungsnummer: string }>("select inbound_shipment_id, sendungsnummer from druck_dateien where name = 'Kartonlabels-Test.pdf' order by created_at desc limit 1");
      expect(datei).toEqual({ inbound_shipment_id: sendung.id, sendungsnummer: nummer });

      const a = await agent.abholen();
      expect(a).toMatchObject({ drucker: "QL-1100", seiten: 3 });
      await agent.auftragAusfuehren(a);
      await expect.poll(() => status(a!.id)).toBe("gedruckt");
      const daten = ql1100.auftraege.at(-1)!;
      expect(zaehle(daten, [0x1b, 0x69, 0x7a])).toBe(3); // alle Seiten
      expect(zaehle(daten, [0x67, 0x00, 162])).toBeGreaterThanOrEqual(3 * 1660); // 102 × 152 mm am QL-1100
      expect(ql800.auftraege.length).toBe(0);

      // FNSKU-Bogen A4 (27er, 4 belegt) über das Teilen-Menü am iPhone → einzelne 62-mm-Etiketten am QL-800
      const bogen = await PDFDocument.create();
      const fb = await bogen.embedFont(StandardFonts.Helvetica);
      const s = bogen.addPage([595.28, 841.89]);
      const mm = (x: number) => (x / 25.4) * 72;
      for (let i = 0; i < 4; i++) {
        const x = mm(7.25 + (i % 3) * 66) + 8;
        const yOben = mm(15.3 + Math.floor(i / 3) * 29.6);
        s.drawRectangle({ x, y: 841.89 - yOben - 40, width: 120, height: 25, color: rgb(0, 0, 0) });
        s.drawText(`X00TEST${String(i).padStart(3, "0")}`, { x, y: 841.89 - yOben - 55, size: 9, font: fb });
      }
      const mk = `mk_pd${m}${"q".repeat(24)}`;
      await sql("insert into api_tokens (tenant_id, user_id, name, zweck, token_hash, anfang) values ($1, $2, $3, 'mobil', $4, $5)", [T, INH, `iPhone PDF ${m}`, createHash("sha256").update(mk).digest("hex"), mk.slice(0, 7)]);
      const r = await page.request.post("/api/mobil/drucken", { headers: { Authorization: `Bearer ${mk}`, "content-type": "application/pdf", "x-dateiname": "FNSKU-Bogen.pdf" }, data: Buffer.from(await bogen.save()) });
      expect(r.status()).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, art: "fnsku_bogen", raster: "27", etiketten: 4 });
      const b = await agent.abholen();
      expect(b).toMatchObject({ drucker: "QL-800", seiten: 4 });
      await agent.auftragAusfuehren(b);
      await expect.poll(() => status(b!.id)).toBe("gedruckt");
      expect(zaehle(ql800.auftraege.at(-1)!, [0x1b, 0x69, 0x7a])).toBe(4);
    } finally {
      await ql1100.zu();
      await ql800.zu();
    }
  });

  test("Abnahme 4: Scanner-Arbeitsplatz – Artikel + „Drucken 5×“ → 5 Etiketten ohne Tastatur; Wareneingang mit Stellplatz; Rechte VA/nur ansehen", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const m = marke();
    const SKU = `TEST-DRUCK-${m}`;
    const FNSKU = `X00DR${m}`;
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, fnsku, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', $4, current_date, 5, '1.00')", [T, P, SKU, FNSKU]);
    try {
      await anmelden(page, "inhaber");
      await page.goto("/lager/scannen");
      await expect(page.getByTestId("steuerkarte")).toBeVisible();
      const scan = async (code: string) => {
        const vorher = await page.getByTestId("scanner-meldung").innerText().catch(() => "");
        await page.getByTestId("scanner-eingabe").fill(code); // Handscanner = Tastatur-Eingabe + Enter
        await page.getByTestId("scanner-eingabe").press("Enter");
        await expect(page.getByTestId("scanner-meldung")).not.toHaveText(vorher === "" ? /^$/ : vorher, { timeout: 15_000 });
        await expect(page.getByTestId("scanner-meldung")).not.toHaveText("…");
      };
      await scan(FNSKU);
      await expect(page.getByTestId("scanner-artikel")).toContainText(`SKU ${SKU}`);
      await scan("LUGRU-DRUCKEN-5");
      await expect(page.getByTestId("scanner-meldung")).toHaveText(`5× FNSKU-Etikett ${FNSKU} (${SKU}) an QL-800 gesendet.`);
      await expect(page.getByTestId("scanner-meldung")).toHaveAttribute("data-ok", "1");
      const [job] = await sql<{ anzahl: number; seite: string; drucker: string }>("select anzahl, seite, drucker from druck_auftraege where titel = $1", [`FNSKU ${FNSKU} (${SKU})`]);
      expect(job).toEqual({ anzahl: 5, seite: "/lager/scannen", drucker: "QL-800" });

      // Wareneingang: Steuer-Barcode, Artikel zweimal scannen (Menge 2), Stellplatz scannen → gebucht
      await scan("LUGRU-WARENEINGANG");
      await expect(page.getByTestId("scanner")).toHaveAttribute("data-modus", "wareneingang");
      await scan(FNSKU);
      await scan(FNSKU);
      await expect(page.getByTestId("scanner-meldung")).toHaveText(`${SKU}: Menge 2 (weiter scannen oder Stellplatz).`);
      await scan(`FACH-T-${m}`);
      await expect(page.getByTestId("scanner-meldung")).toHaveText(`Gebucht: 2 × ${SKU} auf Fach T-${m}.`);
      const [lager] = await sql<{ quantity: number; location: string }>("select quantity, location from own_stock where tenant_id = $1 and sku = $2", [T, SKU]);
      expect(lager).toEqual({ quantity: 2, location: `T-${m}` });
      await scan("LUGRU-ABBRECHEN");
      await expect(page.getByTestId("scanner")).toHaveAttribute("data-modus", "normal");
      await scan("LUGRU-DRUCKEN-1");
      await expect(page.getByTestId("scanner-meldung")).toHaveAttribute("data-ok", "0"); // erst Artikel scannen

      // VA: FNSKU/Retouren/DHL ja, Preisetiketten und Agent-Einstellungen nein
      const pw = `Erfunden-${m}-Passwort`;
      const [u] = await sql<{ id: string }>("insert into users (email, name, password_hash) values ($1, $2, $3) returning id", [`va-druck-${m}`, `VA Druck ${m}`, await bcrypt.hash(pw, 4)]);
      await sql("insert into memberships (tenant_id, user_id, role, areas, read_only, private_access, private_scope) values ($1, $2, 'staff', $3, false, false, 'voll')", [T, u.id, ["start", "amazon", "service"]]);
      const ctx = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" });
      const va = await ctx.newPage();
      await va.goto("/login");
      await va.fill("#email", `va-druck-${m}`);
      await va.fill("#password", pw);
      await Promise.all([va.waitForURL((x) => !x.pathname.startsWith("/login")), va.click("button[type=submit]")]);
      await va.goto("/drucken");
      const optionen = await va.getByTestId("druck-vorlage-wahl").locator("option").allInnerTexts();
      expect(optionen.some((o) => o.startsWith("FNSKU-Etikett"))).toBe(true);
      expect(optionen.some((o) => o.startsWith("Retouren-Etikett"))).toBe(true);
      expect(optionen.some((o) => o.startsWith("Preisetikett"))).toBe(false);
      await va.goto("/drucken?vorlage=preis&e_preis=9,99&e_titel=Test");
      await expect(va.getByTestId("druck-vorlage-wahl")).not.toHaveValue("preis");
      await va.goto("/einstellungen/drucker");
      await expect(va.getByTestId("agent-anlegen")).toHaveCount(0);
      await ctx.close();

      // Nur-ansehen-Konto: kein Druckknopf
      const ctx2 = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" });
      const pr = await ctx2.newPage();
      await anmelden(pr, "pruefer");
      await pr.goto("/drucken?vorlage=fnsku&e_fnsku=X00TEST0001");
      await expect(pr.getByTestId("druck-los")).toHaveCount(0);
      await ctx2.close();
    } finally {
      await warteschlangeLeeren();
      await sql("delete from own_stock where tenant_id = $1 and sku = $2", [T, SKU]);
      await sql("delete from stock_movements where tenant_id = $1 and sku = $2", [T, SKU]);
      await sql("delete from lots where tenant_id = $1 and sku = $2", [T, SKU]);
    }
  });
});
