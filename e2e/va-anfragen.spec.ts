// Anfragen der VA in Discord (Befund 03.11.) mit erfundenen Daten und dem Discord-Nachbau der Testdienste:
// eigener Thread der VA („INVOICE FOR REEVALUATION“, zwei ASINs) → Rechnung automatisch im Thread + Rest an Ludwig;
// „i need invoice“ im Anspruchs-Thread → Rechnung automatisch bzw. Rückfrage an Ludwig; „already … reimbursement id“
// → Aufgabe „Anspruch prüfen“, Anspruch bleibt unverändert; Liefernachweis → Ludwig; Threads ohne Hinweis im Kanal
// (aktiv und archiviert) werden gefunden; einmaliges Nachholen alter Notizen.
import { anmelden, expect, marke, sql, test } from "./helfer";
import { TD } from "./env";
import type { Page } from "@playwright/test";

const KANAL = "800000000000000001";
type DcMsg = { id: string; channel_id: string; content: string; author: { id: string; bot?: boolean } };
type DcStand = { kanaele: { id: string; name: string; parent_id?: string }[]; nachrichten: DcMsg[] };
const dc = async (): Promise<DcStand> => (await fetch(`${TD}/__discord-va`)).json();
const alsVa = async (kanal: string, text: string) => (await (await fetch(`${TD}/__discord-va/nachricht`, { method: "POST", body: JSON.stringify({ kanal, text }) })).json()) as DcMsg;
/** Die VA legt selbst einen Thread an (mit oder ohne „… hat einen Thread begonnen“ im Kanal). */
const vaThread = async (name: string, texte: string[], o: { ohneSystemnachricht?: boolean; archiviert?: boolean } = {}) =>
  (await (await fetch(`${TD}/__discord-va/thread`, { method: "POST", body: JSON.stringify({ kanal: KANAL, name, texte, ...o }) })).json()) as { thread: { id: string }; nachrichten: DcMsg[] };
const manila = (n = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + n * 86_400_000));
const botIn = (s: DcStand, thread: string) => s.nachrichten.filter((n) => n.channel_id === thread && n.author.bot).map((n) => n.content);

let T = "";
let altVa: unknown = null;
let altSprache: string | null = null;
const vaSetzen = (va: unknown) => sql("update tenants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{va}', $2::jsonb) where id = $1", [T, JSON.stringify(va)]);
async function abgleich(page: Page) {
  await page.goto("/delegation/va");
  await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("va-abgleich").click()]);
}

