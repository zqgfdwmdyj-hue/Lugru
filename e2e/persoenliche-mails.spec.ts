// B32 Persönliche Mails im Posteingang · Push mit fertigem Antwortentwurf (Abnahmen 1–4) und B32.5 Postausgang
// mitlesen (Abnahmen 5–6). Erfundene Personen und Adressen (example.com/example.invalid), Testshop, keine echten Daten.
import type { Page } from "@playwright/test";
import { TD } from "./env";
import { aktion, alsPerson, anmelden, expect, marke, mcpVerbinden, sql, test, testdienste } from "./helfer";

const eml = (o: { von: string; an?: string; betreff: string; text: string; id: string; antwortAuf?: string; kopf?: string[] }) =>
  Buffer.from(
    [
      `From: ${o.von}`,
      `To: ${o.an ?? "Ina Inhaber <ina@test-firma.example>"}`,
      `Subject: ${o.betreff}`,
      `Message-ID: <${o.id}@example.invalid>`,
      ...(o.antwortAuf ? [`In-Reply-To: ${o.antwortAuf}`, `References: ${o.antwortAuf}`] : []),
      ...(o.kopf ?? []),
      `Date: ${new Date().toUTCString()}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      o.text,
    ].join("\r\n"),
  );
const tagPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const EIGEN = "ina@test-firma.example";

async function hochladen(page: Page, dateien: { name: string; buffer: Buffer }[]) {
  await page.goto("/posteingang");
  const form = page.getByTestId("eml-upload").first();
  await form.locator("input[type=file]").setInputFiles(dateien.map((d) => ({ ...d, mimeType: "message/rfc822" })));
  await Promise.all([aktion(page), form.locator("button[type=submit]").click()]);
  await expect(form.locator(".notice")).toBeVisible();
  return (await form.locator(".notice").textContent()) ?? "";
}

test.describe("Persönliche Mails und Postausgang", () => {
  test("Abnahme 1–4: Absage → Push mit Entwurf, Termin abgesagt, Senden im Thread; Newsletter/Amazon wie bisher; VA/Büro sieht nichts, Morgenbericht nur Anzahl", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const [{ id: T }] = await sql<{ id: string }>("select id from tenants limit 1");
    const [{ id: INH }] = await sql<{ id: string }>("select id from users where email = 'inhaber'");
    const morgen = tagPlus(1);
    await anmelden(page, "inhaber");
    try {
      // Einstellungen: Discord-Direktnachricht an mich (erfundene ID) – nie in einen Kanal.
      await page.goto("/privat/nachrichten");
      await page.locator("summary", { hasText: "Einstellungen" }).click();
      const f = page.getByTestId("persoenlich-einstellungen");
      await f.locator('input[name="discordDm"]').check();
      await f.locator("#dmid").fill("712345678901234567");
      await Promise.all([aktion(page), f.locator("button[type=submit]").click()]);
      await expect(page.getByTestId("nachricht-meldung")).toContainText("Einstellungen gespeichert");

      // Termin morgen im Privatkalender (über Claude mit Privat-Freigabe angelegt)
      const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true, privat: true });
      expect(await mcp.call("privat_termin", { tag: morgen, uhrzeit: "10:00", art: "privat", titel: "Physio Petra Probe" })).toMatch(/gespeichert|angelegt|ok/i);

      // Abnahme 1: private Mail „muss den Termin morgen leider absagen, bin krank“
      const t0 = new Date(Date.now() - 1000);
      const r = await hochladen(page, [{ name: "p.eml", buffer: eml({ von: "Petra Probe <petra.probe@familie-test.example>", betreff: `Termin morgen ${m}`, text: "Hallo Ina,\nich muss den Termin morgen leider absagen, bin krank.\nViele Grüße\nPetra", id: `pm-${m}` }) }]);
      expect(r).toContain("1 neu");
      // nie im geschäftlichen Posteingang
      expect(await sql("select 1 from emails where subject like $1", [`%${m}%`])).toHaveLength(0);
      // Push sofort (ohne Discord-Kanal), mit „Antwort prüfen“
      const [push] = await sql<{ id: string; titel: string; text: string; link: string; discord: boolean | null; aktionen: { titel: string }[] }>("select id, titel, text, link, discord, aktionen from meldungen where user_id = $1 and art = 'persoenlich' and created_at >= $2 order by created_at desc", [INH, t0]);
      expect(push.titel).toContain("Petra Probe");
      expect(push.text).toContain("Antwort prüfen");
      expect(push.text).toContain("als abgesagt markiert");
      expect(push.discord).toBeNull();
      expect(push.aktionen[0].titel).toBe("Antwort prüfen");
      expect(push.link).toMatch(/^\/privat\/nachrichten\/[0-9a-f-]{36}$/);
      // KI-Entwurf angefragt; Discord nur als Direktnachricht (DM-Kanal), nicht im VA-Kanal
      expect(await testdienste.kiZu("Schreibe einen Antwortentwurf für eine persönliche Mail")).toBeTruthy();
      const dc = (await (await fetch(`${TD}/__discord-va`)).json()) as { kanaele: { id: string; type: number }[]; nachrichten: { channel_id: string; content: string }[] };
      const dm = dc.kanaele.find((k) => k.type === 1);
      expect(dm).toBeTruthy();
      expect(dc.nachrichten.some((n) => n.channel_id === dm!.id && n.content.includes("Persönliche Mail von Petra Probe"))).toBe(true);
      expect(dc.nachrichten.some((n) => n.channel_id !== dm!.id && n.content.includes("Petra Probe"))).toBe(false);

      // Abnahme 4 (Teil): Morgenbericht und Überblick nur mit der Anzahl
      await sql("insert into push_abos (tenant_id, user_id, endpoint, geraet) values ($1, $2, $3, 'Test-Handy PM')", [T, INH, `${TD}/push/pm-${m}`]);
      // „jetzt ausliefern“ erscheint mit einer über Nacht zurückgehaltenen Meldung (erfunden)
      await sql("insert into meldungen (tenant_id, user_id, titel, text, link, art, zustand) values ($1, $2, $3, 'Test', '/', 'sonstiges', 'zurueckgehalten')", [T, INH, `Über Nacht ${m}`]);
      await page.goto("/einstellungen/benachrichtigungen");
      await Promise.all([aktion(page), page.getByTestId("jetzt-ausliefern").click()]);
      await expect(page.getByTestId("benachrichtigungen-meldung")).toContainText("Morgenbericht");
      const [mb] = await sql<{ text: string }>("select text from meldungen where user_id = $1 and art = 'morgenbericht' order by created_at desc limit 1", [INH]);
      expect(mb.text).toMatch(/\d+ persönliche Nachricht(en)? warte/);
      expect(mb.text).not.toContain("Petra");
      const ue = JSON.parse(await mcp.call("ueberblick")) as { persoenliche_nachrichten?: { anzahl: number; text: string } };
      expect(ue.persoenliche_nachrichten?.anzahl).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(ue)).not.toContain("Petra");

      // Abnahme 1+2: Nachricht im Privatbereich – Termin als abgesagt markiert, Entwurf fertig, Senden mit einem Tipp
      await page.goto(push.link);
      await expect(page.getByTestId("nachricht-status")).toHaveText("Antwort offen");
      await expect(page.getByTestId("nachricht-termin")).toContainText("Physio Petra Probe");
      await expect(page.getByTestId("nachricht-termin")).toContainText("abgesagt");
      await expect(page.getByTestId("termin-rueckgaengig")).toBeVisible();
      const entwurf = await page.getByTestId("nachricht-entwurf").inputValue();
      expect(entwurf).toContain("gute Besserung");
      expect(entwurf.trim().endsWith("Ina Inhaber")).toBe(true);
      await expect(page.getByText("Entwurf von der KI")).toBeVisible();
      const kal = JSON.parse(await mcp.call("privat_kalender", { von: morgen, bis: morgen })) as { eintraege: { titel?: string; status?: string }[] };
      expect(kal.eintraege.find((e) => e.titel === "Physio Petra Probe")?.status).toBe("ausgefallen");

      await Promise.all([page.waitForURL(/\/privat\/nachrichten\?meldung=/), page.getByTestId("nachricht-senden").click()]);
      await expect(page.getByTestId("nachricht-meldung")).toContainText("Antwort gesendet");
      const [gesendet] = await sql<{ to: string; subject: string; in_reply_to: string | null }>('select "to", subject, in_reply_to from test_mails where subject like $1 order by created_at desc limit 1', [`%${m}%`]);
      expect(gesendet.to).toBe("petra.probe@familie-test.example");
      expect(gesendet.subject).toBe(`Re: Termin morgen ${m}`);
      expect(gesendet.in_reply_to).toBe(`<pm-${m}@example.invalid>`); // im selben Verlauf
      expect((await sql<{ zustand: string }>("select zustand from meldungen where id = $1", [push.id]))[0].zustand).toBe("erledigt"); // Push-Karte weg
      await page.goto(push.link);
      await expect(page.getByTestId("nachricht-status")).toHaveText("beantwortet");
      await expect(page.getByTestId("verlauf-aus")).toHaveCount(1);

      // Abnahme 3: Newsletter und Amazon-Mails wie bisher – nichts davon im Privatbereich
      const t1 = new Date(Date.now() - 1000);
      await hochladen(page, [
        { name: "n.eml", buffer: eml({ von: "Shop Team <news@shop-test.example>", betreff: `Herbst-Angebote ${m}`, text: "Hallo Ina, unsere neuen Angebote!\nNewsletter abbestellen: hier", id: `nl-${m}`, kopf: ["List-Unsubscribe: <mailto:abmelden@shop-test.example>", "Precedence: bulk"] }) },
        { name: "a.eml", buffer: eml({ von: "Amazon <donotreply@amazon.de>", betreff: `Verkauft, Jetzt liefern: Testartikel ${m}`, text: "Bestellnummer 302-1234567-7654321. Bitte versenden Sie den Artikel.", id: `az-${m}` }) },
      ]);
      expect(await sql("select 1 from emails where subject = $1", [`Verkauft, Jetzt liefern: Testartikel ${m}`])).toHaveLength(1);
      expect(await sql("select 1 from meldungen where art = 'persoenlich' and created_at >= $1 and (titel like '%Shop Team%' or titel like '%Amazon%')", [t1])).toHaveLength(0);
      await page.goto("/privat/nachrichten");
      await expect(page.locator("body")).not.toContainText(`Herbst-Angebote ${m}`);
      await expect(page.locator("body")).not.toContainText(`Testartikel ${m}`);

      // Abnahme 4: Büro (Posteingang) und Familie sehen die persönliche Mail nicht
      const buero = await alsPerson(browser, "buero");
      await buero.goto("/posteingang");
      await expect(buero.locator("body")).not.toContainText(`Termin morgen ${m}`);
      await buero.goto(push.link);
      await expect(buero).not.toHaveURL(/\/privat\/nachrichten/);
      await buero.context().close();
      const familie = await alsPerson(browser, "familie");
      await familie.goto(push.link);
      await expect(familie).not.toHaveURL(/\/privat\/nachrichten\/[0-9a-f-]{36}/);
      await familie.context().close();
    } finally {
      await sql("delete from push_abos where tenant_id = $1 and endpoint like $2", [T, `%/push/pm-${m}`]);
    }
  });

  test("Abnahme 5–6: Antwort aus dem Mailprogramm → beantwortet (extern), Aufgabe erledigt; neue B2B-Anfrage → ausgehend mit Nachfassen", async ({ page }) => {
    test.setTimeout(150_000);
    const m = marke();
    const [{ id: T }] = await sql<{ id: string }>("select id from tenants limit 1");
    // Eigenes Postfach (nur als Absenderadresse; nicht aktiv, kein Abruf im Test)
    const [box] = await sql<{ id: string }>("insert into mailboxes (tenant_id, provider, address, active, from_name) values ($1, 'imap', $2, false, 'Ina Inhaber') returning id", [T, EIGEN]);
    await anmelden(page, "inhaber");
    try {
      // Abnahme 5: Käuferfrage → Aufgabe + vorbereiteter Entwurf; Ludwig antwortet am Handy (Gesendet-Ordner)
      const kaeufer = `k${m.toLowerCase()}@marketplace.amazon.de`;
      const nr = `302-${String(Date.now()).slice(-7)}-1234567`;
      await hochladen(page, [{ name: "k.eml", buffer: eml({ von: `Max Käufer - Amazon Marketplace <${kaeufer}>`, betreff: `Frage zur Bestellung ${nr} ${m}`, text: `Hallo, wann wird meine Bestellung ${nr} geliefert?\nGrüße Max`, id: `kf-${m}` }) }]);
      const [mail] = await sql<{ id: string; topic: string; task_id: string | null }>("select id, topic, task_id from emails where message_key = $1", [`<kf-${m}@example.invalid>`]);
      expect(mail.topic).toBe("buyer_message");
      expect(mail.task_id).not.toBeNull();
      expect(await sql("select 1 from email_drafts where email_id = $1 and sent_at is null and via = 'app'", [mail.id])).toHaveLength(1);
      expect(await sql("select 1 from meldungen where art = 'mail_entwurf' and link = $1", [`/posteingang/${mail.id}`])).not.toHaveLength(0);

      const r = await hochladen(page, [{ name: "s.eml", buffer: eml({ von: `Ina Inhaber <${EIGEN}>`, an: `Max Käufer <${kaeufer}>`, betreff: `Re: Frage zur Bestellung ${nr} ${m}`, text: `Hallo Max,\nist heute rausgegangen, morgen bei dir.\nViele Grüße\nIna`, id: `sent-${m}`, antwortAuf: `<kf-${m}@example.invalid>` }) }]);
      expect(r).toContain("1 neu");
      const [nach] = await sql<{ beantwortet_am: Date | null; beantwortet_von: string | null }>("select beantwortet_am, beantwortet_von from emails where id = $1", [mail.id]);
      expect(nach.beantwortet_am).not.toBeNull();
      expect(nach.beantwortet_von).toContain(EIGEN);
      expect(nach.beantwortet_von).toContain("extern");
      expect((await sql<{ status: string }>("select status from tasks where id = $1", [mail.task_id]))[0].status).toBe("done");
      expect(await sql("select 1 from email_drafts where email_id = $1 and sent_at is null", [mail.id])).toHaveLength(0); // Entwurf verworfen
      expect(await sql("select 1 from meldungen where link = $1 and zustand <> 'erledigt' and art = 'mail_entwurf'", [`/posteingang/${mail.id}`])).toHaveLength(0);
      expect(await sql("select 1 from emails where message_key = $1", [`<sent-${m}@example.invalid>`])).toHaveLength(0); // gesendete Mail ist kein Eingang
      await page.goto(`/posteingang/${mail.id}`);
      await expect(page.getByTestId("mail-beantwortet")).toContainText("Beantwortet (extern)");
      await expect(page.getByTestId("mail-beantwortet")).toContainText("Ina Inhaber");
      await expect(page.getByTestId("mail-verlauf").getByTestId("verlauf-aus")).toContainText("ist heute rausgegangen");

      // Abnahme 6: neue B2B-Anfrage aus dem Mailprogramm → „ausgehend“ mit Nachfass-Knopf
      const kunde = `einkauf@kunde-${m.toLowerCase()}.example`;
      await hochladen(page, [{ name: "b.eml", buffer: eml({ von: `Ina Inhaber <${EIGEN}>`, an: `Kunde Test <${kunde}>`, betreff: `Angebot Paletten ${m}`, text: "Guten Tag,\nanbei unser B2B-Angebot für 3 Paletten Testware (Preisliste im Anhang).\nFreundliche Grüße\nIna Inhaber", id: `aus-${m}` }) }]);
      await page.goto("/posteingang/ausgehend");
      const zeile = page.getByTestId("ausgehend-zeile").filter({ hasText: `Angebot Paletten ${m}` });
      await expect(zeile).toContainText(kunde);
      await expect(zeile.getByTestId("nachfassen-knopf")).toHaveText("Nachfassen in 3 Tagen");
      await Promise.all([aktion(page), zeile.getByTestId("nachfassen-knopf").click()]);
      await expect(page.getByTestId("ausgehend-meldung")).toContainText("Nachfassen in 3 Tagen");
      const [aus] = await sql<{ id: string; nachfassen_am: string }>("select id, nachfassen_am from mail_ausgang where message_key = $1", [`<aus-${m}@example.invalid>`]);
      expect(aus.nachfassen_am).toBe(tagPlus(3));
      // fällig ohne Antwort → Aufgabe „Nachfassen“
      await sql("update mail_ausgang set nachfassen_am = $2 where id = $1", [aus.id, tagPlus(0)]);
      await page.goto("/posteingang/ausgehend");
      await Promise.all([aktion(page), page.getByTestId("nachfassen-pruefen").click()]);
      await expect(page.getByTestId("ausgehend-meldung")).toContainText("Nachfassen");
      const [task] = await sql<{ id: string; status: string; title: string }>("select id, status, title from tasks where system_key = $1", [`nachfassen:${aus.id}`]);
      expect(task.title).toContain(`Angebot Paletten ${m}`);
      // Antwort des Kunden → wichtig im Posteingang, Nachfassen erledigt, Verlauf zeigt eure Mail
      await hochladen(page, [{ name: "a.eml", buffer: eml({ von: `Kunde Test <${kunde}>`, betreff: `AW: Angebot Paletten ${m}`, text: "Hallo Frau Inhaber, wir nehmen 2 Paletten. Gruß", id: `ant-${m}`, antwortAuf: `<aus-${m}@example.invalid>` }) }]);
      const [antwort] = await sql<{ id: string; category: string }>("select id, category from emails where message_key = $1", [`<ant-${m}@example.invalid>`]);
      expect(antwort.category).toBe("action");
      expect((await sql<{ antwort_email_id: string }>("select antwort_email_id from mail_ausgang where id = $1", [aus.id]))[0].antwort_email_id).toBe(antwort.id);
      expect((await sql<{ status: string }>("select status from tasks where id = $1", [task.id]))[0].status).toBe("done");
      await page.goto(`/posteingang/${antwort.id}`);
      await expect(page.getByTestId("mail-vorher")).toContainText("B2B-Angebot für 3 Paletten");
    } finally {
      await sql("delete from mailboxes where id = $1", [box.id]);
    }
  });
  test("Handy: persönliche Mail im Vollbild – Senden, Bearbeiten, Später unten erreichbar, kein Querscrollen @nur-handy", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    await anmelden(page, "inhaber");
    await hochladen(page, [{ name: "h.eml", buffer: eml({ von: "Hanna Huber <hanna.huber@familie-test.example>", betreff: `Kurze Frage ${m}`, text: "Hallo Ina,\nhast du am Wochenende Zeit für einen Kaffee? Melde dich gern bei mir.\nLiebe Grüße\nHanna", id: `hd-${m}` }) }]);
    await page.goto("/privat/nachrichten");
    await page.getByTestId("nachricht-zeile").filter({ hasText: "Hanna Huber" }).first().click();
    await expect(page.getByTestId("nachricht-detail")).toBeVisible();
    // Du-Form aus der Mail erkannt; Knopfleiste im sichtbaren Bereich
    expect(await page.getByTestId("nachricht-entwurf").inputValue()).toMatch(/^Hallo Hanna,/);
    for (const k of ["nachricht-senden", "nachricht-bearbeiten", "nachricht-spaeter"]) await expect(page.getByTestId(k)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // Bearbeiten → Text änderbar
    await expect(page.getByTestId("nachricht-entwurf")).toHaveAttribute("readonly", "");
    await page.getByTestId("nachricht-bearbeiten").click();
    await expect(page.getByTestId("nachricht-entwurf")).not.toHaveAttribute("readonly", "");
    await page.getByTestId("nachricht-entwurf").fill(`Hallo Hanna,\n\ngern – Samstag 10 Uhr?\n\nViele Grüße\nIna (${m})`);
    // Später → Karte weg, Nachricht bleibt offen (mit gespeichertem Text)
    await Promise.all([page.waitForURL(/\/privat\/nachrichten\?meldung=/), page.getByTestId("nachricht-spaeter").click()]);
    await expect(page.getByTestId("nachricht-meldung")).toContainText("Später");
    await expect(page.getByTestId("nachrichten-offen")).toContainText("Hanna Huber");
    await page.getByTestId("nachricht-zeile").filter({ hasText: "Hanna Huber" }).first().click();
    expect(await page.getByTestId("nachricht-entwurf").inputValue()).toContain(`Ina (${m})`);
  });
});
