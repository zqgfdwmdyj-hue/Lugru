// VA über Discord (B7 Teil 1) gegen den Discord-Nachbau der Testdienste. VA = Konto „buero“, Discord-IDs erfunden.
// Abnahmen: zuweisen → Thread mit Anleitung, ✅ → erledigt; Rechnungsfrage → Antwort mit Rechnung ohne Aufgabe für
// Ludwig; Entscheidungsfrage → Aufgabe für Ludwig, seine Antwort aus dem Tool erscheint im Thread.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

const KANAL = "800000000000000001";
const VA_ID = "700000000000000001";
type DcMsg = { id: string; channel_id: string; content: string; author: { id: string; bot?: boolean }; attachments: { filename: string }[]; erwaehnt?: string[] };
type DcStand = { kanaele: { id: string; name: string; parent_id?: string }[]; nachrichten: DcMsg[] };
const dc = async (): Promise<DcStand> => (await fetch(`${TD}/__discord-va`)).json();
const alsVa = async (kanal: string, text: string, anhang?: { name: string; inhalt: string }) => (await (await fetch(`${TD}/__discord-va/nachricht`, { method: "POST", body: JSON.stringify({ kanal, text, anhang }) })).json()) as DcMsg;
const reaktion = (nachricht: string, emoji: string) => fetch(`${TD}/__discord-va/reaktion`, { method: "POST", body: JSON.stringify({ nachricht, emoji }) });