test.describe("VA-Anfragen in Discord", () => {
  test.beforeAll(async () => {
    [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    [{ va: altVa }] = await sql<{ va: unknown }>("select settings->'va' va from tenants where id = $1", [T]);
    // Die VA schreibt Englisch: Bot-Texte an sie auf Englisch (Sprache je Benutzer).
    [{ sprache: altSprache }] = await sql<{ sprache: string | null }>("select sprache from users where email = 'buero'");
    await sql("update users set sprache = 'en' where email = 'buero'");
  });
  test.afterAll(async () => {
    await sql("update users set sprache = $1 where email = 'buero'", [altSprache]);
    if (altVa) await vaSetzen(altVa);
    else await sql("update tenants set settings = settings - 'va' where id = $1", [T]);
  });

  test("eigene Threads, Rechnung/Nachweis, „bereits erstattet“, Meldung an Ludwig, Nachholen", async ({ page }) => {
    test.setTimeout(240_000);
    const m = marke();
    const start = new Date(Date.now() - 1000).toISOString();
    // Erfundene ASINs (B0 + 8 Zeichen): A1 mit Rechnung im System, A2 ohne.
    const A1 = `B0V${m.padStart(6, "0").slice(-6)}1`;
    const A2 = `B0V${m.padStart(6, "0").slice(-6)}2`;
    await vaSetzen({
      zeitzone: "Asia/Manila",
      ruheVon: "00:00",
      ruheBis: "00:00",
      erinnerungUeberfaellig: true,
      darfEinkaufsrechnungen: true,
      sprache: "en",
      automatik: { modus: "automatisch", seit: new Date(Date.now() - 5 * 60_000).toISOString(), uhrzeit: "00:00", arbeitstage: [1, 2, 3, 4, 5, 6, 7], feiertage: [], maxThreadsTag: 100, schwelle: 500, erinnerungTage: [7, 3, 1], tagesuebersicht: true },
    });
    const [p] = await sql<{ id: string }>("insert into products (tenant_id, asin, title) values ($1, $2, 'Testartikel VA-Anfrage (erfunden)') on conflict (tenant_id, asin) do update set title = excluded.title returning id", [T, A1]);
    const [lot] = await sql<{ id: string }>("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date, 5, '20.00') returning id", [T, p.id, `TEST-VD-${m}`]);
    const [inv] = await sql<{ id: string }>(
      "insert into invoices (tenant_id, source, file_name, kind, status, doc_type, invoice_date, invoice_number, vendor, total_gross) values ($1, 'upload', $2, 'goods', 'matched', 'rechnung', current_date - 10, $3, 'Testlieferant GmbH (erfunden)', '119.00') returning id",
      [T, `RE-VD-${m}.pdf`, `RE-VD-${m}`],
    );
    await sql("insert into invoice_lots (tenant_id, invoice_id, lot_id, matched_by) values ($1, $2, $3, 'manual')", [T, inv.id, lot.id]);
    // Nachholen erst am Ende prüfen – bis dahin als erledigt markieren.
    await sql("insert into va_stand (tenant_id, nachgeprueft_am) values ($1, now()) on conflict (tenant_id) do update set nachgeprueft_am = now()", [T]);

    await anmelden(page, "inhaber");

    // 1) Eigener Thread der VA mit zwei ASINs → Rechnung für A1 im Thread, A2 als Rückfrage an Ludwig (Aufgabe + Push)
    const t1 = await vaThread("INVOICE FOR REEVALUATION", [`I need these Invoice for open reevaluation please ${A1} ${A2}`]);
    await abgleich(page);
    const [vt1] = await sql<{ art: string; titel: string; task_id: string | null; status: string }>("select art, titel, task_id, status from va_threads where tenant_id = $1 and thread_id = $2", [T, t1.thread.id]);
    expect(vt1).toMatchObject({ art: "vom_va", titel: "INVOICE FOR REEVALUATION", status: "offen" });
    expect(vt1.task_id).not.toBeNull();
    let s = await dc();
    let bot = botIn(s, t1.thread.id);
    expect(bot.some((b) => b.includes("🧾 Here is the invoice for") && b.includes(A1) && b.includes(`No. RE-VD-${m}`))).toBe(true);
    expect(bot.some((b) => b.includes("📌 Still open:") && b.includes(`invoice for ${A2} (not in the system)`))).toBe(true);
    const [lt1] = await sql<{ title: string; notes: string; status: string; link: string }>("select title, notes, status, link from tasks where id = $1", [vt1.task_id]);
    expect(lt1.status).toBe("open");
    expect(lt1.title).toContain(`offen: Rechnung ${A2} (nicht im System)`);
    expect(lt1.notes).toContain(`Automatisch geschickt: ${A1}`);
    const push = async (titel: string) => (await sql<{ titel: string; text: string; art: string }>("select titel, text, art from meldungen where tenant_id = $1 and created_at >= $2 and titel like $3 order by created_at", [T, start, `${titel}%`]));
    expect((await push("📨 VA bittet")).length).toBeGreaterThan(0);
    expect((await push("📨 VA bittet"))[0].art).toBe("va_rueckfrage");
    await page.goto("/delegation/va");
    await expect(page.getByTestId("va-frage").filter({ hasText: A2 })).toBeVisible();

    // 2) Anspruchs-Threads (Automatik): „i need invoice“ → mit Rechnung automatisch, ohne Rechnung an Ludwig
    const anspruch = async (titel: string, asin: string) =>
      (
        await sql<{ id: string }>(
          "insert into claims (tenant_id, type, status, title, sku, fnsku, asin, quantity, unit_cost, expected_amount, reference, deadline, evidence) values ($1, 'inbound_shortage', 'detected', $2, $3, $4, $5, 4, 15, 60, $6, $7::date, '[]'::jsonb) returning id",
          [T, titel, `TEST-VD-${m}-${asin.slice(-1)}`, `X0${m}VD${asin.slice(-1)}`, asin, `FBA1TEST${m}`, manila(10)],
        )
      )[0].id;
    const C1 = await anspruch(`Fehlmenge 4 Stück ${m} A (Test)`, A1);
    const C2 = await anspruch(`Fehlmenge 4 Stück ${m} B (Test)`, A2);
    const C3 = await anspruch(`Unter EK erstattet ${m} (Test)`, A2);
    await abgleich(page);
    const thVon = async (claim: string) => (await sql<{ thread_id: string; status: string }>("select thread_id, status from va_threads where tenant_id = $1 and claim_id = $2", [T, claim]))[0];
    const [th1, th2, th3] = [await thVon(C1), await thVon(C2), await thVon(C3)];
    expect(th1 && th2 && th3).toBeTruthy();

    const bitte1 = await alsVa(th1.thread_id, "Hi, The sourcing cost not approved yet, i need invoice for fix the price first and to open the case");
    const bitte2 = await alsVa(th2.thread_id, "Hi, The sourcing cost not approved yet, i need invoice for fix the price first and to open the case");
    const erst = await alsVa(th3.thread_id, "hi, it's already be done with first reimbursement id 1234567890 at 31 July 2026");
    await abgleich(page);
    s = await dc();
    // C1: Rechnung automatisch, keine Aufgabe, Info-Push, Anspruch unverändert
    expect(botIn(s, th1.thread_id).some((b) => b.includes(`No. RE-VD-${m}`))).toBe(true);
    expect((await sql<{ auto: boolean; ludwig: string | null }>("select auto_beantwortet auto, ludwig_task_id ludwig from va_nachrichten where tenant_id = $1 and discord_id = $2", [T, bitte1.id]))[0]).toEqual({ auto: true, ludwig: null });
    expect((await push("🧾 VA: Rechnung automatisch geschickt")).some((x) => x.text.includes(A1))).toBe(true);
    expect((await sql<{ status: string }>("select status from claims where id = $1", [C1]))[0].status).toBe("queued");
    // C2: keine Rechnung im System → Rückfrage an Ludwig mit Link zum Anspruch, Hinweis im Thread
    const [n2] = await sql<{ ludwig: string | null; art: string }>("select ludwig_task_id ludwig, art from va_nachrichten where tenant_id = $1 and discord_id = $2", [T, bitte2.id]);
    expect(n2.art).toBe("rueckfrage");
    const [lt2] = await sql<{ title: string; link: string; status: string }>("select title, link, status from tasks where id = $1", [n2.ludwig]);
    expect(lt2).toMatchObject({ status: "open", link: `/ansprueche/${C2}` });
    expect(lt2.title).toContain(`Fehlmenge 4 Stück ${m} B`);
    expect(botIn(s, th2.thread_id).some((b) => b.includes("📌 Still open:") && b.includes(`invoice for ${A2}`))).toBe(true);
    expect((await thVon(C2)).status).toBe("rueckfrage");
    // C3: „bereits erstattet“ → Aufgabe „Anspruch prüfen“, Erstattungs-ID ist keine Fallnummer, Anspruch bleibt offen
    const [n3] = await sql<{ ludwig: string | null; art: string }>("select ludwig_task_id ludwig, art from va_nachrichten where tenant_id = $1 and discord_id = $2", [T, erst.id]);
    expect(n3.art).toBe("info");
    const [lt3] = await sql<{ title: string; notes: string; link: string }>("select title, notes, link from tasks where id = $1", [n3.ludwig]);
    expect(lt3.title).toBe(`Anspruch prüfen – laut VA schon erstattet: Unter EK erstattet ${m} (Test)`);
    expect(lt3.notes).toContain("Erstattungs-ID laut VA: 1234567890");
    expect(lt3.notes).toContain("wird nicht automatisch geändert");
    expect(lt3.link).toBe(`/ansprueche/${C3}`);
    expect((await sql<{ status: string; amazon_case_id: string | null }>("select status, amazon_case_id from claims where id = $1", [C3]))[0]).toEqual({ status: "queued", amazon_case_id: null });
    expect(botIn(s, th3.thread_id).some((b) => b.includes("noted that it was already reimbursed (reimbursement ID 1234567890)"))).toBe(true);
    expect((await sql<{ c: string }>("select count(*) c from claim_events where claim_id = $1 and action = 'Notiz der VA (Discord)'", [C3]))[0].c).toBe("1");

    // 3) Threads ohne Hinweis im Kanal: aktiv (Liefernachweis + Rechnung ohne ASIN) und archiviert (Frage)
    const t4 = await vaThread("NEED PROOF DELIVERY ORDER & INVOICE for answering ongoing case", [`Please send the POD and the invoice for the ongoing case ${m}`], { ohneSystemnachricht: true });
    const t5 = await vaThread(`Removal question ${m}`, [`Where should the removal order ${m} go?`], { ohneSystemnachricht: true, archiviert: true });
    await abgleich(page);
    const [vt4] = await sql<{ task_id: string | null }>("select task_id from va_threads where tenant_id = $1 and thread_id = $2", [T, t4.thread.id]);
    expect(vt4.task_id).not.toBeNull();
    const [lt4] = await sql<{ title: string; notes: string }>("select title, notes from tasks where id = $1", [vt4.task_id]);
    expect(lt4.title).toContain("Liefernachweis (POD/Lieferschein)");
    expect(lt4.title).toContain("Rechnung (keine ASIN/SKU erkannt)");
    s = await dc();
    expect(botIn(s, t4.thread.id).some((b) => b.includes("📌 Still open:") && b.includes("proof of delivery"))).toBe(true);
    const [vt5] = await sql<{ task_id: string | null }>("select task_id from va_threads where tenant_id = $1 and thread_id = $2", [T, t5.thread.id]);
    expect(vt5.task_id).not.toBeNull();
    expect((await sql<{ title: string }>("select title from tasks where id = $1", [vt5.task_id]))[0].title).toContain("VA:");

    // 4) Einmaliges Nachholen: alte Notiz der VA im Anspruchs-Thread („kindly send the invoice“) → Rechnung jetzt
    const alt = `nachholen-${m}`;
    await sql("insert into va_nachrichten (tenant_id, discord_id, kanal_id, thread_id, von, text, art, gesendet_am) values ($1, $2, $3, $3, 'va', 'kindly send the invoice so I can open the case', 'notiz', now() - interval '2 days')", [T, alt, th1.thread_id]);
    await sql("update va_stand set nachgeprueft_am = null where tenant_id = $1", [T]);
    const vorher = botIn(await dc(), th1.thread_id).filter((b) => b.includes(`No. RE-VD-${m}`)).length;
    await abgleich(page);
    expect(botIn(await dc(), th1.thread_id).filter((b) => b.includes(`No. RE-VD-${m}`)).length).toBe(vorher + 1);
    expect((await sql<{ art: string; auto: boolean }>("select art, auto_beantwortet auto from va_nachrichten where tenant_id = $1 and discord_id = $2", [T, alt]))[0]).toEqual({ art: "rueckfrage", auto: true });
    expect((await sql<{ am: Date | null }>("select nachgeprueft_am am from va_stand where tenant_id = $1", [T]))[0].am).not.toBeNull();
    // Läuft nur einmal: weitere Notiz wird nicht mehr nachgeholt
    await sql("insert into va_nachrichten (tenant_id, discord_id, kanal_id, thread_id, von, text, art, gesendet_am) values ($1, $2, $3, $3, 'va', 'kindly send the invoice again', 'notiz', now())", [T, `${alt}-2`, th1.thread_id]);
    await abgleich(page);
    expect((await sql<{ art: string }>("select art from va_nachrichten where tenant_id = $1 and discord_id = $2", [T, `${alt}-2`]))[0].art).toBe("notiz");
  });
});
