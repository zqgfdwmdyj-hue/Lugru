// VA-Sprache (Bauauftrag VA-Discord, Abschnitt „Sprache“): Alles an die VA auf Englisch (Glossar, Nummern
// unverändert, englische Anleitung „auto-translated“), Nachrichten der VA bei Ludwig auf Deutsch mit Original,
// Ludwigs Antwort mit englischer Vorschau. Erfundene Daten; Übersetzungen kommen vom KI-Nachbau der Testdienste.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

const KANAL = "800000000000000001";
type DcMsg = { id: string; channel_id: string; content: string; author: { id: string; bot?: boolean } };
type DcStand = { kanaele: { id: string; name: string; parent_id?: string }[]; nachrichten: DcMsg[] };
const dc = async (): Promise<DcStand> => (await fetch(`${TD}/__discord-va`)).json();
const alsVa = async (kanal: string, text: string) => (await (await fetch(`${TD}/__discord-va/nachricht`, { method: "POST", body: JSON.stringify({ kanal, text }) })).json()) as DcMsg;

test.describe("VA-Sprache", () => {
  test.afterAll(async () => {
    await sql("update users set sprache = 'de' where email = 'buero'");
  });

  test("Deutsch → Englisch an die VA, Englisch → Deutsch bei Ludwig, Antwort mit Vorschau", async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await sql("update users set sprache = 'en' where email = 'buero'");
    const [{ id: ANL }] = await sql<{ id: string }>(
      "insert into knowledge_entries (tenant_id, kind, category, title, origin, anleitung) values ($1, 'anleitung', 'Anleitungen', $2, 'anleitung', $3) returning id",
      [T, `Testanleitung Anspruch ${m}`, JSON.stringify({ zweck: "Erfundene Testanleitung", wann: "bei Fehlmengen", wer: "Assistenz", schritte: ["Bericht öffnen", "Pakete zählen"], zugaenge: [], fehler: [], aufgabenTypen: [`titel:${m.toLowerCase()} anspruch`] })],
    );
    const [{ id: TASK }] = await sql<{ id: string }>("insert into tasks (tenant_id, title, notes, priority, category) values ($1, $2, 'Erfundene Testaufgabe', 'normal', 'eigene') returning id", [T, `${m} Anspruch für Sendung FBA15M4H707G einreichen, Frist 2.11.`]);

    await anmelden(page, "inhaber");
    await page.goto("/delegation/va");
    await expect(page.getByTestId("va-einstellungen")).toContainText("Aktuell: Englisch");

    // 1) Deutsche Aufgabe → Thread auf Englisch, Sendungsnummer unverändert, englische Anleitung (automatisch übersetzt)
    await page.getByTestId("va-aufgabe-wahl").selectOption(TASK);
    await Promise.all([aktion(page), page.getByTestId("va-geben-senden").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("Thread im VA-Kanal angelegt");
    let s = await dc();
    const thread = s.kanaele.find((k) => k.parent_id === KANAL && k.name.includes("File reimbursement claim for shipment FBA15M4H707G"))!;
    expect(thread).toBeTruthy();
    const start = s.nachrichten.find((n) => n.channel_id === thread.id && n.author.bot)!;
    expect(start.content).toContain("📋 **New task:");
    expect(start.content).toContain("File reimbursement claim for shipment FBA15M4H707G, due Nov 2");
    expect(start.content).toContain("Fictional test task");
    expect(start.content).toContain("📖 **Instructions:");
    expect(start.content).toContain("(auto-translated)");
    expect(start.content).toContain("1. Open report");
    expect(start.content).toContain("When done: react ✅");
    expect(start.content).not.toMatch(/Neue Aufgabe|Fällig:|Anleitung:/);
    const [anl] = await sql<{ title_en: string; freigegeben: boolean }>("select title_en, anleitung_en_freigegeben freigegeben from knowledge_entries where id = $1", [ANL]);
    expect(anl).toMatchObject({ freigegeben: false });
    expect(anl.title_en).toContain("Test instructions");
    // Wissen: englische Fassung prüfen und freigeben
    await page.goto(`/wissen/${ANL}`);
    await expect(page.getByTestId("entry-englisch-status")).toContainText("automatisch übersetzt");
    await Promise.all([aktion(page), page.getByTestId("entry-englisch-freigeben").click()]);
    await expect(page.getByTestId("entry-englisch-status")).toContainText("freigegeben");

    // 2) Englische Nachricht der VA → bei Ludwig auf Deutsch (Aufgabe), Original aufklappbar, Fallnummer unverändert
    const frage = await alsVa(KANAL, `Can you send me the invoice for B0TESTEN${m.slice(0, 2)}? Also please check the case 22907365031.`);
    await page.goto("/delegation/va");
    await Promise.all([aktion(page), page.getByTestId("va-abgleich").click()]);
    const [vn] = await sql<{ text: string; original: string; sprache: string; ludwig_task_id: string }>("select text, original, sprache, ludwig_task_id from va_nachrichten where discord_id = $1", [frage.id]);
    expect(vn.text).toContain("Kannst du mir die Rechnung für");
    expect(vn.text).toContain("Bitte prüfe auch den Fall 22907365031.");
    expect(vn.original).toContain("Can you send me the invoice");
    expect(vn.sprache).toBe("en");
    const [lt] = await sql<{ title: string; notes: string }>("select title, notes from tasks where id = $1", [vn.ludwig_task_id]);
    expect(lt.notes).toContain("Fall 22907365031");
    expect(lt.notes).toContain("Original (EN): Can you send me the invoice");
    const karte = page.getByTestId("va-frage").filter({ hasText: "Bitte prüfe auch den Fall 22907365031" });
    await karte.getByTestId("va-original").locator("summary").click();
    await expect(karte.getByTestId("va-original")).toContainText("Also please check the case 22907365031.");
    // Der Bot bestätigt auf Englisch
    s = await dc();
    expect(s.nachrichten.some((n) => n.channel_id === frage.id && n.author.bot && n.content.includes("Ludwig has received this"))).toBe(true);

    // 3) Ludwigs Antwort: englische Vorschau anzeigen, bearbeitbar, geht auf Englisch in den Thread
    await karte.getByTestId("va-antwort-text").fill(`Ja, bitte eskalieren – Testantwort ${m}`);
    await karte.getByTestId("va-antwort-en").locator("summary").click();
    await karte.getByTestId("va-antwort-vorschau").click();
    await expect(karte.getByTestId("va-antwort-englisch")).toHaveValue(new RegExp(`Yes, please escalate – test answer ${m}`));
    await Promise.all([aktion(page), karte.getByTestId("va-antwort-senden").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("Antwort ist im Thread der VA");
    s = await dc();
    expect(s.nachrichten.some((n) => n.channel_id === frage.id && n.author.bot && n.content.includes(`Yes, please escalate – test answer ${m}`))).toBe(true);

    // 4) Claude: va_nachrichten mit deutschem Text und Original
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const r = JSON.parse(await mcp.call("va_nachrichten"));
    const n = r.nachrichten.find((x: { text: string }) => x.text.includes("22907365031"));
    expect(n.original).toMatchObject({ sprache: "en" });
  });
});