test.describe("VA über Discord", () => {
  test("Aufgabe → Thread mit Anleitung, Datei, ✅ · Rechnung automatisch · Frage → Ludwig antwortet im Thread", async ({ page, browser, baseURL }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ id: BUERO }] = await sql<{ id: string }>("select id from users where email = 'buero'");
    const [{ id: ANL }] = await sql<{ id: string }>(
      "insert into knowledge_entries (tenant_id, kind, category, title, origin, anleitung) values ($1, 'anleitung', 'Anleitungen', $2, 'anleitung', $3) returning id",
      [T, `Testanleitung Remission ${m}`, JSON.stringify({ zweck: "Erfundene Testanleitung", wann: "bei Remissionen", wer: "Assistenz", schritte: ["Bericht öffnen", `Pakete zählen ${m}`], zugaenge: [], fehler: [], aufgabenTypen: [`titel:va-test ${m}`] })],
    );
    const [{ id: TASK }] = await sql<{ id: string }>("insert into tasks (tenant_id, title, notes, due_date, priority, category) values ($1, $2, 'Erfundene Testaufgabe', current_date, 'normal', 'eigene') returning id", [T, `VA-Test ${m} Remission prüfen`]);

    await anmelden(page, "inhaber");
    await page.goto("/delegation/va");
    await expect(page.getByTestId("va-status")).toContainText("Bea Büro");

    // 1) Zuweisen → eigener Thread mit Titel, Frist, Anleitung, Notiz, Erwähnung der VA
    await page.getByTestId("va-aufgabe-wahl").selectOption(TASK);
    await page.locator('[data-testid="va-geben"] textarea[name="notiz"]').fill(`Bitte heute ${m}`);
    await Promise.all([aktion(page), page.getByTestId("va-geben-senden").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("Thread im VA-Kanal angelegt");
    const [t1] = await sql<{ assignee_id: string; anleitung_ids: string[] }>("select assignee_id, anleitung_ids from tasks where id = $1", [TASK]);
    expect(t1.assignee_id).toBe(BUERO);
    expect(t1.anleitung_ids).toContain(ANL);
    let s = await dc();
    const thread = s.kanaele.find((k) => k.parent_id === KANAL && k.name.startsWith(`VA-Test ${m}`))!;
    expect(thread).toBeTruthy();
    const start = s.nachrichten.find((n) => n.channel_id === thread.id && n.author.bot)!;
    expect(start.content).toContain(`<@${VA_ID}>`);
    expect(start.content).toContain(`📖 **Anleitung: Testanleitung Remission ${m}**`);
    expect(start.content).toContain(`2. Pakete zählen ${m}`);
    expect(start.content).toContain(`Bitte heute ${m}`);
    expect(start.erwaehnt).toEqual([VA_ID]);

    // VA schickt ein Foto (Datei) in den Thread → hängt an der Aufgabe; dann ✅ → Aufgabe erledigt
    await alsVa(thread.id, "Foto vom Paket", { name: `paket-${m}.txt`, inhalt: `Testinhalt ${m}` });
    await reaktion(start.id, "✅");
    await Promise.all([aktion(page), page.getByTestId("va-abgleich").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("1 erledigt");
    const [t2] = await sql<{ status: string; notes: string }>("select status, notes from tasks where id = $1", [TASK]);
    expect(t2.status).toBe("done");
    expect(t2.notes).toContain(`📎 paket-${m}.txt: /datei/`);
    const datei = /\/datei\/([0-9a-f-]{36})/.exec(t2.notes)![1];
    expect(await (await page.request.get(`/datei/${datei}`)).text()).toBe(`Testinhalt ${m}`);
    s = await dc();
    expect(s.nachrichten.some((n) => n.channel_id === thread.id && n.author.bot && n.content.includes("als erledigt abgehakt"))).toBe(true);

    // 2) „Brauche die Rechnung für Nike B0999B7CCM“ → Antwort mit Rechnung im Thread (≤ 1 Minute), keine Aufgabe
    const [p] = await sql<{ id: string }>("insert into products (tenant_id, asin, title) values ($1, 'B0999B7CCM', 'Nike Testschuh (erfunden)') on conflict (tenant_id, asin) do update set title = excluded.title returning id", [T]);
    const [lot] = await sql<{ id: string }>("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date, 5, '20.00') returning id", [T, p.id, `TEST-NIKE-${m}`]);
    const [inv] = await sql<{ id: string }>(
      "insert into invoices (tenant_id, source, file_name, file_id, kind, status, doc_type, invoice_date, invoice_number, vendor, total_gross) values ($1, 'upload', $2, $3, 'goods', 'matched', 'rechnung', current_date - 10, $4, 'Testlieferant GmbH (erfunden)', '119.00') returning id",
      [T, `RE-TEST-${m}.pdf`, datei, `RE-TEST-${m}`],
    );
    await sql("insert into invoice_lots (tenant_id, invoice_id, lot_id, matched_by) values ($1, $2, $3, 'manual')", [T, inv.id, lot.id]);
    const frage = await alsVa(KANAL, "Brauche die Rechnung für Nike B0999B7CCM");
    const t0 = Date.now();
    await Promise.all([aktion(page), page.getByTestId("va-abgleich").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("1 automatisch beantwortet");
    s = await dc();
    const antwort = s.nachrichten.find((n) => n.channel_id === frage.id && n.author.bot)!;
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(antwort.content).toContain("Rechnungen für Nike B0999B7CCM: 1");
    expect(antwort.content).toContain(`Nr. RE-TEST-${m}`);
    expect(antwort.attachments.map((a) => a.filename)).toEqual([`paket-${m}.txt`]);
    expect((await sql<{ c: string }>("select count(*) c from tasks where tenant_id = $1 and title like 'VA:%Nike%'", [T]))[0].c).toBe("0");
    expect((await sql<{ auto: boolean }>("select auto_beantwortet auto from va_nachrichten where discord_id = $1", [frage.id]))[0].auto).toBe(true);

    // 3) Entscheidungsfrage → Aufgabe für Ludwig (mit Frist), Antwort aus dem Tool erscheint im Thread
    const esk = await alsVa(KANAL, `Soll ich den Fall bei Amazon nochmal eskalieren? (${m})`);
    await Promise.all([aktion(page), page.getByTestId("va-abgleich").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("1 Rückfragen");
    const [lt] = await sql<{ id: string; status: string; due_date: string | null }>("select id, status, due_date::text from tasks where tenant_id = $1 and system_key = $2", [T, `va-nachricht:${esk.id}`]);
    expect(lt.status).toBe("open");
    expect(lt.due_date).not.toBeNull();
    const karte = page.getByTestId("va-frage").filter({ hasText: `eskalieren? (${m})` });
    await karte.getByTestId("va-antwort-text").fill(`Ja, bitte eskalieren – Testantwort ${m}`);
    await Promise.all([aktion(page), karte.getByTestId("va-antwort-senden").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("Antwort ist im Thread der VA");
    s = await dc();
    const imThread = s.nachrichten.filter((n) => n.channel_id === esk.id && n.author.bot).map((n) => n.content);
    expect(imThread.some((c) => c.includes("Ist bei Ludwig angekommen"))).toBe(true);
    expect(imThread.some((c) => c.includes(`<@${VA_ID}>`) && c.includes(`Ja, bitte eskalieren – Testantwort ${m}`))).toBe(true);
    expect((await sql<{ status: string }>("select status from tasks where id = $1", [lt.id]))[0].status).toBe("done");
    await expect(page.getByTestId("va-offen")).not.toContainText(`eskalieren? (${m})`);

    // Feierabend-Zeile und Claude-Werkzeuge
    await page.goto("/kalender/feierabend");
    await expect(page.getByTestId("fa-va")).toContainText(/VA heute: \d+ erledigt, \d+ Rückfragen?, \d+ automatisch beantwortet/);
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const tools = await mcp.tools();
    expect(tools).toEqual(expect.arrayContaining(["va_aufgaben", "va_nachrichten", "va_nachricht", "aufgabe_zuweisen"]));
    const auf = JSON.parse(await mcp.call("va_aufgaben"));
    expect(auf.aufgaben.find((a: { id: string }) => a.id === TASK)?.status).toBe("erledigt");
    const nachr = JSON.parse(await mcp.call("va_nachrichten"));
    expect(nachr.nachrichten.find((n: { text: string }) => n.text.includes("Nike B0999B7CCM"))?.automatisch_beantwortet).toBe(true);
  });
});
