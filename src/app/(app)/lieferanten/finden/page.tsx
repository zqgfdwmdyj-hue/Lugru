import Link from "next/link";
import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { LEAD_SOURCES, type LeadSource } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { getSettings as ebaySettings } from "@/lib/ebay/db/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import { keepaKey } from "@/lib/integrations/clients/keepa";
import { getIntegration } from "@/lib/integrations/store";
import { brandMatches, isBrandNote, leadBrandHits, priorContact } from "@/lib/leads/logic";
import { baseWhere, inView, LEAD_VIEWS, listOrder, listQuery, parseListContext, viewWhere, type LeadView } from "@/lib/leads/list";
import { lucidBookmarkletHref } from "@/lib/leads/lucid-bookmarklet";
import { brandLoadStatus, contactContext, DAILY_MAIL_LIMIT, missingBrandCount, missingBrandIds, sendBlocker, sentToday } from "@/lib/leads/service";
import { recentSearches, SEARCH_STALE_MS } from "@/lib/leads/sources";
import { draftAction, excludeAction, fairImportAction, loadBrandsAction, searchEmailAction, reincludeAction, researchAction, searchBrandAction, sendAction, toBoardAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { AutoRefresh, SelectAll } from "./refresh";
import { RegisterBookmark, RegisterReceiver } from "./register-import";
import { MesseBookmark, MesseReceiver } from "./messe-import";
import { messeBookmarkletHref } from "@/lib/leads/messe-bookmarklet";
import { FINDING_LABEL, KIND_LABEL, SEARCH_SOURCE_LABEL, STATUS_LABEL } from "@/lib/leads/labels";

const VIEWS = LEAD_VIEWS;
type View = LeadView;

const QUELLEN: readonly LeadSource[] = LEAD_SOURCES;

export default async function GrosshaendlerFindenPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; marke?: string; m?: string; meldung?: string; quelle?: string; register?: string; import?: string }> }) {
  const session = await requireArea("lieferanten");
  const sp = await searchParams;
  // Reiter, Quelle und Markenfilter – wandern beim Öffnen einer Firma mit (zurück zur Suche, nächste Firma).
  const list = parseListContext(sp);
  const { view, quelle, m } = list;
  const mKey = m; // leer = kein Markenfilter
  const t = session.tenantId;
  const L = schema.supplierLeads;
  // Nach Marke filtern: grobe Vorauswahl in der Datenbank, genau geprüft wird danach (leadBrandHits).
  const base = baseWhere(t, list);
  let rows = await db.select().from(L).where(and(...base, ...viewWhere(view))).orderBy(...listOrder).limit(400);
  // Treffer je Ansicht (für die Reiter), nur bei aktivem Markenfilter.
  const viewHits: Partial<Record<View, number>> = {};
  if (mKey) {
    rows = rows.filter((l) => leadBrandHits(l, m).length > 0);
    const all = (await db.select({ status: L.status, kind: L.kind, mailedAt: L.mailedAt, brands: L.brands, searchBrands: L.searchBrands, findings: L.findings }).from(L).where(and(...base)).limit(5000)).filter((l) => leadBrandHits(l, m).length > 0);
    for (const v of Object.keys(VIEWS) as View[]) viewHits[v] = all.filter((l) => inView(l, v)).length;
  }
  // Mit Markenfilter direkt zur Liste springen (auf dem Handy liegt sie weit unten).
  const listHref = (p: { ansicht?: View; quelle?: LeadSource | null; m?: string }) =>
    `/lieferanten/finden?${listQuery(list, { ...(p.ansicht ? { view: p.ansicht } : {}), ...(p.quelle !== undefined ? { quelle: p.quelle } : {}), ...(p.m !== undefined ? { m: p.m } : {}) })}${(p.m ?? m) ? "#liste" : ""}`;
  const here = listQuery(list);
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      busyBrands: sql<number>`count(*) filter (where ${L.busy} = 'marken')::int`,
      busyCheck: sql<number>`count(*) filter (where ${L.busy} = 'pruefen')::int`,
      busyDraft: sql<number>`count(*) filter (where ${L.busy} = 'entwurf')::int`,
      busyEmail: sql<number>`count(*) filter (where ${L.busy} = 'email')::int`,
      wholesale: sql<number>`count(*) filter (where ${L.kind} = 'grosshandel' and ${L.status} <> 'ausgeschlossen')::int`,
      replies: sql<number>`count(*) filter (where ${L.status} = 'antwort')::int`,
    })
    .from(L)
    .where(eq(L.tenantId, t));
  const [today, ctx, missing, missingIds, searches, keepa, ebay, ai] = await Promise.all([
    sentToday(t),
    contactContext(t),
    missingBrandCount(t),
    missingBrandIds(t),
    recentSearches(t),
    keepaKey(t),
    ebaySettings(ebayDb(t)).catch(() => null),
    getIntegration(t, "anthropic"),
  ]);
  const now = Date.now();
  const running = searches.filter((r) => r.status === "laeuft" && now - r.startedAt.getTime() < SEARCH_STALE_MS);
  const brandState = brandLoadStatus(t);
  // „Markenliste lädt“ nur, solange der Lader wirklich läuft (nach einem Neustart sonst endlos).
  const busyBrands = brandState.running ? counts.busyBrands : 0;
  const busy = busyBrands + counts.busyCheck + counts.busyDraft + counts.busyEmail > 0 || running.length > 0 || brandState.running;
  const lastLucid = searches.find((r) => r.source === "lucid");
  const registerBlocked = sp.register === "browser" || lastLucid?.status === "fehler";
  // Marke für das Lesezeichen: aus der Adresse, sonst die der letzten (fehlgeschlagenen) Register-Suche.
  const regBrand = sp.marke || (lastLucid?.status === "fehler" ? lastLucid.brand : "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const origin = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || /^\d/.test(host) ? "http" : "https")}://${host}`;
  const registerBase = (process.env.LUCID_BASE_URL || "https://oeffentliche-register.verpackungsregister.org").replace(/\/$/, "");
  const available: Record<string, string | null> = {
    lucid: null,
    amazon: keepa ? null : "Keepa-Schlüssel fehlt (Anbindungen → Keepa)",
    ebay: ebay?.clientId && ebay?.clientSecret ? null : "eBay nicht verbunden (eBay → eBay-Einstellungen)",
    web: ai?.apiKey ? null : "KI-Schlüssel fehlt (Anbindungen → KI)",
  };

  return (
    <>
      <AutoRefresh active={busy} />
      <div className="page-head">
        <div><div className="crumb"><Link href="/lieferanten">Lieferanten</Link></div><h1>Großhändler finden</h1></div>
      </div>

      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>Bezugsquellen zu einer Marke suchen</h2>
        <div className="small muted">
          Mehrere Wege zu Großhändlern, Importeuren und Distributoren – gleiche Firmen aus verschiedenen Quellen werden zusammengeführt.
          Danach prüft die KI per Websuche, wer wirklich an Wiederverkäufer liefert, und findet die Einkaufs-E-Mail.
        </div>
        <form action={searchBrandAction} className="stack" style={{ gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label className="sr-only" htmlFor="brand">Marke</label>
            <input className="input" id="brand" name="brand" defaultValue={sp.marke ?? ""} placeholder="Marke, z. B. Wella" required style={{ maxWidth: 260 }} />
            <SubmitButton label="Suchen" pendingLabel="Startet …" testId="brand-search" />
          </div>
          <div className="stack" style={{ gap: 6 }} data-testid="lead-sources">
            {([
              ["lucid", "Verpackungsregister (LUCID)", "Firmen, die Ware der Marke in Deutschland in Verkehr bringen – Importeure, Großhändler, Hersteller. Kostenlos."],
              ["amazon", "Amazon-Verkäufer der Marke", "Keepa: wer die Marke auf amazon.de anbietet, mit Impressum (Firma, Anschrift, E-Mail, USt-ID). Ca. 100–170 Keepa-Tokens je Suche."],
              ["ebay", "eBay-Verkäufer + GPSR-Angaben", "Gewerbliche eBay-Verkäufer der Marke mit Impressum, dazu Hersteller und EU-Verantwortlicher aus den Produktsicherheitsangaben (oft der Importeur). Kostenlos."],
              ["web", "KI-Websuche nach Distributoren", "Händler-/Distributorenlisten der Marke, B2B-Shops, Großhändler. Ca. 10–20 Cent je Suche."],
            ] as const).map(([key, label, hint]) => (
              <label key={key} className="small" style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: available[key] ? 0.55 : 1 }}>
                <input type="checkbox" name="quelle" value={key} defaultChecked={!available[key] && key !== "web"} disabled={Boolean(available[key])} style={{ marginTop: 3 }} />
                <span><strong>{label}</strong> – {hint}{available[key] && <span style={{ color: "var(--danger)" }}> · {available[key]}</span>}</span>
              </label>
            ))}
            <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="onlyActive" defaultChecked /> Register: nur aktive Registrierungen</label>
          </div>
        </form>
        {searches.length > 0 && (
          <div className="small stack" style={{ gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }} data-testid="lead-searches">
            <strong>Letzte Suchläufe</strong>
            {searches.map((r) => {
              const stale = r.status === "laeuft" && now - r.startedAt.getTime() >= SEARCH_STALE_MS;
              const tag = stale ? ["abgebrochen", "tag-neutral"] : r.status === "laeuft" ? ["läuft …", "tag-info"] : r.status === "fertig" ? ["fertig", "tag-ok"] : ["Fehler", "tag-danger"];
              return (
                <div key={r.id} data-testid="lead-search" data-source={r.source} data-status={stale ? "abgebrochen" : r.status}>
                  <span className={`tag ${tag[1]}`}>{tag[0]}</span> <strong>{SEARCH_SOURCE_LABEL[r.source]}</strong> · „{r.brand}“ · {r.startedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  {r.message && <span className={r.status === "fehler" ? "" : "muted"} style={r.status === "fehler" ? { color: "var(--danger)" } : undefined}> – {r.message}</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <details className="card card-pad" open={sp.import === "messe" || quelle === "messe"} data-testid="messe-import">
        <summary style={{ cursor: "pointer" }}><strong>Messe-Ausstellerliste auslesen</strong> <span className="small muted">– z. B. IAW Köln: Importeure, Großhändler, Aktionsware</span></summary>
        <div className="stack small" style={{ gap: 10, marginTop: 10 }}>
          <form action={fairImportAction} className="stack" style={{ gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input className="input" name="url" type="url" required placeholder="Link zur Ausstellerliste, z. B. https://iaw-messe.de/besucher/ausstellerverzeichnis/" style={{ flex: "1 1 320px" }} aria-label="Link zur Ausstellerliste" />
              <input className="input" name="fair" placeholder="Messe (optional)" style={{ maxWidth: 180 }} aria-label="Messe" />
              <input className="input" name="categories" placeholder="nur Kategorien, z. B. Drogerie, Lebensmittel" style={{ maxWidth: 280 }} aria-label="Kategorien" />
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="details" defaultChecked /> Detailseiten laden (Anschrift, Website, Kontakt-E-Mail, Kategorien – ca. 1 Sek. je Aussteller)</label>
              <button className="btn btn-primary" type="submit">Auslesen</button>
            </div>
          </form>
          <div className="muted">Die IAW wird direkt gelesen (alle Seiten, kostenlos). Andere Messen liest die KI (wenige Cent je Liste). Lädt eine Messeseite ihre Aussteller erst im Browser („Mehr laden“, Scrollen): Lesezeichen <MesseBookmark href={messeBookmarkletHref(origin)} /> in die Lesezeichenleiste ziehen, auf der Ausstellerliste klicken → „An Seller-System senden“.</div>
          <MesseReceiver />
        </div>
      </details>

      <details className="card card-pad" open={registerBlocked || sp.import === "register"} data-testid="register-browser">
        <summary style={{ cursor: "pointer" }}><strong>Verpackungsregister über deinen Browser abfragen</strong> <span className="small muted">– wenn das Register Anfragen vom Server ablehnt</span></summary>
        <div className="stack small" style={{ gap: 8, marginTop: 10 }}>
          <div>Manche Register sperren Rechenzentrums-Adressen. Dann läuft die gleiche Abfrage in deinem Browser – mit deiner normalen Internetverbindung, nur lesend:</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>Dieses Lesezeichen einmalig in die Lesezeichenleiste ziehen: <RegisterBookmark href={lucidBookmarkletHref(origin)} /></li>
            <li><a href={`${registerBase}/Producer${regBrand ? `#marke=${encodeURIComponent(regBrand)}` : ""}`} target="_blank" rel="noreferrer">Herstellerregister öffnen</a>{regBrand ? ` (Marke „${regBrand}“ wird übernommen)` : ""} und dort das Lesezeichen klicken.</li>
            <li>Es liest alle Firmen zur Marke und deren Markenlisten (dauert je nach Marke 1–3 Minuten) → „An Seller-System senden“. Die Daten erscheinen hier automatisch.</li>
          </ol>
          <RegisterReceiver allowedOrigin={new URL(registerBase).origin} />
        </div>
      </details>

      {sp.meldung && <div className="notice notice-info" data-testid="leads-msg">{sp.meldung}</div>}
      {busy && (
        <div className="notice notice-info small" data-testid="leads-busy">
          Läuft im Hintergrund: {[busyBrands && `${busyBrands} Markenlisten`, counts.busyCheck && `${counts.busyCheck} Websuchen`, counts.busyDraft && `${counts.busyDraft} Entwürfe`, counts.busyEmail && `${counts.busyEmail} E-Mail-Suchen`].filter(Boolean).join(", ")} – die Liste aktualisiert sich von selbst.
        </div>
      )}

      {missing > 0 && (
        <div className="notice notice-info small" data-testid="brands-missing" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>
            <strong>{missing} Markenlisten aus dem Verpackungsregister fehlen noch.</strong>{" "}
            {brandState.running
              ? "Sie werden gerade nacheinander geladen."
              : brandState.throttledUntil > now
                ? `Das Register drosselt gerade – nächster automatischer Versuch ab ${new Date(brandState.throttledUntil).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} Uhr.`
                : "Sie werden automatisch alle 30 Minuten langsam nachgeladen."}{" "}
            Ohne Markenliste sind Score und Einstufung nur vorläufig.
          </span>
          <form action={loadBrandsAction}><button className="btn btn-small" type="submit" disabled={brandState.running}>Jetzt nachladen</button></form>
          <a className="btn btn-small" href={`${registerBase}/Producer#ids=${encodeURIComponent(missingIds.join(","))}`} target="_blank" rel="noreferrer" data-testid="brands-browser-link">Über deinen Browser laden ↗</a>
          <span className="muted">(mit dem Lesezeichen unten: Seite öffnen → Lesezeichen klicken)</span>
        </div>
      )}

      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Kontakte</div><div className="kpi-value">{counts.total}</div></div>
        <div className="card card-pad"><div className="kpi-label">Großhändler (geprüft)</div><div className="kpi-value">{counts.wholesale}</div></div>
        <div className="card card-pad"><div className="kpi-label">Heute angeschrieben</div><div className="kpi-value">{today} / {DAILY_MAIL_LIMIT}</div></div>
        <div className="card card-pad"><div className="kpi-label">Antworten</div><div className="kpi-value">{counts.replies}</div></div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={listHref({ ansicht: v })} className={`chip${view === v ? " active" : ""}`} data-testid={`view-${v}`}>{VIEWS[v]}{mKey ? ` (${viewHits[v] ?? 0})` : ""}</Link>)}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid="source-filter">
        <span className="small muted">Quelle:</span>
        <Link href={listHref({ quelle: null })} className={`chip${!quelle ? " active" : ""}`}>alle</Link>
        {QUELLEN.map((q) => <Link key={q} href={listHref({ quelle: q })} className={`chip${quelle === q ? " active" : ""}`}>{FINDING_LABEL[q]}</Link>)}
      </div>
      <form action="/lieferanten/finden#liste" id="liste" className="card card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", scrollMarginTop: 72 }} data-testid="brand-filter">
        <input type="hidden" name="ansicht" value={view} />
        {quelle && <input type="hidden" name="quelle" value={quelle} />}
        <label className="sr-only" htmlFor="mf">Nach Marke filtern</label>
        <input className="input" id="mf" name="m" type="search" defaultValue={m} placeholder="Nach Marke filtern, z. B. Airheads" style={{ flex: "1 1 220px", maxWidth: 340 }} />
        <button className="btn" type="submit">Filtern</button>
        {m && <Link className="btn btn-small" href={listHref({ m: "" })} data-testid="brand-filter-reset">✕ alle Firmen</Link>}
        {m && (
          <span className="small muted" data-testid="brand-filter-info">
            {rows.length} {rows.length === 1 ? "Firma" : "Firmen"} mit der Marke „{m}“ unter „{VIEWS[view]}“
          </span>
        )}
      </form>

      <form className="stack" style={{ gap: 10 }}>
        <input type="hidden" name="liste" value={here} />
        <section className="card" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}><SelectAll /></th>
                <th>Firma</th>
                <th>Marken / Fundstelle</th>
                <th className="right">Score</th>
                <th>Einstufung</th>
                <th>Kontakt</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" data-testid="leads-empty">
                    {m ? (
                      <>
                        Keine Firma mit der Marke „{m}“ in dieser Ansicht.{" "}
                        {Object.values(viewHits).some(Boolean) ? "Andere Reiter oben zeigen, wo es Treffer gibt." : <Link href={`/lieferanten/finden?marke=${encodeURIComponent(m)}`}>Bezugsquellen für „{m}“ suchen →</Link>}
                      </>
                    ) : (
                      "Keine Einträge in dieser Ansicht. Oben eine Marke im Register suchen."
                    )}
                  </td>
                </tr>
              )}
              {rows.map((l) => {
                const brand = l.searchBrands[0] ?? "";
                // Mit Markenfilter: passende Marken zuerst und markiert (sonst die gesuchte Marke).
                const hits = mKey ? leadBrandHits(l, m) : [];
                const brandList = l.brands === null ? null : mKey ? [...l.brands.filter((b) => hits.includes(b)), ...l.brands.filter((b) => !hits.includes(b))] : l.brands;
                const isHit = (b: string) => (mKey ? hits.includes(b) : brandMatches([b], brand));
                const block = l.mailedAt ? null : sendBlocker(l, ctx);
                const dup = l.mailedAt ? null : priorContact(l, ctx.contacted, ctx.suppliers);
                return (
                  <tr key={l.id} data-testid="lead-row" data-name={l.companyName}>
                    <td><input type="checkbox" name="ids" value={l.id} aria-label={`${l.companyName} auswählen`} /></td>
                    <td style={{ maxWidth: 260 }}>
                      <Link href={`/lieferanten/finden/${l.id}?${here}`}><strong>{l.companyName}</strong></Link>
                      <div className="small muted">{[l.zip, l.city].filter(Boolean).join(" ")}{l.country ? ` · ${l.country}` : ""}</div>
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 2 }}>
                        {[...new Set(l.findings.map((f) => f.source))].map((src) => <span key={src} className="tag tag-neutral" data-testid="lead-source">{FINDING_LABEL[src]}</span>)}
                      </div>
                    </td>
                    <td className="small" style={{ maxWidth: 300 }}>
                      {mKey && hits.length > 0 && (l.brands === null || !hits.some((h) => l.brands!.includes(h))) && (
                        <div style={{ marginBottom: 2 }} data-testid="lead-brand-hit">
                          {hits.slice(0, 3).map((b) => <span key={b} className="tag tag-ok" style={{ marginRight: 3, display: "inline-block" }}>{b}</span>)}
                        </div>
                      )}
                      {brandList === null ? (
                        l.busy === "marken" && brandState.running ? <span className="muted">wird geladen …</span> : l.source === "lucid" && !l.findings.some((f) => f.source !== "lucid") ? (
                          <span className="muted" title={l.checkError ?? undefined}>Markenliste folgt</span>
                        ) : (
                          <div className="muted">
                            {l.findings.filter((f) => f.source !== "lucid").slice(-3).map((f, i) => (
                              <div key={i}>{f.label}{f.detail ? `: ${f.detail}` : ""}{f.url && <> · <a href={f.url} target="_blank" rel="noreferrer">ansehen</a></>}</div>
                            ))}
                          </div>
                        )
                      ) : (
                        <>
                          <strong>{brandList.length}</strong>{" "}
                          {brandList.slice(0, 8).map((b) => (
                            <span key={b} className={`tag ${isHit(b) ? "tag-ok" : "tag-neutral"}`} style={{ marginRight: 3, marginBottom: 2, display: "inline-block" }} data-hit={isHit(b) ? "1" : undefined}>{b}</span>
                          ))}
                          {brandList.length > 8 && <span className="muted">+{brandList.length - 8}</span>}
                        </>
                      )}
                    </td>
                    <td className="num right">{l.score}</td>
                    <td className="small">
                      <span className={`tag ${KIND_LABEL[l.kind][1]}`}>{KIND_LABEL[l.kind][0]}</span>
                      {l.checkedAt ? <span className="muted"> · geprüft</span> : l.busy === "pruefen" ? <span className="muted"> · prüft …</span> : null}
                      {l.summary && <div className="muted" style={{ maxWidth: 260 }}>{l.summary}</div>}
                      {l.checkError && !isBrandNote(l.checkError) && <div style={{ color: "var(--danger)" }}>{l.checkError}</div>}
                    </td>
                    <td className="small" style={{ maxWidth: 220, wordBreak: "break-all" }}>
                      {l.website && <div><a href={l.website} target="_blank" rel="noreferrer">{new URL(l.website).hostname}</a></div>}
                      {l.email && <div>{l.email}</div>}
                      {l.b2bUrl && <div><a href={l.b2bUrl} target="_blank" rel="noreferrer">B2B-Zugang</a></div>}
                      {l.busy === "email" && <div className="muted">suche E-Mail …</div>}
                      {!l.email && l.emailSearchedAt && l.busy !== "email" && <div className="muted" data-testid="lead-no-email">keine E-Mail gefunden{l.contactUrl && <> · <a href={l.contactUrl} target="_blank" rel="noreferrer">Kontakt ↗</a></>}</div>}
                      {!l.website && !l.email && <span className="muted">{l.phone ?? "–"}</span>}
                    </td>
                    <td className="small">
                      <span className={`tag ${l.status === "antwort" ? "tag-ok" : l.status === "angeschrieben" ? "tag-info" : "tag-neutral"}`}>{STATUS_LABEL[l.status]}</span>
                      {l.busy === "entwurf" && <div className="muted">schreibt …</div>}
                      {view === "entwurf" && l.mailSubject && <div className="muted" style={{ maxWidth: 260 }}>{l.mailSubject}</div>}
                      {dup ? <div style={{ color: "var(--danger)" }} data-testid="lead-dup">{dup}</div> : view === "entwurf" && block && <div style={{ color: "var(--danger)" }}>{block}</div>}
                      {l.mailError && <div style={{ color: "var(--danger)" }}>{l.mailError}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card card-pad stack" style={{ gap: 10 }}>
          <h2>Mit der Auswahl</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" type="submit" formAction={researchAction}>Per Websuche prüfen</button>
            <button className="btn" type="submit" formAction={searchEmailAction}>E-Mail-Adressen suchen</button>
            <button className="btn" type="submit" formAction={toBoardAction}>Aufs Board</button>
            <button className="btn" type="submit" formAction={excludeAction}>Ausschließen</button>
            {view === "ausgeschlossen" && <button className="btn" type="submit" formAction={reincludeAction}>Wieder aufnehmen</button>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input className="input" name="wish" placeholder="Worum geht es? z. B. „Wella Professionals Haarpflege, laufender Bedarf“" style={{ maxWidth: 420 }} />
            <button className="btn" type="submit" formAction={draftAction}>Anfrage-Entwürfe erstellen</button>
          </div>
          {view === "entwurf" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="confirm" /> Ich habe die ausgewählten Entwürfe gelesen</label>
              <button className="btn btn-primary" type="submit" formAction={sendAction}>Ausgewählte senden</button>
              <span className="small muted">höchstens {DAILY_MAIL_LIMIT} pro Tag · nie doppelt · Privatpersonen, Salons und Marktplätze nie</span>
            </div>
          )}
          <div className="small muted">
            Wichtig: Unaufgeforderte E-Mails an Firmen können in Deutschland auch als Einkaufsanfrage als Werbung gelten (§ 7 UWG, Abmahnrisiko).
            Deshalb nur einzeln geprüfte, persönliche Anfragen an Firmen, die selbst als Großhändler/B2B auftreten – bevorzugt über deren Händler-Kontakt oder B2B-Registrierung. Jede Mail enthält einen Satz, dass eine kurze Absage genügt.
          </div>
        </section>
      </form>
    </>
  );
}
