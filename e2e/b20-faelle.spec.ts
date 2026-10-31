// B20.5 Fall-Zentrale mit erfundenen Amazon-Mails: Auszahlungsmitteilung → Zahlungseingang in der Liquidität (nie
// Fall, nie A-bis-z, nie VA), Mail archiviert; alter A-bis-z-Fall zu einer Auszahlung wird automatisch geschlossen;
// Buy-Box-Hinweise → ein ToDo „Buy-Box-Berechtigung prüfen“ je Land; Bewertungsanfrage und „Versendet:“ → Archiv;
// A-bis-z nur in der Fußzeile → „bitte prüfen“ in Sonstiges ohne Frist und ohne VA. Keine echten Daten.
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const eml = (o: { von?: string; betreff: string; text: string; id: string; tageZurueck?: number }) =>
  Buffer.from(
    [`From: Amazon <${o.von ?? "seller-notification@amazon.de"}>`, "To: info@test-firma.example", `Subject: ${o.betreff}`, `Message-ID: <${o.id}@example.invalid>`, `Date: ${new Date(Date.now() - (o.tageZurueck ?? 0) * 86_400_000).toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"),
  );

test.describe("Fall-Zentrale (B20.5)", () => {
  test("Auszahlung → Liquidität, alter Fall geschlossen, Buy-Box-ToDo je Land, Bewertung/Versand archiviert, Fußzeile → bitte prüfen", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const fuell = "Allgemeine Informationen zu Ihrem Verkäuferkonto und zu neuen Funktionen in Seller Central. ".repeat(8);
    const fussA = "\n\nGarantie de A à Z : en savoir plus sur sellercentral.amazon.fr.";

    await anmelden(page, "inhaber");
    await page.goto("/posteingang");
    const form = page.getByTestId("eml-upload").first();
    await form.locator("input[type=file]").setInputFiles([
      { name: `a-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: "donotreply@amazon.com", betreff: `Votre paiement est en cours ${m}`, text: `Montant : 369,71 € vers le compte bancaire se terminant par 123. Le versement devrait arriver dans 3 à 5 jours ouvrables.${fussA}`, id: `b20-a-${m}` }) },
      { name: `b-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Ihr Angebot ist nicht für das Einkaufswagen-Feld berechtigt ${m}`, text: "SKU TEST-BB-1 · ASIN B0TESTBB01", id: `b20-b-${m}` }) },
      { name: `c-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Ihr Angebot ist nicht für das Einkaufswagen-Feld berechtigt (2) ${m}`, text: "SKU TEST-BB-2 · ASIN B0TESTBB02", id: `b20-c-${m}` }) },
      { name: `d-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Transaktion bewerten ${m}`, text: "Bitte antworten Sie auf diese kurze Umfrage.", id: `b20-d-${m}` }) },
      { name: `e-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Versendet: „Erfundo Pfanne 28 cm“ ${m}`, text: "Ihre Sendung ist unterwegs.", id: `b20-e-${m}` }) },
      { name: `f-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Hinweis zu Ihrem Konto ${m}`, text: `${fuell}\n\nMehr zur A-bis-z-Garantie finden Sie in Seller Central.`, id: `b20-f-${m}` }) },
      { name: `g-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: "donotreply@amazon.com", betreff: `Votre paiement est en cours (2) ${m}`, text: `Montant : 115,52 € vers le compte bancaire se terminant par 123.${fussA}`, id: `b20-g-${m}`, tageZurueck: 1 }) },
    ]);
    await form.getByRole("button", { name: "Hochladen", exact: true }).click();
    await expect(form).toContainText(/neu/);
    const mail = async (b: string) => (await sql<{ id: string; archived: boolean }>("select id, archived from emails where tenant_id = $1 and subject like $2", [T, `%${b}%`]))[0];

    // Alter Stand: die Auszahlung „115,52 €“ steht als offener A-bis-z-Fall mit Frist und VA (wie am 31.10.)
    const g = await mail(`(2) ${m}`);
    const [alt] = await sql<{ id: string }>(
      "insert into amazon_vorgaenge (tenant_id, bereich, phase, status, dringlichkeit, titel, marktplatz, frist, zustaendig, betrag, erste_mail_am, letzte_mail_am) values ($1, 'a_bis_z', 'antwort_noetig', 'offen', 'rot', $2, 'FR', current_date + 1, 'va', 115.52, now() - interval '1 day', now() - interval '1 day') returning id",
      [T, `Votre paiement est en cours (2) ${m}`],
    );
    await sql("insert into amazon_vorgang_eintraege (tenant_id, vorgang_id, email_id, art, phase, text, am) values ($1, $2, $3, 'mail', 'antwort_noetig', 'Votre paiement est en cours – Antwort nötig', now() - interval '1 day')", [T, alt.id, g.id]);

    await page.goto("/amazon-faelle");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("faelle-abgleich").click()]);

    // 1. Keine Vorgänge für Auszahlung, Buy-Box, Bewertung, Versand – die Mails sind archiviert
    const neu = await sql<{ titel: string; bereich: string; status: string; unsicher: boolean; zustaendig: string | null; frist: string | null }>("select titel, bereich, status, unsicher, zustaendig, frist::text from amazon_vorgaenge where tenant_id = $1 and titel like $2 and id <> $3", [T, `%${m}%`, alt.id]);
    expect(neu.map((v) => v.titel)).toEqual([`Hinweis zu Ihrem Konto ${m}`]);
    for (const b of [`Votre paiement est en cours ${m}`, `berechtigt ${m}`, `berechtigt (2) ${m}`, `Transaktion bewerten ${m}`, `Versendet: „Erfundo Pfanne 28 cm“ ${m}`]) expect((await mail(b)).archived, b).toBe(true);

    // 2. A-bis-z nur in der Fußzeile → „bitte prüfen“ in Sonstiges, ohne Frist und ohne VA
    expect(neu[0]).toMatchObject({ bereich: "sonstiges", unsicher: true, zustaendig: null, frist: null });

    // 3. Alter A-bis-z-Fall zur Auszahlung automatisch geschlossen, ohne VA, mit Verlauf
    const [zu] = await sql<{ status: string; bereich: string; zustaendig: string | null; frist: string | null }>("select status, bereich, zustaendig, frist::text from amazon_vorgaenge where id = $1", [alt.id]);
    expect(zu).toEqual({ status: "erledigt", bereich: "info", zustaendig: null, frist: null });
    const verlauf = await sql<{ text: string }>("select text from amazon_vorgang_eintraege where vorgang_id = $1 and art = 'status'", [alt.id]);
    expect(verlauf.map((v) => v.text).join(" ")).toMatch(/Auszahlungsmitteilung – kein Fall, automatisch geschlossen; Zahlungseingang 115,52 € \(FR\) in der Liquidität/);
    expect((await mail(`(2) ${m}`)).archived).toBe(true);

    // 4. Zahlungseingänge in der Liquidität: Betrag, Konto-Endung, Marktplatz, erwartet in 3–5 Tagen
    const az = await sql<{ betrag: string; konto_endung: string; marktplatz: string; tage_von: number; tage_bis: number; vorgang_id: string | null }>(
      "select a.betrag::text, a.konto_endung, a.marktplatz, (a.erwartet_von - (a.gemeldet_am at time zone 'UTC')::date) as tage_von, (a.erwartet_bis - (a.gemeldet_am at time zone 'UTC')::date) as tage_bis, a.vorgang_id from amazon_auszahlung_meldungen a join emails e on e.id = a.email_id where a.tenant_id = $1 and e.subject like $2 order by a.betrag desc",
      [T, `%${m}%`],
    );
    expect(az).toEqual([
      { betrag: "369.7100", konto_endung: "123", marktplatz: "FR", tage_von: 3, tage_bis: 5, vorgang_id: null },
      { betrag: "115.5200", konto_endung: "123", marktplatz: "FR", tage_von: 3, tage_bis: 5, vorgang_id: alt.id },
    ]);
    await page.goto("/cashflow");
    await expect(page.getByTestId("liqui-wochen")).toContainText("Amazon-Auszahlung FR laut Mitteilung");
    await expect(page.getByTestId("liqui-wochen")).toContainText("369,71");
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const liq = JSON.parse(await mcp.call("liquiditaet", { wochen: 4 })) as { wochen: { posten: { was: string; betrag: number; geschaetzt?: boolean }[] }[] };
    const posten = liq.wochen.flatMap((w) => w.posten).filter((p) => p.was.includes("laut Mitteilung"));
    expect(posten.map((p) => p.betrag)).toEqual(expect.arrayContaining([369.71, 115.52]));
    expect(posten.every((p) => !p.geschaetzt)).toBe(true);

    // 5. Buy-Box: ein ToDo je Land mit beiden ASINs, kein Fall
    const [bb] = await sql<{ status: string; summary: string; asins: string[]; body_short: string }>("select status, summary, asins, body_short from amazon_todos where tenant_id = $1 and message_key = 'buybox-berechtigung:DE'", [T]);
    expect(bb.status).toBe("open");
    expect(bb.summary).toBe("Buy-Box-Berechtigung prüfen (DE)");
    expect(bb.asins).toEqual(expect.arrayContaining(["B0TESTBB01", "B0TESTBB02"]));
    expect(bb.body_short).toMatch(/^\d+ Hinweise/);

    // 6. Fall-Zentrale (offen) zeigt keine der Routine-Mails, aber den „bitte prüfen“-Vorgang
    await page.goto("/amazon-faelle");
    const liste = await page.locator("main").innerText();
    for (const b of [`Votre paiement est en cours ${m}`, `Einkaufswagen-Feld berechtigt ${m}`, `Transaktion bewerten ${m}`, `Pfanne 28 cm“ ${m}`, `Votre paiement est en cours (2) ${m}`]) expect(liste).not.toContain(b);
    expect(liste).toContain(`Hinweis zu Ihrem Konto ${m}`);
  });
});
