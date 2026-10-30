// Postfach (B9.7/8) mit erfundenen Mails: Anbindungen zeigen Postfächer + Warnung „keine Amazon-Mail“, Google/Microsoft
// nur optional unter „Erweitert“; Verbinden-Seite mit App-Passwort zuerst; Empfänger + Ordner je Mail; niederländische
// Compliance-Mail → kritisch + Amazon-ToDo mit Marktplatz, SKU und Link „Kontozustand“; Routinemail → unwichtig;
// Claude: anbindungen_status (Postfächer, Warnung), posteingang/mail mit an + ordner.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const eml = (o: { von: string; an: string; betreff: string; text: string; id: string }) =>
  Buffer.from(
    [`From: Amazon <${o.von}>`, `To: ${o.an}`, `Delivered-To: ${o.an}`, `Subject: ${o.betreff}`, `Message-ID: <${o.id}@example.invalid>`, `Date: ${new Date().toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"),
  );

test.describe("Postfach", () => {
  test("Anbindungen, Verbinden, Empfänger/Ordner, Compliance-Mail → Amazon-ToDo, Claude", async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const m = marke();
    await anmelden(page, "inhaber");
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");

    // 1) Anbindungen: Karte „Postfächer“; ohne verbundenes Postfach die Warnung; Google/Microsoft unter „Erweitert“ als optional
    await page.goto("/anbindungen");
    await expect(page.getByTestId("anbindung-postfaecher")).toBeVisible();
    await expect(page.getByTestId("anbindung-postfaecher").getByTestId("amazon-mail-warnung")).toContainText("Kein Postfach verbunden");
    const erweitert = page.getByTestId("anbindung-erweitert");
    await expect(erweitert).not.toHaveAttribute("open", "");
    await erweitert.locator("summary").click();
    await expect(erweitert.locator("#google")).toContainText("OPTIONAL");
    await expect(page.locator("#google")).toHaveCount(1);

    // 2) Verbinden: App-Passwort zuerst, Anleitung sichtbar, „Nur abrufen“, OAuth nur unter „Erweitert“
    await page.goto("/posteingang/verbinden");
    await expect(page.getByTestId("imap-verbinden")).toContainText("App-Passwort");
    await expect(page.getByTestId("app-passwort-anleitung")).toContainText("Microsoft 365");
    await expect(page.getByTestId("imap-nur-abruf")).toBeVisible();
    await expect(page.getByTestId("oauth-erweitert")).not.toHaveAttribute("open", "");

    // 3) Mails hochladen: NL-Compliance (kritisch), Routinemail (unwichtig) – Empfänger und Ordner „Upload“
    await page.goto("/posteingang");
    const form = page.getByTestId("eml-upload").first();
    await form.locator("input[type=file]").setInputFiles([
      { name: `nl-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: "seller-notification@amazon.nl", an: "amazon-nl@test-firma.example", betreff: `Opnieuw indienen van document vereist ${m}`, text: `Uw aanbieding is gedeactiveerd. ASIN: B0TESTNL01, SKU: TEST-NL-${m}. Dien het document opnieuw in.`, id: `nl-${m}` }) },
      { name: `routine-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: "seller-notification@amazon.de", an: "info@test-firma.example", betreff: `Verkauft, jetzt liefern: Testsocken ${m}`, text: "Bestellung 302-0000000-0000000 (erfunden).", id: `routine-${m}` }) },
    ]);
    await form.getByRole("button", { name: "Hochladen", exact: true }).click();
    await expect(form).toContainText("2 neu");
    const [nl] = await sql<{ id: string; category: string; an: string; ordner: string }>("select id, category, an, ordner from emails where tenant_id = $1 and message_key = $2", [T, `<nl-${m}@example.invalid>`]);
    expect(nl).toMatchObject({ category: "critical", an: "amazon-nl@test-firma.example", ordner: "Upload" });
    const [routine] = await sql<{ category: string; topic: string }>("select category, topic from emails where tenant_id = $1 and message_key = $2", [T, `<routine-${m}@example.invalid>`]);
    expect(routine).toMatchObject({ category: "noise", topic: "order_info" });
    await page.goto(`/posteingang/${nl.id}`);
    await expect(page.getByTestId("mail-an-ordner")).toContainText("An: amazon-nl@test-firma.example");
    await expect(page.getByTestId("mail-an-ordner")).toContainText("Ordner: Upload");

    // 4) Amazon-ToDos: Pflicht-ToDo mit Marktplatz NL, SKU und Link „Kontozustand“ (ohne KI)
    await page.goto("/amazon-todos");
    await Promise.all([aktion(page), page.getByRole("button", { name: "↻ Mails prüfen" }).click()]);
    await expect.poll(async () => (await sql<{ c: string }>("select count(*) c from amazon_todos where tenant_id = $1 and message_key = $2", [T, `<nl-${m}@example.invalid>`]))[0].c, { timeout: 30_000 }).toBe("1");
    const [todo] = await sql<{ category: string; priority: string; marktplatz: string; link: string; skus: string[]; asins: string[] }>("select category, priority, marktplatz, link, skus, asins from amazon_todos where tenant_id = $1 and message_key = $2", [T, `<nl-${m}@example.invalid>`]);
    expect(todo).toMatchObject({ category: "dokument", priority: "high", marktplatz: "NL", link: "https://sellercentral.amazon.nl/performance/account/health" });
    expect(todo.skus).toContain(`TEST-NL-${m}`);
    expect(todo.asins).toContain("B0TESTNL01");
    await page.reload();
    await expect(page.getByTestId("todo-pflicht").filter({ hasText: `TEST-NL-${m}` })).toContainText("Marktplatz NL");

    // 5) Claude: Stand der Postfächer + Warnung; Mails mit Empfänger und Ordner
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const st = JSON.parse(await mcp.call("anbindungen_status", { nur_probleme: true }));
    expect(st.amazon_mail_warnung).toContain("Kein Postfach verbunden");
    expect(st.anbindungen.some((a: { anbindung: string }) => /Google \(Gmail/.test(a.anbindung))).toBe(false);
    const alle = JSON.parse(await mcp.call("anbindungen_status", {}));
    expect(Array.isArray(alle.postfaecher)).toBe(true);
    expect(alle.anbindungen.find((a: { anbindung: string }) => /Google \(Gmail/.test(a.anbindung)).optional).toMatch(/IMAP/);
    const pe = JSON.parse(await mcp.call("posteingang", { nur_wichtige: true, suche: m }));
    expect(pe.mails[0]).toMatchObject({ an: "amazon-nl@test-firma.example", ordner: "Upload" });
    const mail = JSON.parse(await mcp.call("mail", { id: nl.id }));
    expect(mail).toMatchObject({ an: "amazon-nl@test-firma.example", ordner: "Upload" });
  });
});
