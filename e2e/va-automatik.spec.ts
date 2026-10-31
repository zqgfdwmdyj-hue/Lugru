// VA-Automatik (B18) mit erfundenen Daten und dem Discord-Nachbau der Testdienste: Anspruch mit Frist in 8 Tagen →
// Thread sofort, Erinnerungen −7/−3/−1, Fallnummer im Thread → „eingereicht“, Fristtag → Ludwig, abgelaufen → verpasst
// (Liste + rote Zeile); Fall-Zentrale: Markenbeschwerde nur Ludwig, „Antwort nötig“ 120 € automatisch zur VA, 800 € erst
// Ludwig (Knopf „An die VA“), Modus „Vorschlag“; Tagesgrenze → Sammel-Thread; „Daily overview“ auf Englisch.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";
import type { Page } from "@playwright/test";

const KANAL = "800000000000000001";
type DcMsg = { id: string; channel_id: string; content: string; author: { id: string; bot?: boolean } };
type DcStand = { kanaele: { id: string; name: string; parent_id?: string }[]; nachrichten: DcMsg[] };
const dc = async (): Promise<DcStand> => (await fetch(`${TD}/__discord-va`)).json();
const alsVa = async (kanal: string, text: string) => (await (await fetch(`${TD}/__discord-va/nachricht`, { method: "POST", body: JSON.stringify({ kanal, text }) })).json()) as DcMsg;
/** Datum in Manila (Zeitzone der VA), heute + n Tage. */
const manila = (n = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + n * 86_400_000));

