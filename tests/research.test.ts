import { afterEach, describe, expect, it, vi } from "vitest";
import { googleNewsUrl, parseFeed, titleKey } from "@/lib/research/feeds";
import { summarize, summaryPrompt } from "@/lib/research/summary";

afterEach(() => vi.unstubAllGlobals());

const GOOGLE = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"E-Commerce when:3d" - Google News</title>
<item><title>DHL-E-Commerce-Chef: „Umsatz verdoppeln“ - DVZ</title><link>https://news.google.com/rss/articles/A1?oc=5</link><pubDate>Sat, 26 Sep 2026 03:28:27 GMT</pubDate>
<description>&lt;a href="https://news.google.com/x"&gt;DHL-E-Commerce-Chef: „Umsatz verdoppeln“&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;DVZ&lt;/font&gt;</description><source url="https://www.dvz.de">DVZ</source></item>
<item><title>Temu &amp; Shein: Zölle steigen - Handelsblatt</title><link>https://news.google.com/rss/articles/B2</link><pubDate>Fri, 25 Sep 2026 10:00:00 GMT</pubDate><description>Die EU plant neue Regeln für Pakete aus China.</description><source url="https://www.handelsblatt.com">Handelsblatt</source></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Seller-Blog</title>
<entry><title>Neue FBA-Gebühren 2027</title><link rel="alternate" href="https://blog.example.de/fba-2027"/><published>2026-09-24T08:00:00Z</published><summary type="html">&lt;p&gt;Was sich &lt;b&gt;ändert&lt;/b&gt;.&lt;/p&gt;</summary></entry>
</feed>`;

describe("Feeds", () => {
  it("liest Google News: Titel ohne angehängte Quelle, Kurztext nur wenn er mehr als der Titel ist", () => {
    const f = parseFeed(GOOGLE);
    expect(f.items).toHaveLength(2);
    expect(f.items[0]).toMatchObject({ title: "DHL-E-Commerce-Chef: „Umsatz verdoppeln“", source: "DVZ", link: "https://news.google.com/rss/articles/A1?oc=5", published: "2026-09-26T03:28:27.000Z", snippet: "" });
    expect(f.items[1]).toMatchObject({ title: "Temu & Shein: Zölle steigen", source: "Handelsblatt", snippet: "Die EU plant neue Regeln für Pakete aus China." });
  });

  it("liest Atom-Feeds", () => {
    const f = parseFeed(ATOM);
    expect(f.title).toBe("Seller-Blog");
    expect(f.items[0]).toMatchObject({ title: "Neue FBA-Gebühren 2027", link: "https://blog.example.de/fba-2027", source: "Seller-Blog", snippet: "Was sich ändert." });
  });

  it("baut die Google-News-Suche mit Zeitraum und erkennt Dubletten am Titel", () => {
    expect(googleNewsUrl("Amazon Private Label", 3)).toBe("https://news.google.com/rss/search?q=Amazon%20Private%20Label%20when%3A3d&hl=de&gl=DE&ceid=DE:de");
    expect(titleKey("Temu & Shein: Zölle steigen!")).toBe(titleKey("temu  shein – zolle steigen"));
  });
});

describe("KI-Zusammenfassung", () => {
  it("nummeriert die Quellen im Auftrag", () => {
    const p = summaryPrompt({ topic: "Aktien", items: [{ title: "DAX steigt", source: "FAZ", snippet: "", published: "2026-09-26T00:00:00Z" }] });
    expect(p).toContain("[1] DAX steigt (FAZ), 2026-09-26");
    expect(p).toContain('Thema „Aktien"');
  });

  it("ruft die Messages API mit Schlüssel und Modell auf", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ content: [{ type: "text", text: "- Punkt [1]" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const text = await summarize("sk-test", { topic: "X", items: [] }, "claude-sonnet-5");
    expect(text).toBe("- Punkt [1]");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    expect(JSON.parse(String(init!.body)).model).toBe("claude-sonnet-5");
  });

  it("meldet Fehler der API verständlich", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 })));
    await expect(summarize("falsch", { topic: "X", items: [] })).rejects.toThrow(/invalid x-api-key/);
  });
});
