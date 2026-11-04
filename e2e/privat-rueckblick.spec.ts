// B16: Wochenrückblick privat vollständig (feierabend rueckblick + mit_privat), Therapie-Bogen seit letzter Sitzung,
// Beobachtungen mit drei Feldern bearbeiten/löschen (UI + privat_eintrag_aendern/_loeschen, 7 Tage rückgängig).
// Nur mit Privat-Freigabe und vollem Umfang; das Protokoll enthält keine Inhalte. Erfundene Texte.
import { aktion, alsPerson, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const HEUTE = berlin(new Date());
const dmy = (iso: string) => iso.split("-").reverse().join(".");

type Eintrag = { id: string; art: string; daten: Record<string, unknown> };

test.describe("Privat – Wochenrückblick und Therapie-Bogen (B16)", () => {
  test("Beobachtung anlegen (3 Felder), Rückblick privat, Therapie-Bogen, ändern, löschen, rückgängig", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true, privat: true });
    const tools = await mcp.tools();
    expect(tools).toEqual(expect.arrayContaining(["privat_eintrag_aendern", "privat_eintrag_loeschen", "feierabend"]));
    const json = async <T,>(name: string, args: Record<string, unknown>) => {
      const out = await mcp.call(name, args);
      try {
        return JSON.parse(out) as T;
      } catch {
        throw new Error(`${name}: ${out}`);
      }
    };
    const beobachtung = async () => (await json<{ eintraege: Eintrag[] }>("privat_eintraege", { arten: ["beobachtung"], limit: 200 })).eintraege.find((e) => String(e.daten.text).includes(m));

    // Letzte Paartherapie-Sitzung vor 10 Tagen (stattgefunden) – Beginn des Therapie-Bogens
    const sitzung = plus(HEUTE, -10);
    expect((await json<{ ok: boolean }>("privat_termin", { tag: sitzung, uhrzeit: "17:00", art: "paar", titel: `Testsitzung ${m}`, status: "stattgefunden" })).ok).toBe(true);
    // Übrige Einträge der Woche
    expect((await json<{ ok: boolean }>("privat_eintrag_anlegen", { art: "zuwendung", variante: "massage", person: "a", wert: 15, tag: plus(HEUTE, -2), text: `Testmassage ${m}` })).ok).toBe(true);
    expect((await json<{ ok: boolean }>("privat_eintrag_anlegen", { art: "danke", text: `Danke fürs Aufräumen ${m}`, tag: plus(HEUTE, -1) })).ok).toBe(true);
    expect((await json<{ ok: boolean }>("privat_eintrag_anlegen", { art: "gespraech", text: `Wochenplanung ${m}`, tag: plus(HEUTE, -1) })).ok).toBe(true);
    expect((await json<{ ok: boolean }>("privat_eintrag_anlegen", { art: "stimmung", wert: 4, tag: plus(HEUTE, -3) })).ok).toBe(true);

    // UI: Beobachtung mit den drei Feldern des Papierbogens, „[?]“ = unvollständig
    await anmelden(page, "inhaber");
    await page.goto("/privat/tagebuch#beobachtungen");
    const form = page.getByTestId("observation-form");
    await form.locator("#o-day").fill(plus(HEUTE, -1));
    await form.locator("#o-sit-neu").fill(`Abendessen ${m}`);
    await form.locator("#o-pro-neu").fill("laut geworden [?]");
    await Promise.all([aktion(page), form.locator("button[type=submit]").click()]);
    await expect(page.getByTestId("observation-form-result")).toContainText("gespeichert");
    let b = await beobachtung();
    expect(b?.daten).toMatchObject({ situation: `Abendessen ${m}`, problematik: "laut geworden [?]", text: `Abendessen ${m} | Problematik: laut geworden [?]` });
    const id = b!.id;

    // feierabend(rueckblick, mit_privat): alle Privat-Teile, Beobachtung im Bogen-Format mit Kennzeichen
    type Privat = { beobachtungen: { tag: string; situation: string; problematik: string | null; unvollstaendig: boolean }[]; zuwendung: { art: string; anzahl: number; wer: { richtung: string }[] }[]; gespraeche: { thema: string }[]; danke: { text: string }[]; stimmung: { schnitt: number | null; verlauf: unknown[] }; aufgaben: { erledigt: string[]; offen: string[] }; vergleichVorwoche: { was: string; tendenz: string }[]; therapieBogen: string; dateideen: unknown[] };
    const fa = await json<{ wochenrueckblick: { privat: Privat | null } }>("feierabend", { rueckblick: true, mit_privat: true });
    const p = fa.wochenrueckblick.privat!;
    expect(p).not.toBeNull();
    expect(p.beobachtungen.find((x) => x.situation.includes(m))).toMatchObject({ tag: plus(HEUTE, -1), problematik: "laut geworden [?]", unvollstaendig: true });
    const massage = p.zuwendung.find((z) => z.art === "massage")!;
    expect(massage.anzahl).toBeGreaterThanOrEqual(1);
    expect(massage.wer.map((w) => w.richtung)).toContain("Ina → Tom");
    expect(p.gespraeche.map((g) => g.thema)).toContain(`Wochenplanung ${m}`);
    expect(p.danke.map((d) => d.text)).toContain(`Danke fürs Aufräumen ${m}`);
    expect(p.stimmung.schnitt).not.toBeNull();
    expect(Array.isArray(p.aufgaben.erledigt) && Array.isArray(p.aufgaben.offen) && Array.isArray(p.dateideen)).toBe(true);
    expect(p.vergleichVorwoche.find((v) => v.was === "beobachtungen")?.tendenz).toBe("mehr");
    expect(p.therapieBogen).toMatch(/^https?:\/\/.+\/privat\/therapie-bogen$/);
    // Ohne Privat-Freigabe im Konnektor: kein privater Teil
    const ohne = await mcpVerbinden(browser, baseURL!, "inhaber", { write: false });
    expect(JSON.parse(await ohne.call("feierabend", { rueckblick: true, mit_privat: true })).wochenrueckblick.privat).toBeNull();

    // Feierabend-Seite mit „Privates zeigen“
    await page.goto("/kalender/feierabend?rueckblick=1&privat=1");
    await expect(page.getByTestId("fa-privat")).toBeVisible();
    const zeile = page.getByTestId("fa-beobachtung").filter({ hasText: m });
    await expect(zeile).toContainText("laut geworden [?]");
    await expect(zeile.getByTestId("fa-unvollstaendig")).toBeVisible();
    await expect(page.getByTestId("fa-zuwendung")).toContainText("Ina → Tom");
    await expect(page.getByTestId("fa-vergleich")).toContainText("Beobachtungen");
    await page.goto("/kalender/feierabend?rueckblick=1");
    await expect(page.getByTestId("fa-privat")).toHaveCount(0);

    // Therapie-Bogen: ab letzter Sitzung, Tabelle wie Papierbogen, Zeitraum wählbar
    await page.goto("/privat/therapie-bogen");
    await expect(page.locator("#ab")).toHaveValue(sitzung);
    await expect(page.getByTestId("tb-vorschlaege")).toContainText(`seit letzter Sitzung (${dmy(sitzung).slice(0, 6)})`);
    const tz = page.getByTestId("tb-zeile").filter({ hasText: m });
    await expect(tz).toContainText(dmy(plus(HEUTE, -1)));
    await expect(tz.getByTestId("tb-unvollstaendig")).toHaveText("enthält [?] – unvollständig");
    await expect(page.getByTestId("therapie-bogen").locator("th")).toHaveText(["Datum", "Situation", "Problematik", "Gewünschte Veränderung"]);
    await page.goto(`/privat/therapie-bogen?ab=${HEUTE}&bis=${HEUTE}`);
    await expect(page.getByTestId("tb-zeile").filter({ hasText: m })).toHaveCount(0);

    // privat_eintrag_aendern: ersetzt Problematik, ergänzt gewünschte Veränderung
    const ae = await json<{ ok: boolean; art: string }>("privat_eintrag_aendern", { id, problematik: "laut geworden", veraenderung: "kurz rausgehen" });
    expect(ae).toMatchObject({ ok: true, art: "beobachtung" });
    b = await beobachtung();
    expect(b?.daten).toMatchObject({ problematik: "laut geworden", veraenderung: "kurz rausgehen", text: `Abendessen ${m} | Problematik: laut geworden | Gewünschte Veränderung: kurz rausgehen` });
    expect(await mcp.call("privat_eintrag_aendern", { id })).toContain("Nichts zu ändern");
    // Protokoll ohne Inhalte; Rückgängig-Daten verschlüsselt
    const log = await sql<{ summary: string; auftrag: string | null; undo: string | null }>("select summary, auftrag, undo::text as undo from assistant_log where tool = 'privat_eintrag_aendern' and ok order by created_at desc limit 1");
    // Zusammenfassung liegt verschlüsselt in der Datenbank; lesbar nur im Assistent-Verlauf (ohne Inhalte)
    expect(log[0].summary ?? "").not.toContain(m);
    expect(log[0].auftrag).toBeNull();
    expect(log[0].undo ?? "").not.toContain(m);
    expect(log[0].undo).not.toBeNull();

    // UI: eigene Beobachtung bearbeiten
    await page.goto("/privat/tagebuch#beobachtungen");
    await page.locator("summary", { hasText: "Meine Beobachtungen" }).click();
    const li = page.getByTestId("observation-mine").filter({ hasText: m });
    await li.getByTestId("observation-edit").click();
    const ef = li.getByTestId("observation-edit-form");
    await ef.locator("textarea[name=situation]").fill(`Abendessen neu ${m}`);
    await ef.locator("textarea[name=veraenderung]").fill("");
    await Promise.all([aktion(page), ef.locator("button[type=submit]").click()]);
    await expect(ef.getByTestId("observation-edit-form-result")).toContainText("geändert");
    b = await beobachtung();
    expect(b?.daten).toMatchObject({ situation: `Abendessen neu ${m}`, text: `Abendessen neu ${m} | Problematik: laut geworden` });
    expect(b?.daten.veraenderung).toBeUndefined();

    // privat_eintrag_loeschen → weg; im Assistent-Verlauf rückgängig → wieder da (gleiche ID)
    expect(await json<{ ok: boolean }>("privat_eintrag_loeschen", { id })).toMatchObject({ ok: true });
    expect(await beobachtung()).toBeUndefined();
    await page.goto("/privat/therapie-bogen");
    await expect(page.getByTestId("tb-zeile").filter({ hasText: m })).toHaveCount(0);
    await page.goto("/assistent-verlauf");
    await expect(page.locator('[data-testid="verlauf-eintrag"][data-tool="privat_eintrag_aendern"]').filter({ hasText: "Privat-Eintrag geändert (problematik, veraenderung)" })).toHaveCount(1);
    const eintrag = page.locator('[data-testid="verlauf-eintrag"][data-tool="privat_eintrag_loeschen"]').first();
    await expect(eintrag).toContainText("Privat-Eintrag gelöscht");
    await expect(eintrag).not.toContainText(m);
    await eintrag.getByTestId("verlauf-rueckgaengig").click();
    await expect(page.getByTestId("verlauf-meldung")).toContainText("wiederhergestellt");
    b = await beobachtung();
    expect(b?.id).toBe(id);
    expect(b?.daten.situation).toBe(`Abendessen neu ${m}`);

    // Konto „nur Familie“: kommt weder an den Therapie-Bogen noch an Beobachtungen (Claude-Verbindung gibt es für
    // dieses Konto gar nicht – nach der Anmeldung landet es auf seiner Familienliste)
    const fp = await alsPerson(browser, "familie");
    await fp.goto("/privat/therapie-bogen");
    await expect(fp).toHaveURL(/nurfamilie=1/);
    await expect(fp.getByTestId("therapie-bogen")).toHaveCount(0);
    await fp.goto("/kalender/feierabend?rueckblick=1&privat=1");
    await expect(fp.getByTestId("fa-privat")).toHaveCount(0);
    await fp.context().close();
    expect(await beobachtung()).toBeDefined();

    // Aufräumen (nur eigene Testeinträge dieses Laufs)
    expect(await json<{ ok: boolean }>("privat_eintrag_loeschen", { id })).toMatchObject({ ok: true });
  });

  test("Rückblick mit frei gewähltem Zeitraum (von–bis) und Wochenrückblick bis zu einem beliebigen Tag", async ({ page, browser, baseURL }) => {
    const m = marke();
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true, privat: true });
    // Zwei Wertschätzungen weit in der Vergangenheit (dort liegen keine anderen Testdaten)
    const t1 = plus(HEUTE, -400);
    const t2 = plus(HEUTE, -395);
    for (const tag of [t1, t2]) expect(JSON.parse(await mcp.call("privat_eintrag_anlegen", { art: "danke", text: `Danke Zeitraum ${m}`, tag })).ok).toBe(true);

    await anmelden(page, "inhaber");
    await page.goto("/privat/rueckblick");
    await expect(page.getByTestId("rb-titel")).toContainText("Rückblick ");
    // Zeitraum über das Formular wählen → beide Einträge
    await page.getByTestId("rb-von").fill(plus(t1, -1));
    await page.getByTestId("rb-bis").fill(plus(t2, 1));
    await Promise.all([page.waitForURL(/von=.*bis=/), page.getByTestId("rb-zeitraum-anzeigen").click()]);
    await expect(page.getByTestId("rb-titel")).toHaveText(`Rückblick ${dmy(plus(t1, -1))} – ${dmy(plus(t2, 1))}`);
    await expect(page.getByTestId("rb-danke")).toContainText("2×");
    // Engerer Zeitraum → nur einer; vertauschte Daten werden getauscht
    await page.goto(`/privat/rueckblick?von=${plus(t2, 1)}&bis=${plus(t2, -1)}`);
    await expect(page.getByTestId("rb-titel")).toHaveText(`Rückblick ${dmy(plus(t2, -1))} – ${dmy(plus(t2, 1))}`);
    await expect(page.getByTestId("rb-danke")).toContainText("1×");
    // Zukunft wird auf heute gekürzt; „Zurück zum Monat“
    await page.goto(`/privat/rueckblick?von=${plus(HEUTE, -3)}&bis=${plus(HEUTE, 30)}`);
    await expect(page.getByTestId("rb-titel")).toHaveText(`Rückblick ${dmy(plus(HEUTE, -3))} – ${dmy(HEUTE)}`);
    await page.getByTestId("rb-zurueck-monat").click();
    await expect(page).toHaveURL(/monat=/);

    // Nähe / Intimität: Wochentage je Kalenderwoche (ohne Datum), wie Ausgeschlafen – zwei Einträge im Abstand von
    // einer Woche (gleicher Wochentag), dazwischen bzw. danach leere Wochen
    const WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const n1 = plus(HEUTE, -430);
    const n2 = plus(n1, 7);
    const wt = WT[(new Date(`${n1}T12:00:00Z`).getUTCDay() + 6) % 7];
    for (const tag of [n1, n2]) expect(JSON.parse(await mcp.call("privat_eintrag_anlegen", { art: "intim", person: "beide", wert: 4, tag })).ok).toBe(true);
    await page.goto(`/privat/rueckblick?von=${plus(n1, -1)}&bis=${plus(n1, 15)}`);
    await expect(page.getByTestId("rb-naehe")).toContainText("Nähe / Intimität: 2×");
    const wochen = (await page.getByTestId("rb-naehe-wochen").innerText()).trim();
    expect(wochen).toMatch(/^— KW \d+: (Mo|Di|Mi|Do|Fr|Sa|So|–)( · KW \d+: (Mo|Di|Mi|Do|Fr|Sa|So|–)){2,3}$/);
    expect(wochen.match(new RegExp(`: ${wt}(?= ·|$)`, "g"))).toHaveLength(2);
    expect(wochen).toContain("–");
    expect(wochen).not.toContain("×");
    expect(wochen).not.toMatch(/\d{2}\.\d{2}\./);

    // Ausgeschlafen mit Wochentagen je Woche: Sa + So in der ersten, Mi in der zweiten Woche (Person a)
    const tagNr = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
    const mo = plus(n1, -tagNr(n1) + 21);
    for (const tag of [plus(mo, 5), plus(mo, 6), plus(mo, 9)]) expect(JSON.parse(await mcp.call("privat_zeit", { art: "ausschlafen", person: "a", tag, von: "07:00", bis: "10:00", status: "stattgefunden" })).ok).toBe(true);
    await page.goto(`/privat/rueckblick?von=${mo}&bis=${plus(mo, 13)}`);
    await expect(page.getByTestId("rb-ausschlafen-a")).toHaveText(/: KW \d+: Sa, So · KW \d+: Mi$/);
    await expect(page.getByTestId("rb-ausschlafen-b")).toHaveCount(0);

    // Wochenrückblick: 7 Tage bis zu einem frei gewählten Tag (weiter zurück als die 12 Wochen der Auswahl)
    await page.goto("/privat/rueckblick/woche");
    await page.getByTestId("woche-bis").fill(t2);
    await Promise.all([page.waitForURL(new RegExp(`bis=${t2}`)), page.getByTestId("woche-datum").getByRole("button", { name: "Anzeigen" }).click()]);
    await expect(page.getByTestId("wochenrueckblick")).toContainText(`Woche ${dmy(plus(t2, -6))} – ${dmy(t2)}`);
  });
});
