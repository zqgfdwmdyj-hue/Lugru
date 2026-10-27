/*
 * Ablauftests im echten Browser (Playwright) gegen den laufenden Dev-Server mit Test-KI (e2e/mock-ai.cjs).
 * Aufruf und Voraussetzungen: siehe e2e/README.md. Legt eine Test-Verteilung „E2E-Test“ an und räumt am Ende auf.
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const root = path.join(__dirname, "..");
const req = (m) => { try { return require(m); } catch { return require(path.join(execSync("npm root -g").toString().trim(), m)); } };
const { chromium } = req("playwright");
const sharp = require(path.join(root, "node_modules/sharp"));
const { Client } = require(path.join(root, "node_modules/pg"));

const env = Object.fromEntries(
  (fs.existsSync(path.join(root, ".env")) ? fs.readFileSync(path.join(root, ".env"), "utf8") : "")
    .split("\n").map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")]),
);
const BASE = process.env.E2E_BASE || "http://localhost:3100";
const PASSWORD = process.env.APP_PASSWORD || env.APP_PASSWORD;
const DB = process.env.DATABASE_URL || env.DATABASE_URL;
const TITLE = "E2E-Test";
const PAST = "2026-01-10"; // Winter, liegt in der Vergangenheit → Ergebnisse und Statistik

let failed = 0;
const ok = (cond, what, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${what}${extra ? ` – ${extra}` : ""}`); if (!cond) failed++; };
const until = async (fn, ms = 30000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 500)); } };

/** Einfache Testfotos: einfarbig mit Rauschen, jedes mit eigener Prüfsumme. */
async function photo(dir, name, rgb) {
  const w = 640, h = 640, buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { const n = (Math.random() * 40) | 0; buf[i * 3] = rgb[0] + n; buf[i * 3 + 1] = rgb[1] + n; buf[i * 3 + 2] = rgb[2] + n; }
  const file = path.join(dir, name);
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toFile(file);
  return file;
}

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const start = (await q("select now() as t"))[0].t;
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "e2e-"));
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  let eventId = null, copyId = null;
  try {
    await page.goto(`${BASE}/login`);
    await page.fill("#password", PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);

    // Vergangene Verteilung anlegen
    await page.locator("summary", { hasText: "Neue Verteilung" }).click();
    await page.fill("#ed", PAST);
    await page.fill("#ti", TITLE);
    await page.selectOption("#cf", "");
    await Promise.all([page.waitForURL(/\/verteilung\/[0-9a-f-]{36}$/), page.click("button:text-is('Anlegen')")]);
    eventId = page.url().split("/").pop();

    // 1 + 2: Vorder-/Rückseite abwechselnd, ungerade Anzahl (3 Fotos → 2 Produkte, eins mit Rückseite)
    const files = [await photo(dir, "a-vorne.jpg", [200, 60, 60]), await photo(dir, "a-hinten.jpg", [60, 200, 60]), await photo(dir, "b-vorne.jpg", [60, 60, 200])];
    await page.selectOption("#pc", "Lebensmittel").catch(() => {});
    await page.check("input[name=upload-modus] >> nth=2");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("button:text-is('Fotos auswählen')")]);
    await chooser.setFiles(files);
    const report = await page.locator(".notice-ok, .notice-warn").filter({ hasText: /Rückseite/ }).first().innerText({ timeout: 60000 });
    const items = await until(async () => { const r = await q("select i.id, i.product_id, p.image_file_id from event_items i join products p on p.id = i.product_id where i.event_id = $1 order by i.created_at, i.id", [eventId]); return r.length >= 2 && r; });
    ok(items.length === 2, "Paare: 3 Fotos ergeben 2 Produkte", `${items.length} Produkte`);
    const backs = await q("select product_id, count(*)::int as n from product_photos where product_id = any($1) group by 1", [items.map((i) => i.product_id)]);
    ok(backs.length === 1 && backs[0].n === 1, "Paare: genau ein Produkt hat die Rückseite als Infofoto");
    ok(/letzte Foto hatte keine Rückseite/.test(report), "Ungerade Anzahl: Hinweis auf fehlende Rückseite", report.replace(/\s+/g, " ").slice(0, 120));
    const [a, bItem] = [items.find((i) => backs[0] && i.product_id === backs[0].product_id) ?? items[0], items.find((i) => !backs[0] || i.product_id !== backs[0].product_id) ?? items[1]];
    await q("update products set name = 'E2E Haferkekse', variant = '200 g', category = 'Lebensmittel' where id = $1", [a.product_id]);
    await q("update products set name = 'E2E Kräutertee', variant = '20 Beutel', category = 'Tee & Nahrungsergänzung' where id = $1", [bItem.product_id]);

    // 3: Automatisch gelesenes MHD bestätigen bzw. korrigieren
    const mhd = await until(async () => (await q("select id, best_before::text as d, best_before_source as s from event_items where id = any($1) and best_before_source = 'foto-ki'", [[a.id, bItem.id]])).length >= 1, 30000);
    if (!mhd) { // KI-Auslesen lief nicht (z. B. ohne Test-KI) → Ausgangslage direkt setzen
      console.log("  (MHD nicht automatisch gelesen – Ausgangslage wird gesetzt)");
      await q("update event_items set best_before = '2026-10-12', best_before_source = 'foto-ki' where id = any($1)", [[a.id, bItem.id]]);
    }
    await q("update event_items set best_before = coalesce(best_before, '2026-10-12'), best_before_source = 'foto-ki' where id = any($1)", [[a.id, bItem.id]]);
    await page.goto(`${BASE}/verteilung/${eventId}`);
    await page.locator(`label[for=open-${a.id}], [for=open-${a.id}]`).first().click().catch(() => page.check(`#open-${a.id}`, { force: true }));
    await page.locator(`button[value='mhd-ok:${a.id}']`).click();
    ok(await until(async () => (await q("select best_before_source s from event_items where id = $1", [a.id]))[0].s === "bestaetigt"), "MHD bestätigen: Quelle „bestätigt“");
    await page.goto(`${BASE}/verteilung/${eventId}`);
    await page.locator(`[for=open-${bItem.id}]`).first().click().catch(() => page.check(`#open-${bItem.id}`, { force: true }));
    await page.fill(`#mhd_${bItem.id}`, "2026-11-30");
    await page.locator(`#mhd_${bItem.id}`).blur();
    await page.locator("button[type=submit]", { hasText: /Speichern/ }).first().click().catch(() => {});
    const corrected = await until(async () => { const r = (await q("select best_before::text d, best_before_source s from event_items where id = $1", [bItem.id]))[0]; return r.d === "2026-11-30" && r; });
    ok(corrected && corrected.s === "manuell", "MHD korrigieren: neues Datum, Quelle „manuell“", corrected ? `${corrected.d} · ${corrected.s}` : "nicht gespeichert");

    // 6: Packungs-/Kartonempfehlung in Collage, Aushang und Messenger gleich
    await q("update event_items set price = 0.5, unit = 'stueck', pack_kind = 'karton', pack_count = 24, pack_price = 5, pack_note = null, in_collage = true, in_flyer = true where id = $1", [a.id]);
    await q("update event_items set price = 1, unit = 'packung', unit_count = 1, in_collage = true, in_flyer = true where id = $1", [bItem.id]);
    const label = "Karton (24 St.)";
    const aushang = await (await page.goto(`${BASE}/aushang/${eventId}`)).text();
    await page.goto(`${BASE}/verteilung/${eventId}/ausgabe`);
    const messenger = await page.locator("#messenger").innerText();
    const collage = await (await page.goto(`${BASE}/verteilung/${eventId}/collage`)).text();
    ok(aushang.includes(label) && /Karton \(24 St\.\)[^<]{0,12}5/.test(aushang), "Aushang zeigt „Karton (24 St.) 5 €“");
    ok(messenger.includes(`${label} 5`), "Messenger-Text zeigt „Karton (24 St.) 5 €“", messenger.split("\n").find((l) => l.includes("Haferkekse")) || "");
    ok(collage.includes(label), "Collage bekommt dieselbe Bezeichnung");

    // 4: Ergebnis speichern → neu laden → Statistik
    await q("update event_items set stock = 'kartons' where id = $1", [a.id]);
    await page.goto(`${BASE}/verteilung/${eventId}/ergebnisse?alle=1`);
    const rowA = page.locator(".outcome-row", { hasText: "E2E Haferkekse" });
    await rowA.locator("button.outcome-weg").click();
    await page.waitForLoadState("networkidle");
    await page.reload();
    ok(await page.locator(".outcome-row", { hasText: "E2E Haferkekse" }).locator("button.outcome-weg[aria-pressed=true]").count() === 1, "Ergebnis nach Neuladen gespeichert (alles weg)");
    ok((await q("select outcome from event_items where id = $1", [a.id]))[0].outcome === "weg", "Ergebnis in der Datenbank");
    await page.goto(`${BASE}/statistik?jahr=2026`);
    const renner = await page.locator("section", { hasText: "Renner" }).innerText();
    ok(renner.includes("E2E Haferkekse") && /100 % alles weg · 1 Ergebnis/.test(renner), "Statistik: Renner mit Anteil und Anzahl Ergebnisse");
    const kpi = await page.locator(".grid-kpi").innerText();
    ok(/Produktangebote/.test(kpi) && /ohne Rückmeldung/.test(kpi), "Statistik: Angebote statt Stückzahlen, „ohne Rückmeldung“ getrennt");

    // 5: Verteilung kopieren – Bestand und Ergebnisse bewusst nicht übernommen
    await page.goto(`${BASE}/`);
    await page.locator("summary", { hasText: "Neue Verteilung" }).click();
    await page.fill("#ed", "2026-01-17");
    await page.fill("#ti", `${TITLE} Kopie`);
    await page.selectOption("#cf", eventId);
    await Promise.all([page.waitForURL(/\/verteilung\/[0-9a-f-]{36}$/), page.click("button:text-is('Anlegen')")]);
    copyId = page.url().split("/").pop();
    const copied = (await q("select price::float, pack_kind, pack_count, pack_price::float, stock, outcome, best_before from event_items where event_id = $1 and product_id = $2", [copyId, a.product_id]))[0];
    ok(copied && copied.price === 0.5 && copied.pack_kind === "karton" && copied.pack_count === 24 && copied.pack_price === 5, "Kopie übernimmt Preis und Packungsangabe");
    ok(copied && copied.stock === null && copied.outcome === null && copied.best_before === null, "Kopie übernimmt Bestand, Ergebnis und MHD nicht");

    ok(errors.length === 0, "keine Fehler im Browser", errors.slice(0, 3).join(" | "));
  } catch (e) {
    failed++;
    console.error("✗ Abbruch:", e.message);
    await page.screenshot({ path: path.join(dir, "fehler.png"), fullPage: true }).catch(() => {});
    console.error("  Bildschirmfoto:", path.join(dir, "fehler.png"));
  } finally {
    // Aufräumen: Test-Verteilungen und nur dafür angelegte Produkte
    const ids = [eventId, copyId].filter(Boolean);
    if (ids.length && !process.env.E2E_KEEP) {
      const prods = (await q("select distinct product_id from event_items where event_id = any($1)", [ids])).map((r) => r.product_id);
      await q("delete from events where id = any($1)", [ids]);
      await q("delete from products p where p.id = any($1) and p.created_at >= $2 and not exists (select 1 from event_items i where i.product_id = p.id)", [prods, start]);
    }
    await b.close();
    await db.end();
    console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nAlle Abläufe in Ordnung");
    process.exit(failed ? 1 : 0);
  }
})();
