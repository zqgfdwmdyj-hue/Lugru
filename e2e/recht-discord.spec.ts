// B14 Rechtsfälle + Wissen aus Discord-Kanälen. Teil A: Asana-Fall (nur lesen) mit Status und Frist, „Bitte bis …
// Unterlagen senden“ → Aufgabe mit Vorlauf (Kalender), Anwalts-Mail mit Aktenzeichen → Fall (nicht Posteingang),
// unbekannte Anwalts-Mail → „zuordnen“ im Privatbereich, Behörden-Mail → Entwurf an den Anwalt, privater Fall nur im
// Privatbereich, Startseite nur mit Anzahl, Claude-Werkzeuge. Teil B: Bot liest nur freigegebene Kanäle, schreibt nie,
// Tageszusammenfassung + Insider-Wissen mit Link, Frühwarnung mit eigenem Abgleich, Deal → Deal-Eingang, Rohtexte nach
// 30 Tagen weg. Alles erfunden (Testdienste).
import type { Page } from "@playwright/test";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

const tagPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const eml = (o: { von: string; betreff: string; text: string; id: string }) =>
  Buffer.from([`From: ${o.von}`, "To: info@test-firma.example", `Subject: ${o.betreff}`, `Message-ID: <${o.id}@example.invalid>`, `Date: ${new Date().toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"));
const asana = (b: unknown) => fetch(`${TD}/__asana`, { method: "POST", body: JSON.stringify(b) });

async function hochladen(page: Page, dateien: { name: string; buffer: Buffer }[]) {
  await page.goto("/posteingang");
  const form = page.getByTestId("eml-upload").first();
  await form.locator("input[type=file]").setInputFiles(dateien.map((d) => ({ ...d, mimeType: "message/rfc822" })));
  await Promise.all([aktion(page), form.locator("button[type=submit]").click()]);
  await expect(form.locator(".notice")).toBeVisible();
  return (await form.locator(".notice").textContent()) ?? "";
}

test.describe("Rechtsfälle und Gruppen-Kanäle", () => {
  test("Teil A: Asana-Fall, Fristen mit Vorlauf, Anwalts-Mails, privat nur im Privatbereich, Claude", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const nr = String(Date.now()).slice(-7);
    const az = `${nr}/26`;
    const domain = `anwalt-${m.toLowerCase()}.example`;
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await anmelden(page, "inhaber");

    // Einstellungen
    await page.goto("/rechtsfaelle");
    const e = page.getByTestId("recht-einstellungen");
    await e.locator("#re-dom").fill(domain);
    await e.locator("#re-adr").fill(`kanzlei@${domain}`);
    await e.locator("#re-vor").fill("3");
    await Promise.all([aktion(page), e.locator("button[type=submit]").click()]);
    await expect(page.getByTestId("recht-meldung")).toContainText("Einstellungen gespeichert");

    // 1) Asana: geschäftlicher Fall mit Kommentar „Bitte bis … Unterlagen senden“ und privater Fall
    const g1 = `13${nr}01`;
    const g2 = `13${nr}02`;
    const frist = tagPlus(6);
    const fristPrivat = tagPlus(5);
    await asana({
      aufgaben: [
        { gid: g1, projekt: "1200000000000101", name: `Abmahnung Testmarke ${m} (Az. ${az})`, notes: "Gegner: Testfirma (erfunden)", due_on: tagPlus(20), abschnitt: "In Bearbeitung" },
        { gid: g2, projekt: "1200000000000102", name: `Mietsache ${m}`, notes: "erfunden", abschnitt: "Offen" },
      ],
      kommentare: [
        { gid: `${g1}1`, aufgabe: g1, created_at: new Date().toISOString(), text: `Bitte bis ${dmy(frist)} Unterlagen senden: Rechnungen der Testmarke ${m}.` },
        { gid: `${g2}1`, aufgabe: g2, created_at: new Date().toISOString(), text: `Frist: Stellungnahme bis ${dmy(fristPrivat)} einreichen.` },
      ],
    });
    await page.getByRole("button", { name: "Asana jetzt abgleichen" }).click();
    await expect(page.getByTestId("recht-meldung")).toContainText("Asana gelesen");
    const liste = page.getByTestId("rechtsfaelle-liste");
    await expect(liste).toContainText(`Abmahnung Testmarke ${m}`);
    await expect(liste).not.toContainText(`Mietsache ${m}`);
    await liste.getByRole("link", { name: `Abmahnung Testmarke ${m} (Az. ${az})` }).click();
    await expect(page.getByTestId("rechtsfall-status")).toHaveText("In Bearbeitung");
    await expect(page.getByTestId("rechtsfall-frist")).toContainText(dmy(frist));
    await expect(page.getByTestId("rechtsfall-amzug")).toHaveText("wir");
    const fallId = page.url().split("/").pop()!;
    // Aufgabe mit Vorlauf (3 Tage) → erscheint im Kalender; „Anwalt braucht etwas“ mit Unterlagen-Vorschlag
    const [fa] = await sql<{ due_date: string; priority: string }>("select to_char(due_date, 'YYYY-MM-DD') as due_date, priority from tasks where system_key = $1", [`recht:frist:${fallId}:${frist}`]);
    expect(fa).toMatchObject({ due_date: tagPlus(3), priority: "critical" });
    const [zug] = await sql<{ notes: string }>("select notes from tasks where tenant_id = $1 and system_key like $2", [T, `recht:zug:asana:${g1}1`]);
    expect(zug.notes).toContain("Rechnungen / Belege (/rechnungen)");

    // 2) Privater Fall nur im Privatbereich; Startseite nennt nur die Anzahl
    await page.goto("/");
    const zeile = page.locator("text=/Rechtsfristen in 7 Tagen/").first();
    await expect(zeile).toContainText(`Abmahnung Testmarke ${m}`);
    await expect(zeile).toContainText("private Rechtsfrist");
    await expect(zeile).not.toContainText(`Mietsache ${m}`);
    await page.goto("/privat/rechtsfaelle");
    await expect(page.getByTestId("rechtsfaelle-liste")).toContainText(`Mietsache ${m}`);
    const [privFall] = await sql<{ id: string }>("select id from rechtsfaelle where asana_gid = $1", [g2]);
    // Geschäfts-Ansicht liefert private Fälle nicht aus (Seite „nicht gefunden“)
    expect(await (await page.request.get(`/rechtsfaelle/${privFall.id}`)).text()).not.toContain(`Mietsache ${m}`);
    // Private Frist: private Aufgabe statt Geschäftsaufgabe
    expect((await sql("select 1 from tasks where system_key like $1", [`recht:%${privFall.id}%`])).length).toBe(0);

    // 3) Mails: Anwalt mit Aktenzeichen → Fall; unbekannte Anwalts-Mail → „zuordnen“ (privat); Behörde → Entwurf
    const antwort = await hochladen(page, [
      { name: "a.eml", buffer: eml({ von: `Kanzlei Test <kanzlei@${domain}>`, betreff: `Ihre Sache Az. ${az}`, text: `Anbei der Schriftsatz der Gegenseite. Bitte bis ${dmy(tagPlus(12))} Ihre Stellungnahme übersenden. (erfunden ${m})`, id: `ra1-${m}` }) },
      { name: "b.eml", buffer: eml({ von: `Kanzlei Test <kanzlei@${domain}>`, betreff: `Neue Angelegenheit ${m}`, text: "Wir haben ein neues Schreiben erhalten (erfunden).", id: `ra2-${m}` }) },
      { name: "c.eml", buffer: eml({ von: "Amtsgericht Teststadt <poststelle@ag-teststadt.example>", betreff: `Ladung zum Termin ${m}`, text: "Sie werden zum Termin geladen (erfunden).", id: `ag-${m}` }) },
    ]);
    expect(antwort).toMatch(/^3 neu/);
    expect((await sql("select 1 from emails where subject like $1", [`%Az. ${az}%`])).length).toBe(0);
    await page.goto(`/rechtsfaelle/${fallId}`);
    await expect(page.getByTestId("rechtsfall-verlauf")).toContainText(`Ihre Sache Az. ${az}`);
    const [zu] = await sql<{ bereich: string; status: string }>("select bereich, status from rechtsfaelle where tenant_id = $1 and quelle = 'mail' order by created_at desc limit 1", [T]);
    expect(zu).toMatchObject({ bereich: "privat", status: "zuordnen" });
    await page.goto("/privat/rechtsfaelle");
    await expect(page.getByTestId("recht-zuordnen")).toBeVisible();
    const [ag] = await sql<{ id: string }>("select id from emails where subject = $1", [`Ladung zum Termin ${m}`]);
    const [entwurf] = await sql<{ to: string; sent_at: string | null }>("select \"to\", sent_at from email_drafts where email_id = $1", [ag.id]);
    expect(entwurf).toMatchObject({ to: `kanzlei@${domain}`, sent_at: null });
    expect((await sql("select 1 from tasks where system_key = $1", [`recht:weitergeben:${ag.id}`])).length).toBe(1);

    // 4) Claude: ohne Privat-Freigabe nur geschäftlich (privat als Anzahl), mit Freigabe auch privat; Entwurf wird nie gesendet
    const c1 = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    expect(await c1.tools()).toEqual(expect.arrayContaining(["rechtsfaelle", "rechtsfall", "rechtsfristen", "rechtsfall_mail_entwurf"]));
    expect(JSON.parse(await c1.call("rechtsfaelle", { bereich: "geschaeft" })).faelle.some((f: { titel: string }) => f.titel.includes(`Testmarke ${m}`))).toBe(true);
    expect(await c1.call("rechtsfaelle", { bereich: "privat" })).toContain("nur mit Privat-Freigabe");
    const rf = JSON.parse(await c1.call("rechtsfristen", { tage: 14 }));
    expect(rf.private_fristen_anzahl).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rf)).not.toContain(`Mietsache ${m}`);
    const ent = JSON.parse(await c1.call("rechtsfall_mail_entwurf", { id: fallId, text: `Anbei die Rechnungen (Test ${m}).` }));
    expect(ent).toMatchObject({ ok: true, gesendet: false, an: `kanzlei@${domain}` });
    const c2 = await mcpVerbinden(browser, baseURL!, "inhaber", { privat: true });
    expect(JSON.parse(await c2.call("rechtsfaelle", { bereich: "privat" })).faelle.some((f: { titel: string }) => f.titel === `Mietsache ${m}`)).toBe(true);

    // Asana wurde nur gelesen
    expect(((await (await fetch(`${TD}/__asana`)).json()) as { schreibversuche: number }).schreibversuche).toBe(0);
  });

  test("Teil B: Kanäle lesen, Zusammenfassung, Insider-Wissen, Frühwarnung, Deal, 30 Tage", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const AMAZON = "820000000000000001";
    const AUS = "820000000000000003";
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    // Sauberer Ausgangspunkt: Zusammenfassung und Warnungen fällig, nur Nachrichten dieses Laufs im Fenster
    await sql("update discord_chat_stand set letzte_zusammenfassung = null, gewarnt = null where tenant_id = $1", [T]);
    await sql("delete from discord_chat where tenant_id = $1", [T]);
    const altId = `77${Date.now()}`;
    await sql("insert into discord_chat (tenant_id, kanal_id, nachricht_id, text, gesendet_am) values ($1, $2, $3, 'alt', now() - interval '40 days')", [T, AMAZON, altId]);

    const schreibe = async (kanal: string, autor: string, text: string) => (await (await fetch(`${TD}/__discord-va/nachricht`, { method: "POST", body: JSON.stringify({ kanal, autor, text }) })).json()) as { id: string };
    await schreibe(AMAZON, "710000000000000001", `Tipp ${m}: Preise immer vor dem Einkauf mit Keepa prüfen`);
    for (const [i, a] of ["710000000000000002", "710000000000000003", "710000000000000004"].entries()) await schreibe(AMAZON, a, `Bei mir wurde heute das Konto gesperrt ${m}-${i}`);
    const deal = await schreibe(AMAZON, "710000000000000005", `B0TEST0002 für 12,99 € bei Testhändler ${m}`);
    await schreibe(AUS, "710000000000000006", `Allgemeines ${m} – soll nicht gelesen werden`);

    await anmelden(page, "inhaber");
    await page.goto("/calls");
    await page.getByTestId("gruppen-kanaele").locator("summary").click();
    await Promise.all([aktion(page), page.getByTestId("gruppen-lesen").click()]);
    await expect(page.getByRole("status").first()).toContainText("1 Zusammenfassung");

    // Nur freigegebene Kanäle; der Bot schreibt nie in die Gruppe
    expect((await sql("select 1 from discord_chat where tenant_id = $1 and kanal_id = $2", [T, AUS])).length).toBe(0);
    const dc = (await (await fetch(`${TD}/__discord-va`)).json()) as { nachrichten: { channel_id: string; author: { bot?: boolean } }[] };
    expect(dc.nachrichten.some((n) => n.channel_id.startsWith("82") && n.author.bot)).toBe(false);
    // Namen gehen nicht an die KI
    const ki = (await (await fetch(`${TD}/__ki`)).json()) as { text: string }[];
    const auftrag = ki.filter((k) => k.text.startsWith("Fasse die Chat-Nachrichten")).pop()!;
    expect(auftrag.text).toContain("Nutzer A:");
    expect(auftrag.text).not.toContain("VA (Test)");

    // Tageszusammenfassung im Call-Archiv (Quelle Chat) + Insider-Wissen mit Link
    await expect(page.getByTestId("calls-liste")).toContainText("Discord-Chat (Zusammenfassung)");
    const [w] = await sql<{ title: string; body: string; insider: boolean; quelle_wer: string }>("select title, body, insider, quelle_wer from knowledge_entries where tenant_id = $1 and origin = 'chat' and title like $2", [T, `%${m}%`]);
    expect(w.insider).toBe(true);
    expect(w.quelle_wer).toBe("Gruppe · Amazon");
    expect(w.body).toContain(`https://discord.com/channels/500000000000000001/${AMAZON}/`);
    await page.goto("/wissen?herkunft=chat");
    await expect(page.locator("main")).toContainText(w.title);

    // Frühwarnung (3 Nutzer, 48 Std.) mit eigenem Abgleich
    const [warn] = await sql<{ notes: string }>("select notes from tasks where system_key = $1", [`chat-warnung:sperrwelle:${new Date().toISOString().slice(0, 10)}`]);
    expect(warn.notes).toContain("3 Nutzer");
    expect(warn.notes).toContain("Bei dir:");
    // Deal → Deal-Eingang (Quelle Gruppe · Kanal)
    const [d] = await sql<{ weg: string; quelle: string }>("select weg, quelle from deal_eingaenge where quelle_ref = $1", [`discord:${deal.id}`]);
    expect(d).toMatchObject({ weg: "gruppe", quelle: "Gruppe · Amazon" });
    // Rohtexte älter als 30 Tage gelöscht – Wissen bleibt
    expect((await sql("select 1 from discord_chat where nachricht_id = $1", [altId])).length).toBe(0);

    // Claude findet Chat-Inhalte (herkunft chat)
    const c = await mcpVerbinden(browser, baseURL!, "inhaber");
    const wi = JSON.parse(await c.call("wissen", { suche: m, herkunft: "chat" }));
    expect(wi.eintraege[0].herkunft).toMatch(/^chat/);
    const cs = JSON.parse(await c.call("calls_durchsuchen", { suche: `Tipp ${m}` }));
    expect(cs.calls.some((x: { herkunft: string }) => x.herkunft === "chat")).toBe(true);
  });
});