const eml = (o: { von?: string; betreff: string; text: string; id: string }) =>
  Buffer.from([`From: Amazon <${o.von ?? "seller-notification@amazon.de"}>`, "To: info@test-firma.example", `Subject: ${o.betreff}`, `Message-ID: <${o.id}@example.invalid>`, `Date: ${new Date().toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"));

let T = "";
let altVa: unknown = null;
const basis = (automatik: Record<string, unknown> = {}) => ({
  zeitzone: "Asia/Manila",
  // Ruhezeit aus, Uhrzeit 00:00 und alle Tage Arbeitstag: Erinnerungen/Übersicht sofort prüfbar (09:00 Manila prüft der Unit-Test).
  ruheVon: "00:00",
  ruheBis: "00:00",
  erinnerungUeberfaellig: true,
  darfEinkaufsrechnungen: true,
  sprache: "en",
  automatik: { modus: "automatisch", seit: new Date(Date.now() - 5 * 60_000).toISOString(), uhrzeit: "00:00", arbeitstage: [1, 2, 3, 4, 5, 6, 7], feiertage: [], maxThreadsTag: 30, schwelle: 500, erinnerungTage: [7, 3, 1], tagesuebersicht: true, ...automatik },
});
const vaSetzen = (va: unknown) => sql("update tenants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{va}', $2::jsonb) where id = $1", [T, JSON.stringify(va)]);
async function abgleich(page: Page) {
  await page.goto("/delegation/va");
  await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("va-abgleich").click()]);
}

test.describe("VA-Automatik (B18)", () => {
  test.beforeAll(async () => {
    [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    [{ va: altVa }] = await sql<{ va: unknown }>("select settings->'va' va from tenants where id = $1", [T]);
  });
  test.afterAll(async () => {
    if (altVa) await vaSetzen(altVa);
    else await sql("update tenants set settings = settings - 'va' where id = $1", [T]);
  });

  test("Anspruch: Thread sofort, Erinnerungen −7/−3/−1, Fallnummer → eingereicht, Daily overview, Frist verpasst → rot", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    await vaSetzen(basis());
    await sql("update va_stand set uebersicht_am = null where tenant_id = $1", [T]);
    const neuerAnspruch = async (o: { titel: string; sku: string; frist: string; typ?: string; ref?: string }) =>
      (
        await sql<{ id: string }>(
          "insert into claims (tenant_id, type, status, title, sku, fnsku, asin, quantity, unit_cost, expected_amount, reference, deadline, evidence) values ($1, $2, 'detected', $3, $4, $5, 'B0TESTVA01', 3, 15, 45, $6, $7::date, $8::jsonb) returning id",
          [T, o.typ ?? "inbound_shortage", o.titel, o.sku, `X0${m}VA`, o.ref ?? null, o.frist, JSON.stringify([{ label: "Verschickt", value: "10" }, { label: "Eingebucht", value: "7" }])],
        )
      )[0].id;
    const A = await neuerAnspruch({ titel: `Fehlmenge Sendung FBA15VA${m} (Test)`, sku: `TEST-VA-${m}`, frist: manila(8), ref: `FBA15VA${m}` });

    await anmelden(page, "inhaber");
    await abgleich(page);
    // Thread sofort (eigener Thread, Automatik), Anspruch vorgemerkt, Entscheidung protokolliert
    const [th] = await sql<{ thread_id: string; auto: boolean; status: string }>("select thread_id, auto, status from va_threads where tenant_id = $1 and claim_id = $2", [T, A]);
    expect(th).toMatchObject({ auto: true, status: "offen" });
    expect((await sql<{ status: string }>("select status from claims where id = $1", [A]))[0].status).toBe("queued");
    expect((await sql("select status, ziel, kategorie from va_automatik where tenant_id = $1 and schluessel = $2", [T, `anspruch:${A}`]))[0]).toMatchObject({ status: "gesendet", ziel: "va", kategorie: "anspruch" });
    let s = await dc();
    expect(s.kanaele.find((k) => k.id === th.thread_id)?.parent_id).toBe(KANAL);
    const kopf = s.nachrichten.find((n) => n.channel_id === th.thread_id && n.author.bot)!;
    expect(kopf.content).toContain("💶 **New reimbursement claim:");
    expect(kopf.content).toContain("Type: Inbound shipment shortage");
    expect(kopf.content).toContain(`SKU: TEST-VA-${m}`);
    expect(kopf.content).toContain(`Shipment: FBA15VA${m}`);
    expect(kopf.content).toContain("Quantity: 3 · Expected amount: €45.00");
    expect(kopf.content).toContain("(8 days left)");
    expect(kopf.content).toContain("📖 **Instructions: File reimbursement claim**");
    expect(kopf.content).toContain("reply here with the Amazon case ID");

    // Daily overview im Kanal (Englisch) mit Link zum neuen Thread – einmal am Tag
    const uebersichten = (x: DcStand) => x.nachrichten.filter((n) => n.channel_id === KANAL && n.author.bot && n.content.includes("Daily overview"));
    const ueb = uebersichten(s).pop()!;
    expect(ueb.content).toContain("🗓️ **Daily overview");
    expect(ueb.content).toContain("New since yesterday");
    expect(ueb.content).toContain(`<#${th.thread_id}>`);
    expect(ueb.content).not.toMatch(/Neu seit|Fällig|Rückfrage/);
    const anzahlUeb = uebersichten(s).length;

    // Erinnerungen an Tag −7, −3, −1 (Frist rückt näher), an anderen Tagen keine
    const erinnerungen = (x: DcStand) => x.nachrichten.filter((n) => n.channel_id === th.thread_id && n.content.includes("⏰ Reminder: claim deadline in"));
    for (const tage of [7, 5, 3, 1]) {
      await sql("update claims set deadline = $2::date where id = $1", [A, manila(tage)]);
      await sql("update va_threads set letzte_erinnerung = null where tenant_id = $1 and claim_id = $2", [T, A]);
      const vorher = erinnerungen(await dc()).length;
      await abgleich(page);
      s = await dc();
      if (tage === 5) expect(erinnerungen(s).length).toBe(vorher);
      else expect(erinnerungen(s).pop()?.content).toContain(`claim deadline in ${tage} ${tage === 1 ? "day" : "days"}`);
    }
    expect(uebersichten(s).length).toBe(anzahlUeb);

    // VA antwortet mit Fallnummer → Anspruch „eingereicht“, Thread zu, Bestätigung auf Englisch
    await alsVa(th.thread_id, "Submitted, case 12345678901 ✅");
    await abgleich(page);
    expect((await sql("select status, amazon_case_id from claims where id = $1", [A]))[0]).toMatchObject({ status: "submitted", amazon_case_id: "12345678901" });
    expect((await sql<{ status: string }>("select status from va_threads where tenant_id = $1 and claim_id = $2", [T, A]))[0].status).toBe("erledigt");
    s = await dc();
    expect(s.nachrichten.some((n) => n.channel_id === th.thread_id && n.author.bot && n.content.includes("marked as submitted (case 12345678901)"))).toBe(true);
    await page.goto(`/ansprueche/${A}`);
    await expect(page.locator("body")).toContainText("über VA (Discord)");

    // Fristtag → Info an Ludwig; abgelaufen ohne Fallnummer → verpasst, Liste an Ludwig, Zeile rot
    const B = await neuerAnspruch({ titel: `Im Lager verloren ${m} (Test)`, sku: `TEST-VB-${m}`, frist: manila(0), typ: "lost_warehouse" });
    await abgleich(page);
    const [thB] = await sql<{ thread_id: string }>("select thread_id from va_threads where tenant_id = $1 and claim_id = $2", [T, B]);
    expect(thB).toBeTruthy();
    expect((await sql<{ n: string }>("select count(*) n from meldungen where tenant_id = $1 and titel like 'Anspruch: Frist heute%' and text like $2", [T, `%${m}%`]))[0].n).toBe("1");
    await sql("update claims set deadline = $2::date where id = $1", [B, manila(-1)]);
    await abgleich(page);
    const [thB2] = await sql<{ status: string; verpasst_am: Date | null }>("select status, verpasst_am from va_threads where tenant_id = $1 and claim_id = $2", [T, B]);
    expect(thB2.status).toBe("erledigt");
    expect(thB2.verpasst_am).not.toBeNull();
    s = await dc();
    expect(s.nachrichten.some((n) => n.channel_id === thB.thread_id && n.content.includes("has passed without a case ID"))).toBe(true);
    const [liste] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key = 'va-ansprueche-verpasst' and status = 'open'", [T]);
    expect(liste.title).toContain("Premium-Support/PSTAM");
    expect(liste.notes).toContain(`Im Lager verloren ${m}`);
    await page.goto("/delegation/va");
    await expect(page.getByTestId("va-heute")).toContainText(/\d+ (Frist|Fristen) verpasst/);
    await expect(page.getByTestId("va-heute")).toHaveClass(/tag-critical/);
    await expect(page.getByTestId("va-ansprueche")).toContainText("verpasst");
    await page.goto("/kalender/feierabend");
    await expect(page.getByTestId("fa-va-text")).toContainText(/automatisch beantwortet, \d+ (Frist|Fristen) verpasst/);
    await expect(page.getByTestId("fa-va-text")).toHaveClass(/tag-critical/);

    // Claude: va_aufgaben mit Ansprüchen/Automatik, ueberblick mit der VA-Zeile (Morgenbericht)
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const r = JSON.parse(await mcp.call("va_aufgaben"));
    expect(r.automatik.modus).toBe("automatisch");
    expect(r.ansprueche.find((x: { id: string }) => x.id === A)).toMatchObject({ status: "eingereicht", fallnummer: "12345678901" });
    expect(r.ansprueche.find((x: { id: string }) => x.id === B)).toMatchObject({ status: "Frist verpasst" });
    const u = JSON.parse(await mcp.call("ueberblick"));
    expect(u.va.fristen_verpasst).toBeGreaterThanOrEqual(1);
    expect(u.va.stufe).toBe("rot");
  });

  test("Fall-Zentrale: Marke nur Ludwig, „Antwort nötig“ 120 € zur VA, 800 € erst Ludwig, Modus Vorschlag", async ({ page }) => {
    test.setTimeout(180_000);
    const m = marke();
    await vaSetzen(basis());
    const nr = (p: string) => `${p}${String(Date.now()).slice(-10)}`;
    const [fA, fB, fC] = [nr("6"), nr("5"), nr("4")];
    await anmelden(page, "inhaber");
    const hochladen = async (dateien: { name: string; buffer: Buffer }[]) => {
      await page.goto("/posteingang");
      const form = page.getByTestId("eml-upload").first();
      await form.locator("input[type=file]").setInputFiles(dateien.map((d) => ({ ...d, mimeType: "message/rfc822" })));
      await form.getByRole("button", { name: "Hochladen", exact: true }).click();
      await expect(form).toContainText(/neu/);
      await page.goto("/amazon-faelle");
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("faelle-abgleich").click()]);
    };
    await hochladen([
      { name: `m-${m}.eml`, buffer: eml({ betreff: `Markenrechtsverletzung gemeldet ${m}`, text: "Ein Rechteinhaber hat eine Beschwerde zu ASIN B0TESTVA02 eingereicht.", id: `va-m-${m}` }) },
      { name: `a-${m}.eml`, buffer: eml({ von: "sellersupport@amazon.de", betreff: `Ihre Fall-ID: ${fA} ${m}`, text: "Bitte senden Sie den Zustellnachweis. Streitwert: 120,00 €", id: `va-a-${m}` }) },
      { name: `b-${m}.eml`, buffer: eml({ von: "sellersupport@amazon.de", betreff: `Ihre Fall-ID: ${fB} ${m}`, text: "Bitte senden Sie die Rechnung. Streitwert: 800,00 €", id: `va-b-${m}` }) },
    ]);
    type V = { id: string; bereich: string; phase: string; task_id: string | null; zustaendig: string | null; betrag: string | null };
    const vorgang = async (like: string) => (await sql<V>("select id, bereich, phase, task_id, zustaendig, betrag from amazon_vorgaenge where tenant_id = $1 and titel like $2", [T, like]))[0];
    const entscheidung = async (id: string) => (await sql<{ ziel: string; status: string; grund: string; thread_id: string | null; kategorie: string }>("select ziel, status, grund, thread_id, kategorie from va_automatik where tenant_id = $1 and bezug_id = $2 order by am desc", [T, id]))[0];

    // Markenbeschwerde → nur bei Ludwig, kein Thread
    const vm = await vorgang(`Markenrechtsverletzung gemeldet ${m}%`);
    expect(vm).toMatchObject({ bereich: "marke", task_id: null, zustaendig: "ludwig" });
    expect(await entscheidung(vm.id)).toMatchObject({ ziel: "ludwig", status: "ludwig", kategorie: "marke", thread_id: null });
    // „Antwort nötig“ mit 120 € → automatisch bei der VA (Thread mit Paket)
    const va = await vorgang(`Ihre Fall-ID: ${fA}%`);
    expect(va).toMatchObject({ phase: "antwort_noetig", zustaendig: "va" });
    expect(Number(va.betrag)).toBe(120);
    const ea = await entscheidung(va.id);
    expect(ea).toMatchObject({ ziel: "va", status: "gesendet", kategorie: "fall_antwort" });
    expect(ea.thread_id).toBeTruthy();
    expect((await sql<{ auto: boolean }>("select auto from va_threads where tenant_id = $1 and thread_id = $2", [T, ea.thread_id]))[0].auto).toBe(true);
    const s = await dc();
    expect(s.kanaele.find((k) => k.id === ea.thread_id)?.parent_id).toBe(KANAL);
    // 800 € → erst Ludwig (Meldung), kein Thread
    const vb = await vorgang(`Ihre Fall-ID: ${fB}%`);
    const eb = await entscheidung(vb.id);
    expect(eb).toMatchObject({ ziel: "ludwig", status: "ludwig", thread_id: null });
    expect(eb.grund).toContain("800,00 €");
    expect(vb.task_id).toBeNull();
    expect((await sql<{ n: string }>("select count(*) n from meldungen where tenant_id = $1 and titel like 'Amazon-Fall erst bei dir%' and text like $2", [T, `%${fB}%`]))[0].n).toBe("1");

    // Fallnummer der VA im Fall-Thread → Vorgang „eingereicht“
    await alsVa(ea.thread_id!, `Answered the case, case ${fA}`);
    await abgleich(page);
    expect((await sql<{ phase: string }>("select phase from amazon_vorgaenge where id = $1", [va.id]))[0].phase).toBe("eingereicht");

    // Ludwig gibt den 800-€-Fall von Hand an die VA
    await page.goto("/delegation/va");
    const zeile = page.getByTestId("va-entscheidung").filter({ hasText: `Ihre Fall-ID: ${fB}` });
    await expect(zeile).toContainText("erst Ludwig");
    await Promise.all([page.waitForURL(/meldung=/), zeile.getByTestId("va-entscheidung-an-va").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("Fall ist bei der VA");
    expect((await entscheidung(vb.id)).status).toBe("uebernommen");
    expect((await vorgang(`Ihre Fall-ID: ${fB}%`)).task_id).toBeTruthy();

    // Modus „Vorschlag“: nichts geht von selbst an die VA, Ludwig sieht es (Liste + tägliche Aufgabe)
    await vaSetzen(basis({ modus: "vorschlag", seit: null }));
    await hochladen([{ name: `c-${m}.eml`, buffer: eml({ von: "sellersupport@amazon.de", betreff: `Ihre Fall-ID: ${fC} ${m}`, text: "Bitte senden Sie den Zustellnachweis. Streitwert: 150,00 €", id: `va-c-${m}` }) }]);
    const vc = await vorgang(`Ihre Fall-ID: ${fC}%`);
    expect(await entscheidung(vc.id)).toMatchObject({ ziel: "va", status: "vorschlag", thread_id: null });
    expect(vc.task_id).toBeNull();
    await abgleich(page);
    const [vs] = await sql<{ title: string }>("select title from tasks where tenant_id = $1 and system_key = 'va-automatik-vorschlag' and status = 'open'", [T]);
    expect(vs.title).toMatch(/VA-Automatik \(Vorschlag\): \d+ Vorg(ang|änge) w(ä|a)re/);
    await page.goto("/delegation/va");
    await expect(page.getByTestId("va-automatik-modus")).toHaveText("Vorschlag");
    await expect(page.getByTestId("va-entscheidung").filter({ hasText: `Ihre Fall-ID: ${fC}` })).toContainText("wäre an die VA gegangen");

    // Regeln je Kategorie über das Formular: Marke → an die VA, Modus bleibt Vorschlag
    const f = page.getByTestId("va-automatik-einstellungen");
    await f.locator('select[name="regel_marke"]').selectOption("va");
    await Promise.all([aktion(page), f.getByTestId("va-automatik-speichern").click()]);
    await expect(page.getByTestId("va-meldung")).toContainText("Automatik gespeichert");
    const [neu] = await sql<{ a: { modus: string; regeln: Record<string, string> } }>("select settings->'va'->'automatik' a from tenants where id = $1", [T]);
    expect(neu.a.modus).toBe("vorschlag");
    expect(neu.a.regeln.marke).toBe("va");
  });

  test("Tagesgrenze: darüber Sammel-Thread, „#n case …“ → eingereicht", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    await vaSetzen(basis({ maxThreadsTag: 0 }));
    const anspruch = async (sku: string, tage: number) =>
      (await sql<{ id: string }>("insert into claims (tenant_id, type, status, title, sku, quantity, expected_amount, deadline) values ($1, 'lost_warehouse', 'detected', $2, $3, 1, 20, $4::date) returning id", [T, `Im Lager verloren ${sku} (Test)`, sku, manila(tage)]))[0].id;
    const A = await anspruch(`TEST-SA-${m}`, 10);
    const B = await anspruch(`TEST-SB-${m}`, 12);
    await anmelden(page, "inhaber");
    await abgleich(page);
    for (const id of [A, B]) expect((await sql<{ status: string }>("select status from va_automatik where tenant_id = $1 and schluessel = $2", [T, `anspruch:${id}`]))[0].status).toBe("sammel");
    expect((await sql<{ n: string }>("select count(*) n from va_threads where tenant_id = $1 and claim_id in ($2, $3)", [T, A, B]))[0].n).toBe("0");
    const [sm] = await sql<{ thread_id: string; eintraege: { nr: number; id: string; erledigt: boolean }[] }>("select thread_id, eintraege from va_threads where tenant_id = $1 and art = 'sammel' order by created_at desc limit 1", [T]);
    const nrA = sm.eintraege.find((e) => e.id === A)!.nr;
    expect(sm.eintraege.find((e) => e.id === B)).toBeTruthy();
    let s = await dc();
    expect(s.nachrichten.some((n) => n.channel_id === sm.thread_id && n.content.includes("over the daily limit of 0 new threads"))).toBe(true);
    expect(s.nachrichten.some((n) => n.channel_id === sm.thread_id && n.content.includes(`**#${nrA} Reimbursement claim:`))).toBe(true);

    await alsVa(sm.thread_id, `#${nrA} case 11223344556`);
    await abgleich(page);
    expect((await sql("select status, amazon_case_id from claims where id = $1", [A]))[0]).toMatchObject({ status: "submitted", amazon_case_id: "11223344556" });
    expect((await sql<{ status: string }>("select status from claims where id = $1", [B]))[0].status).toBe("queued");
    s = await dc();
    expect(s.nachrichten.some((n) => n.channel_id === sm.thread_id && n.author.bot && n.content.includes(`#${nrA}: marked as submitted (case 11223344556)`))).toBe(true);
    const [nachher] = await sql<{ eintraege: { id: string; erledigt: boolean }[] }>("select eintraege from va_threads where thread_id = $1", [sm.thread_id]);
    expect(nachher.eintraege.find((e) => e.id === A)?.erledigt).toBe(true);
    expect(nachher.eintraege.find((e) => e.id === B)?.erledigt).toBe(false);
  });
});
