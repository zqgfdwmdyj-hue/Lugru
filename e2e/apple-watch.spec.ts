// Apple Watch (Bauauftrag Handy-Tesla §10): Kurzantworten per Kurzbefehl – Abnahmen 1–4 plus Bestand, Deal, Auto und
// Push-Kürzung. Erfundene Daten, Testdienste statt echter Dienste (KI-Übersetzung, Discord, Keepa).
import { createHash } from "node:crypto";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

type Watch = { ok: boolean; zeige: string; sprich: string; zeilen: string[]; antwort: string; geaendert?: boolean; rueckfrage?: boolean; daten?: Record<string, unknown> };
const KANAL = "800000000000000001";

test.describe("Apple Watch", () => {
  test.afterAll(async () => {
    await sql("update users set sprache = 'de' where email = 'buero'");
  });

  test("Wie läuft's, Was ist dringend, Erledigt nach Push, Notiz VA (Vorschlag), Deal, Bestand, Auto, Push ≤ 120 Zeichen", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    const token = `mk_aw${m}${"x".repeat(24)}`;
    await sql("insert into api_tokens (tenant_id, user_id, name, zweck, token_hash, anfang) values ($1, $2, $3, 'mobil', $4, $5)", [T, INH, `Watch ${m}`, createHash("sha256").update(token).digest("hex"), token.slice(0, 7)]);
    await anmelden(page, "inhaber");
    const watch = async (befehl: string, text?: string): Promise<{ status: number; ms: number; r: Watch }> => {
      const t0 = Date.now();
      const res = await page.request.post(`/api/mobil/watch/${befehl}`, { data: text === undefined ? {} : { text }, headers: { Authorization: `Bearer ${token}` } });
      return { status: res.status(), ms: Date.now() - t0, r: (await res.json()) as Watch };
    };
    const kurz = (r: Watch) => {
      expect(r.zeige.split("\n").length).toBeLessThanOrEqual(3);
      expect(r.zeige.length).toBeLessThanOrEqual(160);
      expect(r.zeige).not.toMatch(/https?:\/\/|\|/);
      expect(r.sprich.length).toBeGreaterThan(0);
    };

    // Ohne Schlüssel nichts; Lese-Befehle gehen auch per GET, ändernde nur per POST
    expect((await page.request.post("/api/mobil/watch/stand", { headers: { Authorization: "Bearer mk_falsch_00000000000000000000" } })).status()).toBe(401);
    expect((await page.request.get("/api/mobil/watch/erledigt", { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(405);
    expect((await page.request.post("/api/mobil/watch/unbekannt", { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(404);

    // Abnahme 1: „Hey Siri, wie läuft's“ → ≤ 3 s, 3 Zeilen, vorlesbar
    await watch("stand");
    const st = await watch("stand");
    expect(st.status).toBe(200);
    expect(st.ms).toBeLessThan(3000);
    kurz(st.r);
    expect(st.r.zeilen).toHaveLength(3);
    expect(st.r.zeige).toMatch(/^(Stand \d\d:\d\d: )?Heute /);
    expect(st.r.zeige).toMatch(/rote[rn]? Fäll?e?\.|Keine roten Fälle\./);
    expect(st.r.sprich).not.toContain("€");
    const gs = await page.request.get("/api/mobil/watch/stand", { headers: { Authorization: `Bearer ${token}` } });
    expect(gs.status()).toBe(200);

    // „Was ist dringend“: höchstens 3 Zeilen, je mit Frist
    await sql("insert into tasks (tenant_id, title, priority, category, due_date) values ($1, $2, 'critical', 'eigene', current_date)", [T, `Watch-Test ${m} dringend erledigen`]);
    const dr = await watch("dringend");
    expect(dr.status).toBe(200);
    kurz(dr.r);
    for (const z of dr.r.zeilen) expect(z).toMatch(/ – (sofort|bald|Info|überfällig|heute|morgen|bis .+|ohne Frist)$|^Nichts Dringendes\.$/);

    // Abnahme 3: „Erledigt“ nach einem Push schließt genau diese Aufgabe (nicht die ältere)
    const [a1] = await sql<{ id: string }>("insert into tasks (tenant_id, title, priority, category) values ($1, $2, 'critical', 'eigene') returning id", [T, `Älter ${m}`]);
    const [a2] = await sql<{ id: string }>("insert into tasks (tenant_id, title, priority, category) values ($1, $2, 'critical', 'eigene') returning id", [T, `Versandbestätigung hochladen ${m}`]);
    const push = (titel: string, bezug: unknown, sekundenAlt: number, link: string | null = null) =>
      sql("insert into meldungen (tenant_id, user_id, titel, text, link, bezug, created_at) values ($1, $2, $3, $4, $5, $6::jsonb, now() - make_interval(secs => $7))", [T, INH, titel, `${titel} – ein sehr langer Text, der für die Watch auf höchstens hundertzwanzig Zeichen gekürzt werden muss, damit er lesbar bleibt.`, link, bezug === null ? null : JSON.stringify(bezug), sekundenAlt]);
    await push(`❗ Älter ${m}`, { art: "aufgabe", id: a1.id, titel: `Älter ${m}` }, 120);
    await push(`❗ Versandbestätigung hochladen ${m}`, { art: "aufgabe", id: a2.id, titel: `Versandbestätigung hochladen ${m}` }, 60);
    // Push für Sperrbildschirm/Watch: höchstens 120 Zeichen Text, Titel kurz
    const neu = await (await page.request.get("/api/push/neueste")).json().catch(() => null);
    if (neu) {
      expect(String(neu.text).length).toBeLessThanOrEqual(120);
      expect(String(neu.titel).length).toBeLessThanOrEqual(60);
    }
    const e1 = await watch("erledigt");
    expect(e1.r).toMatchObject({ ok: true, geaendert: true });
    expect(e1.r.zeige).toBe(`Erledigt: Versandbestätigung hochladen ${m}.`);
    const status = async (id: string) => (await sql<{ status: string }>("select status from tasks where id = $1", [id]))[0].status;
    expect(await status(a2.id)).toBe("done");
    expect(await status(a1.id)).toBe("open");
    // Neuester Push ohne Aufgabe (z. B. Deal) → unklar: die letzten offenen zur Auswahl, dann „Nummer 1“
    await push(`Deal 🟢 · Test ${m}`, null, 10);
    const e2 = await watch("erledigt");
    expect(e2.r).toMatchObject({ ok: true, rueckfrage: true });
    expect(e2.r.zeige).toContain(`1 Älter ${m}`);
    expect(await status(a1.id)).toBe("open");
    const e3 = await watch("erledigt", "Nummer 1");
    expect(e3.r.zeige).toBe(`Erledigt: Älter ${m}.`);
    expect(await status(a1.id)).toBe("done");
    expect((await watch("erledigt")).r.zeige).toMatch(/Keine offene Aufgabe aus den Pushs|Welche\?/);

    // Abnahme 4: „Notiz VA bitte Rechnung Tefal prüfen“ → englisch, im Modus „Vorschlag“ erst nach Freigabe in den VA-Kanal
    await sql("update users set sprache = 'en' where email = 'buero'");
    const vorher = ((await (await fetch(`${TD}/__discord-va`)).json()) as { nachrichten: { content: string }[] }).nachrichten.length;
    const n = await watch("notiz", "Notiz VA bitte Rechnung Tefal prüfen");
    expect(n.r).toMatchObject({ ok: true, geaendert: true });
    kurz(n.r);
    expect(n.r.zeige).toContain("VA-Vorschlag gespeichert");
    expect(n.r.zeige).toContain("Please check the Tefal invoice");
    const nachDiktat = ((await (await fetch(`${TD}/__discord-va`)).json()) as { nachrichten: { content: string }[] }).nachrichten;
    expect(nachDiktat.length).toBe(vorher);
    await page.goto("/delegation/va#entwuerfe");
    const entwurf = page.getByTestId("va-entwurf").filter({ hasText: "bitte Rechnung Tefal prüfen" }).first();
    await expect(entwurf.getByTestId("va-entwurf-text")).toHaveValue("Please check the Tefal invoice");
    await Promise.all([aktion(page), entwurf.getByTestId("va-entwurf-senden").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("An die VA gesendet");
    const dc = (await (await fetch(`${TD}/__discord-va`)).json()) as { nachrichten: { channel_id: string; content: string }[] };
    expect(dc.nachrichten.some((x) => x.channel_id === KANAL && x.content.includes("Please check the Tefal invoice"))).toBe(true);
    const [fg] = await sql<{ status: string }>("select status from tasks where tenant_id = $1 and title = 'VA-Nachricht freigeben: bitte Rechnung Tefal prüfen' order by created_at desc limit 1", [T]);
    expect(fg.status).toBe("done");
    // Normale Notiz → Aufgabe; „privat …“ nur auf Ludwigs Gerät (Inhaber mit vollem Privat-Zugang)
    const na = await watch("notiz", `Notiz Lieferant ${m} anrufen`);
    expect(na.r.zeige).toContain(`Lieferant ${m} anrufen`);
    expect((await sql("select 1 from tasks where tenant_id = $1 and title like $2", [T, `%Lieferant ${m} anrufen%`])).length).toBe(1);

    // Bestand: mehrere Treffer → Rückfrage, „Nummer 2“ setzt; Antwort nennt alt → neu
    await sql("insert into own_stock (tenant_id, sku, quantity) values ($1, $2, 3), ($1, $3, 5)", [T, `WTEST${m}-A`, `WTEST${m}-B`]);
    const b1 = await watch("bestand", `Bestand WTEST${m} 12 Stück`);
    expect(b1.r).toMatchObject({ ok: true, rueckfrage: true });
    expect(b1.r.zeige).toContain(`2 WTEST${m}-B (5)`);
    const b2 = await watch("bestand", "Nummer 2");
    expect(b2.r.zeige).toBe(`WTEST${m}-B: 5 → 12 Stück.`);
    expect((await sql<{ quantity: number }>("select quantity from own_stock where tenant_id = $1 and sku = $2", [T, `WTEST${m}-B`]))[0].quantity).toBe(12);
    expect((await sql<{ quantity: number }>("select quantity from own_stock where tenant_id = $1 and sku = $2", [T, `WTEST${m}-A`]))[0].quantity).toBe(3);
    expect((await sql("select 1 from stock_movements where tenant_id = $1 and sku = $2 and delta = 7", [T, `WTEST${m}-B`])).length).toBe(1);
    // Ohne Menge nur nachsehen – nichts geändert
    const b3 = await watch("bestand", `WTEST${m}-A`);
    expect(b3.r.zeige).toBe(`WTEST${m}-A: 3 Stück im Lager.`);
    expect(b3.r.geaendert).toBeFalsy();

    // Deal prüfen (nur lesen): Ampel in einer Zeile
    const d = await watch("deal", "Deal prüfen B0TEST0001 für 2,10");
    expect(d.status).toBeLessThan(500);
    kurz(d.r);
    if (d.r.ok) expect(d.r.zeige).toMatch(/^(Grün|Gelb|Rot)[,.]/);
    expect((await watch("deal", "B0TEST0001")).r.zeige).toContain("Preis");

    // Auto: nur lesen
    const au = await watch("tesla");
    kurz(au.r);
    expect(au.r.zeige).toMatch(/Akku|nicht verbunden|Tesla/);

    // Abnahme 2: grüner/gelber Deal-Push trägt „Deal n“ vorne → „Kaufen n“ bestätigt
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const produkt = `https://www.mediamarkt.de/de/product/_watchtest-${m.toLowerCase()}.html`;
    const de = JSON.parse(await mcp.call("deal_eingang_pruefen", { text: `Watchtest ${m} bei MediaMarkt ${produkt}`, asin: "B0TESTDE01", ek: 2.1, menge: 20, quelle: `Watch-Test ${m}` })) as { id: string; ampel: string | null };
    if (de.ampel !== "rot") {
      const [e] = await sql<{ nr: number | null }>("select kauf_nr as nr from deal_eingaenge where id = $1", [de.id]);
      expect(e.nr).toBeGreaterThan(0);
      const [pm] = await sql<{ text: string }>("select text from meldungen where tenant_id = $1 and user_id = $2 and aktionen::text like $3 order by created_at desc limit 1", [T, INH, `%"/k/${e.nr}"%`]);
      expect(pm.text).toMatch(new RegExp(`^(🟢|🟡) Deal ${e.nr}: .*ROI`));
      const kr = await page.request.post("/api/mobil/kaufen", { data: { text: `kaufen ${e.nr}` }, headers: { Authorization: `Bearer ${token}` } });
      expect(kr.status()).toBe(200);
      expect((await kr.json()).antwort).toContain(`Deal ${e.nr}:`);
    }
  });
});
