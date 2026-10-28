import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { CopyButton } from "@/components/copy-button";
import { TaskNotes } from "@/components/task-notes";
import { auditMail, daysUntil, findDuplicateDocs, MODULE_LABEL, SALES_STATE, salesState, WAITING_LABEL, type SasModule, type SasWaiting } from "@/lib/sas/logic";
import { brandEvidence, getProgram, refreshBrandFactsIfStale, loadBrands, loadDeals, loadDocuments, loadItems, salesCoverage, type SasBrand, type SasDealView, type SasItem, type SasProgram } from "@/lib/sas/service";
import { BrandStatusSelect } from "./brand-status";
import { SAS_BRAND_STATUS, SAS_DEAL_STATUS, SAS_MODULES, SAS_WAITING } from "@/db/tables/sas";
import {
  addItemAction,
  brandStatusAction,
  clearDealsAction,
  createFahrplanAction,
  dealStatusAction,
  deleteDocumentAction,
  evidenceVerdictAction,
  importBrandsAction,
  importDealsAction,
  recomputeBrandsAction,
  saveProgramAction,
  selectBrandAction,
  submitPilotAction,
  suggestBrandsAction,
  updateItemAction,
  uploadDocumentAction,
} from "./actions";

// Amazon SAS-Programm (Strategic Account Services, Reseller): alles an einem Ort – Stand, Aufgaben,
// Markenauswahl für den Authorized-Reseller-Audit, Black-Week-Deals, Unterlagen und Support-Wege.

const TABS = [
  { key: "uebersicht", label: "Überblick" },
  { key: "aufgaben", label: "Aufgaben" },
  { key: "marken", label: "Marken (Audit)" },
  { key: "blackweek", label: "Black Week" },
  { key: "unterlagen", label: "Unterlagen & Support" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const today = () => new Date().toISOString().slice(0, 10);
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const eur0 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const inDays = (d: number | null) => (d === null ? "" : d === 0 ? "heute" : d === 1 ? "morgen" : d > 0 ? `in ${d} Tagen` : `seit ${-d} Tagen vorbei`);
const PILOT: Record<SasProgram["pilotStatus"], string> = { auswahl: "Marken auswählen", eingereicht: "Marken eingereicht – Mail vom Appeal Team abwarten", audit: "Audit läuft", bestaetigt: "Authorized Reseller bestätigt", abgelehnt: "Abgelehnt" };
const BRAND_STATUS: Record<SasBrand["status"], string> = { offen: "offen", ausgewaehlt: "ausgewählt", eingereicht: "eingereicht", audit: "im Audit", bestaetigt: "bestätigt", abgelehnt: "abgelehnt" };
const DEAL_STATUS: Record<SasDealView["status"], string> = { pruefen: "prüfen", ja: "einreichen", nein: "nicht einreichen", eingereicht: "eingereicht" };
const VERDICT: Record<SasDealView["calc"]["verdict"], { label: string; cls: string }> = { lohnt: { label: "lohnt", cls: "tag-ok" }, knapp: { label: "knapp", cls: "tag-warn" }, verlust: { label: "Verlust", cls: "tag-critical" }, unklar: { label: "unklar", cls: "tag-neutral" } };

function Countdown({ label, date, testid }: { label: string; date: string | null; testid: string }) {
  const d = daysUntil(today(), date);
  return (
    <div className="sas-count" data-testid={testid}>
      <div className="small muted">{label}</div>
      <div className="sas-count-value" style={d !== null && d >= 0 && d <= 7 ? { color: "var(--danger)" } : undefined}>{date ? dmy(date) : "–"}</div>
      <div className="small muted">{date ? inDays(d) : "noch nicht eingetragen"}</div>
    </div>
  );
}

function ItemRow({ it, readOnly }: { it: SasItem; readOnly: boolean }) {
  const done = it.status === "done";
  const d = daysUntil(today(), it.dueDate);
  return (
    <div className={`sas-item${done ? " sas-item-done" : ""}`} data-testid="sas-item" data-key={it.templateKey ?? ""} id={`t-${it.taskId}`}>
      <form action={updateItemAction}>
        <input type="hidden" name="taskId" value={it.taskId} />
        <input type="hidden" name="done" value={done ? "0" : "1"} />
        <button type="submit" className={`todo-check${done ? " checked" : ""}`} aria-label={done ? "Wieder öffnen" : "Erledigt"} disabled={readOnly} data-testid="sas-item-done">
          {done && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" aria-hidden="true">
              <path d="M5 12l5 5L20 7" />
            </svg>
          )}
        </button>
      </form>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sas-item-title">
          {it.priority === "critical" && !done && <span className="tag tag-critical" style={{ marginRight: 6 }}>WICHTIG</span>}
          {it.title}
        </div>
        <TaskNotes notes={it.notes} className="small muted sas-item-notes" />
        {!done && (
          <form action={updateItemAction} className="sas-item-edit">
            <input type="hidden" name="taskId" value={it.taskId} />
            <select name="waitingOn" defaultValue={it.waitingOn} aria-label="Wer ist dran" disabled={readOnly}>
              {SAS_WAITING.map((w) => <option key={w} value={w}>{WAITING_LABEL[w]}</option>)}
            </select>
            <input type="date" name="dueDate" defaultValue={it.dueDate ?? ""} aria-label="Fällig am" disabled={readOnly} />
            <button className="btn btn-primary btn-small" type="submit" disabled={readOnly}>Speichern</button>
          </form>
        )}
      </div>
      <div className="sas-item-meta">
        <span className={`tag ${it.waitingOn === "ich" ? "tag-info" : "tag-neutral"}`}>{WAITING_LABEL[it.waitingOn].toUpperCase()}</span>
        {it.dueDate && !done && <span className="small" style={{ color: d !== null && d < 0 ? "var(--danger)" : "var(--muted)" }}>{dmy(it.dueDate)} · {inDays(d)}</span>}
      </div>
    </div>
  );
}

export default async function SasPage({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; fehler?: string; filter?: string; q?: string; sort?: string; belege?: string; nur?: string }> }) {
  const session = await requireArea("amazon");
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "uebersicht";
  const t = session.tenantId;
  const ro = session.readOnly;
  const [prog, items] = await Promise.all([getProgram(t), loadItems(t)]);
  const open = items.filter((i) => i.status !== "done");
  const nextSteps = [...open].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.sortOrder - b.sortOrder).slice(0, 5);
  // Markenliste: Kennzahlen täglich frisch (Umsatz, Belege) – nicht bei Nur-ansehen-Konten.
  if (tab === "marken" && !ro) await refreshBrandFactsIfStale(t);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Amazon</div>
          <h1>SAS-Programm</h1>
        </div>
      </div>
      <p className="muted" style={{ margin: "0 0 12px", maxWidth: 820 }}>
        Strategic Account Services (Reseller): alles, was zu tun ist – Authorized-Reseller-Audit, Black-Week-Deals, Portfolio, Termine und Unterlagen. Aufgaben mit Datum stehen auch auf der Startseite.
      </p>
      <nav className="sas-tabs" aria-label="SAS-Bereiche">
        {TABS.map((x) => (
          <Link key={x.key} href={`/sas?tab=${x.key}`} className={`chip${tab === x.key ? " active" : ""}`} data-testid={`sas-tab-${x.key}`}>
            {x.label}
            {x.key === "aufgaben" && open.length ? ` · ${open.length}` : ""}
          </Link>
        ))}
      </nav>
      {sp.ok && <div className="notice notice-ok small" data-testid="sas-ok" style={{ marginBottom: 12 }}>{sp.ok}</div>}
      {sp.fehler && <div className="notice notice-warn small" data-testid="sas-error" style={{ marginBottom: 12 }}>{sp.fehler}</div>}

      {tab === "uebersicht" && <Overview prog={prog} nextSteps={nextSteps} hasPlan={items.some((i) => i.templateKey)} ro={ro} />}
      {tab === "aufgaben" && <Tasks items={items} ro={ro} />}
      {tab === "marken" && <Brands prog={prog} brands={await loadBrands(t)} filter={sp.filter ?? "alle"} q={(sp.q ?? "").trim().slice(0, 60)} sort={sp.sort ?? "umsatz"} coverage={await salesCoverage(t)} evidence={sp.belege && /^[0-9a-f-]{36}$/i.test(sp.belege) ? await brandEvidence(t, sp.belege) : null} onlyUnsure={sp.nur === "pruefen"} ro={ro} />}
      {tab === "blackweek" && <Deals prog={prog} deals={await loadDeals(t)} ro={ro} />}
      {tab === "unterlagen" && <Docs docs={await loadDocuments(t)} ro={ro} />}
    </>
  );
}

function Overview({ prog, nextSteps, hasPlan, ro }: { prog: SasProgram; nextSteps: SasItem[]; hasPlan: boolean; ro: boolean }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-head"><h2>Stand</h2></div>
        <div className="sas-counts">
          <Countdown label="Black-Week-Deals einreichen bis" date={prog.dealDeadline} testid="sas-deadline" />
          <Countdown label="Nächster Termin mit dem Consultant" date={prog.nextMeeting} testid="sas-meeting" />
          <div className="sas-count" data-testid="sas-pilot">
            <div className="small muted">Authorized-Reseller-Pilot</div>
            <div className="sas-count-value" style={{ fontSize: 16 }}>{PILOT[prog.pilotStatus]}</div>
            <div className="small muted">{prog.pilotSubmittedAt ? `eingereicht am ${dmy(prog.pilotSubmittedAt)}` : <Link href="/sas?tab=marken">Marken auswählen →</Link>}</div>
          </div>
        </div>
      </section>

      <section className="card" data-testid="sas-next">
        <div className="card-head"><h2>Als Nächstes</h2><Link href="/sas?tab=aufgaben" className="small">Alle Aufgaben →</Link></div>
        {!hasPlan ? (
          <div className="card-pad" style={{ paddingTop: 0 }}>
            <p className="small muted" style={{ marginTop: 0 }}>Noch kein Fahrplan. Er legt die Schritte aus der Mail und der Kick-off-Präsentation als Aufgaben an: 10 Marken für den Audit wählen, Appeal-Mail abwarten, Unterlagen einreichen, ASIN-Liste für Managed Best Deals anfordern, Black-Week-Deals einreichen, Portfolioanalyse, PanEU, PSTAM-Themen, Business-Plan-Update.</p>
            <form action={createFahrplanAction}><button className="btn btn-primary" type="submit" disabled={ro} data-testid="sas-create-plan">Fahrplan anlegen</button></form>
          </div>
        ) : nextSteps.length === 0 ? (
          <div className="card-pad small muted" style={{ paddingTop: 0 }}>Alles erledigt.</div>
        ) : (
          nextSteps.map((it) => <ItemRow key={it.taskId} it={it} readOnly={ro} />)
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Ansprechpartner & Termine</h2></div>
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <div className="sas-contact" data-testid="sas-contact">
            <div><span className="small muted">Marketplace Consultant</span><div>{prog.consultantName ?? "–"}{prog.consultantEmail && <> · <a href={`mailto:${prog.consultantEmail}`}>{prog.consultantEmail}</a></>}</div></div>
            <div><span className="small muted">PSTAM (technischer Support)</span><div>{prog.pstamName ?? "–"}</div></div>
          </div>
          <details style={{ marginTop: 10 }} open={!prog.consultantName}>
            <summary className="small">Bearbeiten</summary>
            <form action={saveProgramAction} className="sas-form">
              <label>Consultant (Name)<input name="consultantName" defaultValue={prog.consultantName ?? ""} /></label>
              <label>Consultant (E-Mail)<input name="consultantEmail" type="email" defaultValue={prog.consultantEmail ?? ""} /></label>
              <label>PSTAM (Name)<input name="pstamName" defaultValue={prog.pstamName ?? ""} /></label>
              <label>Nächster Termin<input name="nextMeeting" type="date" defaultValue={prog.nextMeeting ?? ""} /></label>
              <label>Black-Week-Frist<input name="dealDeadline" type="date" defaultValue={prog.dealDeadline ?? ""} /></label>
              <label className="sas-form-wide">Notizen<textarea name="notes" rows={3} defaultValue={prog.notes ?? ""} /></label>
              <button className="btn btn-primary" type="submit" disabled={ro} data-testid="sas-save-program">Speichern</button>
            </form>
          </details>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Ziele des Programms</h2></div>
        <div className="card-pad small" style={{ paddingTop: 0 }}>
          <p style={{ marginTop: 0 }}><strong>Authorized Reseller Pilot:</strong> Amazon prüft per Supply-Chain-Audit, dass deine Ware aus legitimen Quellen stammt, und vergibt für diese Marken den Status „Authorized Reseller“. Vorteile: einfachere Listing-Verwaltung, ggf. neue Produkte/Angebote ohne gesonderte Freigabe, Zugang zu Markenaufbau-Tools (z. B. A+ Content). Ablauf: Markenliste einreichen → das Audit-Team meldet sich per Mail → Unterlagen einreichen; insgesamt etwa 3–4 Wochen, Ergebnis nicht garantiert. Danach Erweiterung auf alle Marken und Portfolioanalyse.</p>
          <p><strong>Deals:</strong> Coupons, Self-Service-Deals und – über den Consultant, im Programm kostenfrei – Managed Best Deals für berechtigte ASINs mit Mindestrabatt.</p>
          <p style={{ marginBottom: 0 }}><strong>Zusammenarbeit:</strong> Business-Plan-Update alle 2–3 Monate per Videocall (KPIs, laufende Themen), dazwischen per Mail (gebündelt, Antwort in ca. 72 Stunden), Zufriedenheitsumfrage einmal im Quartal.</p>
        </div>
      </section>
    </div>
  );
}

function Tasks({ items, ro }: { items: SasItem[]; ro: boolean }) {
  const byModule = SAS_MODULES.map((m) => ({ m, list: items.filter((i) => i.module === m) })).filter((g) => g.list.length);
  return (
    <div className="stack" style={{ gap: 16 }}>
      {byModule.map((g) => (
        <section key={g.m} className="card" data-testid={`sas-module-${g.m}`}>
          <div className="card-head"><h2>{MODULE_LABEL[g.m as SasModule]}</h2><span className="small muted">{g.list.filter((i) => i.status !== "done").length} offen</span></div>
          {[...g.list].sort((a, b) => Number(a.status === "done") - Number(b.status === "done")).map((it) => <ItemRow key={it.taskId} it={it} readOnly={ro} />)}
        </section>
      ))}
      <section className="card">
        <div className="card-head"><h2>Neue Aufgabe</h2></div>
        <form action={addItemAction} className="sas-form card-pad" style={{ paddingTop: 0 }}>
          <label className="sas-form-wide">Was ist zu tun?<input name="title" required data-testid="sas-new-title" /></label>
          <label>Bereich<select name="module" defaultValue="sonstiges">{SAS_MODULES.map((m) => <option key={m} value={m}>{MODULE_LABEL[m as SasModule]}</option>)}</select></label>
          <label>Wer ist dran<select name="waitingOn" defaultValue="ich">{SAS_WAITING.map((w) => <option key={w} value={w}>{WAITING_LABEL[w as SasWaiting]}</option>)}</select></label>
          <label>Fällig am<input name="dueDate" type="date" /></label>
          <label className="sas-form-wide">Notiz<textarea name="notes" rows={2} /></label>
          <button className="btn btn-primary" type="submit" disabled={ro} data-testid="sas-add">Anlegen</button>
        </form>
        <form action={createFahrplanAction} className="card-pad small" style={{ paddingTop: 0 }}>
          <button className="btn-link small" type="submit" disabled={ro}>Fehlende Schritte des Standard-Fahrplans ergänzen</button>
        </form>
      </section>
    </div>
  );
}

type Coverage = Awaited<ReturnType<typeof salesCoverage>>;
type Evidence = Awaited<ReturnType<typeof brandEvidence>>;
const SORTS: [string, string][] = [["umsatz", "Umsatz"], ["belege", "Belege"], ["name", "Name"], ["status", "Status"]];

const LEVEL: Record<"sicher" | "text" | "pruefen", { label: string; cls: string }> = { sicher: { label: "sicher", cls: "tag-ok" }, text: { label: "im Text", cls: "tag-neutral" }, pruefen: { label: "prüfen", cls: "tag-warn" } };

function Brands({ prog, brands, filter, q, sort, coverage, evidence, onlyUnsure, ro }: { prog: SasProgram; brands: SasBrand[]; filter: string; q: string; sort: string; coverage: Coverage; evidence: Evidence; onlyUnsure: boolean; ro: boolean }) {
  const selected = brands.filter((b) => b.selected);
  const withEvidence = brands.filter((b) => (b.invoices ?? 0) > 0);
  const salesKnown = coverage.withSales > 0;
  const stateOf = (b: SasBrand) => salesState(b, coverage.rows);
  const byState = { umsatz: 0, kein_umsatz: 0, keine_daten: 0, keine_quelle: 0 };
  for (const b of brands) byState[stateOf(b)]++;
  const withSales = byState.umsatz;
  const unsureTotal = brands.reduce((n, b) => n + (b.invoicesUnsure ?? 0), 0);
  const ql = q.toLowerCase();
  const order = (a: SasBrand, b: SasBrand) =>
    sort === "name" ? a.brand.localeCompare(b.brand, "de") : sort === "belege" ? (b.invoices ?? 0) - (a.invoices ?? 0) || a.brand.localeCompare(b.brand, "de") : sort === "status" ? a.status.localeCompare(b.status) || a.brand.localeCompare(b.brand, "de") : Number(b.sales30 ?? 0) - Number(a.sales30 ?? 0) || (b.invoices ?? 0) - (a.invoices ?? 0) || a.brand.localeCompare(b.brand, "de");
  const shown = (filter === "ausgewaehlt" ? selected : filter === "belege" ? withEvidence : filter === "pruefen" ? brands.filter((b) => (b.invoicesUnsure ?? 0) > 0) : filter === "umsatz" || filter === "kein_umsatz" || filter === "keine_daten" ? brands.filter((b) => stateOf(b) === filter) : brands)
    .filter((b) => !ql || b.brand.toLowerCase().includes(ql))
    .sort((a, b) => Number(b.selected) - Number(a.selected) || order(a, b));
  const link = (p: Record<string, string>) => `/sas?${new URLSearchParams({ tab: "marken", filter, ...(q ? { q } : {}), sort, ...p })}`;
  const mail = auditMail(selected.map((b) => b.brand), prog.consultantName);
  const computed = brands.find((b) => b.computedAt)?.computedAt ?? null;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <details open={brands.length === 0} className="sas-import">
          <summary className="card-head"><h2>{brands.length ? "Markenliste ergänzen" : "Markenliste einlesen"}</h2></summary>
          <div className="card-pad small" style={{ paddingTop: 0 }}>
            <p className="muted" style={{ marginTop: 0 }}>Die Liste des Consultants (XLSX/CSV, eine Spalte mit Marken) – oder je Zeile eine Marke einfügen. Je Marke rechnet das System Produkte und Umsatz der letzten 30 Tage (sellerboard), Belege (Eingangsrechnungen, in denen die Marke vorkommt) und Lieferanten-Angebote aus.</p>
            <form action={importBrandsAction} className="sas-form">
              <label>Datei<input type="file" name="file" accept=".xlsx,.xls,.csv,.txt" data-testid="sas-brands-file" /></label>
              <label className="sas-form-wide">oder Text<textarea name="text" rows={3} placeholder={"Marke A\nMarke B"} data-testid="sas-brands-text" /></label>
              <button className="btn btn-primary" type="submit" disabled={ro} data-testid="sas-brands-import">Einlesen</button>
            </form>
          </div>
        </details>
      </section>

      {brands.length > 0 && (
        <section className="card" data-testid="sas-brands">
          <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2>Marken <span className="small muted" style={{ fontWeight: 400 }}>{brands.length} · {withEvidence.length} mit Belegen · <strong data-testid="sas-selected-count">{selected.length}/10</strong> ausgewählt</span></h2>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <form action={suggestBrandsAction}><button className="btn btn-small" type="submit" disabled={ro} data-testid="sas-suggest" title={salesKnown ? undefined : "Ohne Umsatzdaten zählen nur Belege und Lieferanten-Angebote"}>{salesKnown ? "10 vorschlagen (Belege + Umsatz)" : "10 vorschlagen (nur nach Belegen – Umsatz fehlt)"}</button></form>
              <form action={recomputeBrandsAction}><button className="btn btn-small" type="submit" disabled={ro}>Neu berechnen</button></form>
            </div>
          </div>
          <div className="card-pad small muted" style={{ paddingTop: 0 }}>
            Für den Audit zählen Marken, deren legitimen Einkauf du belegen kannst. Vorschlag: zuerst Marken mit Rechnungen, dann nach Umsatz. Belege = Eingangsrechnungen (keine AGB, Werbung, Bestätigungen), in deren Text die Marke steht – Bankverbindung und Fußzeilen zählen nicht. {computed ? `Stand ${computed.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" })}.` : ""}
          </div>
          <div className="card-pad small" style={{ paddingTop: 0 }} data-testid="sas-sales-coverage">
            {coverage.rows === 0 ? (
              <div className="notice notice-warn">Umsatz 30 Tage: <strong>keine Daten</strong> – sellerboard hat noch keine Produktumsätze geliefert (Anbindungen → sellerboard prüfen, danach „Neu berechnen“). Bis dahin bewertet der Vorschlag nur Belege und Lieferanten-Angebote, nicht den Umsatz.</div>
            ) : !salesKnown ? (
              <div className="notice notice-warn">Umsatz 30 Tage: sellerboard liefert {coverage.rows} Produkte, aber keines mit Umsatz (Stand {coverage.synced?.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }) ?? "–"}). Der Vorschlag ist deshalb keine Umsatzbewertung.</div>
            ) : withSales === 0 ? (
              <div className="notice notice-warn">Umsatz 30 Tage: {coverage.withSales} Produkte mit Umsatz laut sellerboard, aber in keinem Produktnamen kommt eine der Marken vor – die Zuordnung läuft über den Namen. Der Vorschlag ist deshalb keine Umsatzbewertung.</div>
            ) : (
              <span className="muted">
                Umsatz 30 Tage: sellerboard, {coverage.from ? `${coverage.from.split("-").reverse().join(".")}–${coverage.to!.split("-").reverse().join(".")}` : ""} · {coverage.withSales} Produkte mit Umsatz. Von {brands.length} Marken: <strong data-testid="sas-count-umsatz">{byState.umsatz}</strong> mit Umsatz, <strong data-testid="sas-count-kein-umsatz">{byState.kein_umsatz}</strong> <span title={SALES_STATE.kein_umsatz.hint}>ohne Umsatz (Produkte da, 30 Tage nichts verkauft)</span>, <strong data-testid="sas-count-keine-daten">{byState.keine_daten}</strong> <span title={SALES_STATE.keine_daten.hint}>ohne Daten (Marke in keinem sellerboard-Produktnamen – Umsatz unbekannt, nicht 0)</span>.
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 22px 10px", alignItems: "center" }}>
            {[["alle", "Alle"], ["ausgewaehlt", "Ausgewählt"], ["belege", "Mit Belegen"], ...(unsureTotal ? [["pruefen", "Belege prüfen"]] : []), ["umsatz", "Mit Umsatz"], ["kein_umsatz", "Kein Umsatz"], ["keine_daten", "Keine Daten"]].map(([k, l]) => (
              <Link key={k} href={link({ filter: k })} className={`chip${filter === k ? " active" : ""}`} data-testid={`sas-filter-${k}`}>{l}</Link>
            ))}
            <form action="/sas" style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <input type="hidden" name="tab" value="marken" />
              <input type="hidden" name="filter" value={filter} />
              <input type="hidden" name="sort" value={sort} />
              <input className="input" name="q" defaultValue={q} placeholder="Marke suchen" aria-label="Marke suchen" style={{ width: 170, padding: "4px 8px" }} data-testid="sas-brand-search" />
            </form>
            <span className="small muted">Sortieren:</span>
            {SORTS.map(([k, l]) => <Link key={k} href={link({ sort: k })} className={`chip${sort === k ? " active" : ""}`} data-testid={`sas-sort-${k}`}>{l}</Link>)}
          </div>
          {evidence && <EvidencePanel evidence={evidence} close={link({})} filterLink={(nur) => `${link({ belege: evidence.brand.id, ...(nur ? { nur } : {}) })}#belege`} onlyUnsure={onlyUnsure} keep={{ filter, sort, q }} ro={ro} />}
          <div className="sales-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Audit</th>
                  <th>Marke</th>
                  <th className="right">Umsatz 30 T.</th>
                  <th className="right">Produkte</th>
                  <th className="right">Belege</th>
                  <th className="right">Lieferanten</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 400).map((b) => (
                  <tr key={b.id} data-testid="sas-brand-row" data-brand={b.brand} data-selected={b.selected ? "1" : "0"}>
                    <td>
                      <form action={selectBrandAction}>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="selected" value={b.selected ? "0" : "1"} />
                        <button type="submit" className={`todo-check${b.selected ? " checked" : ""}`} aria-label={b.selected ? "Abwählen" : "Für den Audit auswählen"} disabled={ro || !["offen", "ausgewaehlt"].includes(b.status)} data-testid="sas-brand-toggle">
                          {b.selected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}
                        </button>
                      </form>
                    </td>
                    <td><strong>{b.brand}</strong></td>
                    <SalesCell b={b} state={stateOf(b)} />
                    <td className="right num">{b.products || "–"}</td>
                    <td className="right num" style={(b.invoices ?? 0) > 0 ? { color: "var(--ok)", fontWeight: 600 } : undefined}>
                      {(b.invoices ?? 0) > 0 ? <Link href={`${link({ belege: b.id })}#belege`} title="Belege mit Fundstelle ansehen und prüfen" data-testid="sas-brand-evidence">{b.invoices}</Link> : "–"}
                      {(b.invoicesUnsure ?? 0) > 0 && <div className="small" style={{ color: "var(--warn)", fontWeight: 400 }} data-testid="sas-brand-unsure">{b.invoicesUnsure} prüfen</div>}
                      {(b.invoices ?? 0) > 0 && (b.invoicesConfirmed ?? 0) === b.invoices && <div className="small muted" style={{ fontWeight: 400 }}>alle bestätigt</div>}
                    </td>
                    <td className="right num">{b.supplierOffers || "–"}</td>
                    <td>
                      <BrandStatusSelect id={b.id} status={b.status} options={SAS_BRAND_STATUS.map((s) => [s, BRAND_STATUS[s]])} action={brandStatusAction} disabled={ro} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selected.length > 0 && (
        <section className="card" data-testid="sas-mail">
          <div className="card-head"><h2>Auswahl an den Consultant</h2><span className="small muted">{selected.length} von 10</span></div>
          <div className="card-pad" style={{ paddingTop: 0 }}>
            <textarea readOnly rows={Math.min(22, 12 + selected.length)} value={`Betreff: ${mail.subject}\n\n${mail.body}`} className="sas-mail-text" data-testid="sas-mail-text" />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
              <CopyButton text={mail.body} label="Text kopieren" />
              {prog.consultantEmail && <a className="btn btn-small" href={`mailto:${prog.consultantEmail}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`}>Im Mailprogramm öffnen</a>}
              {prog.pilotStatus === "auswahl" && (
                <form action={submitPilotAction}><button className="btn btn-primary btn-small" type="submit" disabled={ro || selected.length === 0} data-testid="sas-submit-pilot">Gesendet – als eingereicht markieren</button></form>
              )}
            </div>
            {selected.length < 10 && <p className="small muted" style={{ marginBottom: 0 }}>Noch {10 - selected.length} Marke(n) für zehn.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function SalesCell({ b, state }: { b: SasBrand; state: ReturnType<typeof salesState> }) {
  if (state === "umsatz") return <td className="right num" data-testid="sas-sales" data-state={state}>{eur0(Number(b.sales30))}</td>;
  if (state === "kein_umsatz")
    return (
      <td className="right num" data-testid="sas-sales" data-state={state} title={SALES_STATE.kein_umsatz.hint}>
        0 €<div className="small muted">kein Umsatz</div>
      </td>
    );
  return (
    <td className="right small" data-testid="sas-sales" data-state={state} title={SALES_STATE[state].hint} style={{ color: "var(--warn)" }}>
      {SALES_STATE[state].label}
    </td>
  );
}

function EvidencePanel({ evidence, close, filterLink, onlyUnsure, keep, ro }: { evidence: NonNullable<Evidence>; close: string; filterLink: (nur?: string) => string; onlyUnsure: boolean; keep: Record<string, string>; ro: boolean }) {
  const s = evidence.summary;
  const hits = onlyUnsure ? evidence.hits.filter((h) => h.verdict === null && h.level === "pruefen") : evidence.hits;
  const dmyOf = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");
  return (
    <div className="card-pad" style={{ paddingTop: 0, scrollMarginTop: 70 }} id="belege" data-testid="sas-evidence">
      <div className="notice notice-info small">
        <div className="between">
          <strong>Belege für „{evidence.brand.brand}“: {s.total}</strong>
          <Link href={close}>schließen ✕</Link>
        </div>
        <div className="muted" data-testid="sas-evidence-summary" style={{ margin: "2px 0 6px" }}>
          {s.bestaetigt} von dir bestätigt · {s.sicher} sicher (Lieferant oder Rechnungsposition) · {s.text} im Text · <span style={s.pruefen ? { color: "var(--warn)", fontWeight: 600 } : undefined}>{s.pruefen} prüfen</span>
          {s.falsch ? ` · ${s.falsch} als falsch markiert (zählen nicht)` : ""}
        </div>
        <div className="muted" style={{ marginBottom: 6 }}>
          Nachweis: Jede Zeile zeigt die Fundstelle im Beleg. „Stimmt“ bestätigt die Zuordnung, „Falsch“ nimmt den Beleg aus der Zählung – nichts wird gelöscht, jede Entscheidung lässt sich zurücknehmen.
          {" "}
          {onlyUnsure ? <Link href={filterLink()}>alle zeigen</Link> : s.pruefen > 0 ? <Link href={filterLink("pruefen")} data-testid="sas-evidence-only-unsure">nur die {s.pruefen} zu prüfenden</Link> : null}
        </div>
        {hits.length === 0 ? (
          <div>{evidence.all === 0 ? "Keine Rechnung enthält die Marke (Bankverbindung und Fußzeilen ausgenommen)." : "Keine offenen Prüffälle."}</div>
        ) : (
          <ul style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none" }}>
            {hits.map((h) => (
              <li key={h.id} id={`b-${h.id}`} className="sas-evidence-row" data-testid="sas-evidence-row" data-level={h.level} data-verdict={h.verdict ?? ""} style={h.verdict === "falsch" ? { opacity: 0.6 } : undefined}>
                <div className="sas-evidence-head">
                  {h.verdict === "stimmt" ? <span className="tag tag-ok">BESTÄTIGT</span> : h.verdict === "falsch" ? <span className="tag tag-critical">FALSCH</span> : <span className={`tag ${LEVEL[h.level].cls}`}>{LEVEL[h.level].label.toUpperCase()}</span>}
                  <Link href={`/rechnungen/${h.id}`} style={h.verdict === "falsch" ? { textDecoration: "line-through" } : undefined}>{h.vendor ?? h.fileName}</Link>
                  <span className="muted">{dmyOf(h.invoiceDate)}{h.invoiceNumber ? ` · Nr. ${h.invoiceNumber}` : ""}</span>
                </div>
                <div className="muted">„{h.snippet}“ <span className="small">– {h.reason}</span></div>
                <form action={evidenceVerdictAction} className="sas-evidence-actions">
                  <input type="hidden" name="brandId" value={evidence.brand.id} />
                  <input type="hidden" name="invoiceId" value={h.id} />
                  {Object.entries(keep).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                  {onlyUnsure && <input type="hidden" name="nur" value="pruefen" />}
                  {h.verdict === null ? (
                    <>
                      <button className="btn btn-small" type="submit" name="verdict" value="stimmt" disabled={ro} data-testid="sas-evidence-ok">Stimmt</button>
                      <button className="btn btn-small" type="submit" name="verdict" value="falsch" disabled={ro} data-testid="sas-evidence-wrong">Falsch</button>
                    </>
                  ) : (
                    <button className="btn-link small" type="submit" name="verdict" value="zuruecksetzen" disabled={ro} data-testid="sas-evidence-reset">zurücknehmen</button>
                  )}
                </form>
              </li>
            ))}
          </ul>
        )}
        {evidence.all > evidence.shown && <div className="muted">… und {evidence.all - evidence.shown} weitere.</div>}
      </div>
    </div>
  );
}

function Deals({ prog, deals, ro }: { prog: SasProgram; deals: SasDealView[]; ro: boolean }) {
  const d = daysUntil(today(), prog.dealDeadline);
  const yes = deals.filter((x) => x.status === "ja" || x.status === "eingereicht");
  const count = (v: SasDealView["calc"]["verdict"]) => deals.filter((x) => x.calc.verdict === v).length;
  const list = yes.map((x) => `${x.asin}\t${x.minDiscountPct !== null ? `${Number(x.minDiscountPct).toLocaleString("de-DE")} %` : "–"}\t${x.name ?? x.title ?? ""}`).join("\n");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-head"><h2>Black Week / Black Friday</h2><span className="small" style={{ color: d !== null && d <= 7 ? "var(--danger)" : "var(--muted)" }} data-testid="sas-deal-deadline">Einreichen bis {dmy(prog.dealDeadline)} · {inDays(d)}</span></div>
        <div className="card-pad small" style={{ paddingTop: 0 }}>
          <p className="muted" style={{ marginTop: 0 }}>Möglich sind Coupons, Self-Service-Deals und über den Consultant (kostenfrei) Managed Best Deals für berechtigte ASINs mit Mindestrabatt. Liste des Consultants hier einlesen (XLSX/CSV mit ASIN und Mindestrabatt) – je ASIN steht dann der Gewinn je Stück nach Rabatt, der Bestand und eine Empfehlung.</p>
          <form action={importDealsAction} className="sas-form">
            <label>Datei<input type="file" name="file" accept=".xlsx,.xls,.csv,.txt" data-testid="sas-deals-file" /></label>
            <label className="sas-form-wide">oder Text (ASIN; Rabatt %)<textarea name="text" rows={3} placeholder={"ASIN;Mindestrabatt\nB0…;20%"} data-testid="sas-deals-text" /></label>
            <button className="btn btn-primary" type="submit" disabled={ro} data-testid="sas-deals-import">Einlesen</button>
          </form>
        </div>
      </section>
      {deals.length > 0 && (
        <section className="card" data-testid="sas-deals">
          <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2>Berechtigte ASINs <span className="small muted" style={{ fontWeight: 400 }}>{deals.length} · {count("lohnt")} lohnen · {count("knapp")} knapp · {count("verlust")} Verlust · {count("unklar")} unklar</span></h2>
            <form action={clearDealsAction}><button className="btn-link small" type="submit" disabled={ro}>Liste leeren</button></form>
          </div>
          <div className="sales-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>ASIN / Produkt</th>
                  <th className="right">Mindest&shy;rabatt</th>
                  <th className="right">Preis jetzt</th>
                  <th className="right">Deal-Preis</th>
                  <th className="right">Gewinn/Stück jetzt → Deal</th>
                  <th className="right">Bestand</th>
                  <th>Empfehlung</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((x) => (
                  <tr key={x.id} data-testid="sas-deal-row" data-asin={x.asin} data-verdict={x.calc.verdict}>
                    <td>
                      <div className="num">{x.asin}</div>
                      <div className="small muted" style={{ maxWidth: 320 }}>{x.name ?? x.title ?? "nicht in sellerboard"}{x.sku ? ` · ${x.sku}` : ""}</div>
                    </td>
                    <td className="right num">{x.minDiscountPct !== null ? `${Number(x.minDiscountPct).toLocaleString("de-DE")} %` : "–"}</td>
                    <td className="right num">{eur(x.price)}</td>
                    <td className="right num">{eur(x.calc.dealPrice)}</td>
                    <td className="right num" data-testid="sas-deal-profit">
                      {eur(x.calc.profitNow)} → <span style={x.calc.profit !== null && x.calc.profit < 0 ? { color: "var(--danger)" } : undefined}>{eur(x.calc.profit)}</span>
                    </td>
                    <td className="right num">{x.stock ?? "–"}{x.daysLeft !== null ? <div className="small muted">{x.daysLeft} Tage</div> : null}</td>
                    <td>
                      <span className={`tag ${VERDICT[x.calc.verdict].cls}`}>{VERDICT[x.calc.verdict].label.toUpperCase()}</span>
                      <div className="small muted" style={{ maxWidth: 220 }}>{x.calc.reason}{x.stock !== null && x.stock < 10 ? " Wenig Bestand." : ""}</div>
                    </td>
                    <td>
                      <form action={dealStatusAction} style={{ display: "flex", gap: 4 }}>
                        <input type="hidden" name="id" value={x.id} />
                        <select name="status" defaultValue={x.status} aria-label="Status" disabled={ro}>
                          {SAS_DEAL_STATUS.map((s) => <option key={s} value={s}>{DEAL_STATUS[s]}</option>)}
                        </select>
                        <button className="btn btn-small" type="submit" disabled={ro}>OK</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {yes.length > 0 && (
            <div className="card-pad">
              <div className="small" style={{ marginBottom: 6 }}><strong>{yes.length} zum Einreichen</strong> – Liste für den Consultant:</div>
              <textarea readOnly rows={Math.min(12, yes.length + 1)} value={list} className="sas-mail-text" data-testid="sas-deal-list" />
              <div style={{ marginTop: 6 }}><CopyButton text={list} label="Liste kopieren" /></div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Docs({ docs, ro }: { docs: Awaited<ReturnType<typeof loadDocuments>>; ro: boolean }) {
  const KIND: Record<string, string> = { praesentation: "Präsentation", markenliste: "Markenliste", asin_liste: "ASIN-Liste", nachweis: "Audit-Nachweis", sonstiges: "Sonstiges" };
  const dups = findDuplicateDocs(docs);
  const doubles = [...dups.values()].filter((d) => d.kind === "doppelt").length;
  const day = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" data-testid="sas-docs">
        <div className="card-head"><h2>Unterlagen</h2><span className="small muted">verschlüsselt gespeichert</span></div>
        {doubles > 0 && (
          <div className="card-pad" style={{ paddingTop: 0 }}>
            <div className="notice notice-warn small" data-testid="sas-doc-dups">
              {doubles === 1 ? "1 Unterlage ist doppelt" : `${doubles} Unterlagen sind doppelt`} (gleicher Inhalt wie eine ältere). Entfernen geht nur per Klick bei der jeweiligen Zeile – das Original bleibt immer.
            </div>
          </div>
        )}
        {docs.length === 0 ? (
          <div className="card-pad small muted" style={{ paddingTop: 0 }}>Noch keine Unterlagen. Präsentation, Markenliste, ASIN-Liste und Audit-Nachweise hier ablegen.</div>
        ) : (
          docs.map((doc) => {
            const dup = dups.get(doc.id);
            return (
              <div key={doc.id} className="sas-item" data-testid="sas-doc" data-dup={dup?.kind ?? ""}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={`/sas/datei/${doc.id}`} target="_blank" rel="noreferrer">{doc.name}</a>
                  {dup?.kind === "doppelt" && <span className="tag tag-warn" style={{ marginLeft: 6 }}>DOPPELT</span>}
                  {dup?.kind === "aehnlich" && <span className="tag tag-neutral" style={{ marginLeft: 6 }}>GLEICHER NAME</span>}
                  <div className="small muted">{KIND[doc.kind]} · {(doc.size / 1024).toLocaleString("de-DE", { maximumFractionDigits: 0 })} KB · {day(doc.createdAt)}</div>
                  {dup?.kind === "doppelt" && <div className="small" style={{ color: "var(--warn)" }}>Gleicher Inhalt wie „{dup.of.name}“ vom {day(dup.of.createdAt)}.</div>}
                  {dup?.kind === "aehnlich" && <div className="small muted">Gleicher Name und Größe wie „{dup.of.name}“ vom {day(dup.of.createdAt)}, aber anderer Inhalt – beide behalten.</div>}
                </div>
                <form action={deleteDocumentAction}>
                  <input type="hidden" name="id" value={doc.id} />
                  {dup?.kind === "doppelt" ? (
                    <>
                      <input type="hidden" name="doppel" value="1" />
                      <button className="btn btn-small" type="submit" disabled={ro} data-testid="sas-doc-remove-dup">Doppel entfernen</button>
                    </>
                  ) : (
                    <button className="btn-link small danger" type="submit" disabled={ro}>Löschen</button>
                  )}
                </form>
              </div>
            );
          })
        )}
        <form action={uploadDocumentAction} className="sas-form card-pad">
          <label>Datei<input type="file" name="file" required data-testid="sas-doc-file" /></label>
          <label>Art<select name="kind" defaultValue="sonstiges">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <button className="btn btn-primary" type="submit" disabled={ro} data-testid="sas-doc-upload">Hochladen</button>
        </form>
      </section>

      <section className="card">
        <div className="card-head"><h2>Wen kontaktiere ich wofür?</h2></div>
        <div className="sales-scroll">
          <table className="table">
            <thead><tr><th>Wer</th><th>Wofür</th><th>Wie</th></tr></thead>
            <tbody>
              <tr><td><strong>Marketplace Consultant</strong></td><td>Strategie, Wachstum, Programm-Module (Audit, Deals, Portfolio), weitere Amazon-Programme, nicht-operative Fragen</td><td>E-Mail (gebündelt, Antwort ca. 72 h)</td></tr>
              <tr><td><strong>Premium Seller Support</strong></td><td>FBA-Probleme, falsche Produktdetails, Flatfiles, Listing-Probleme, operative Störungen</td><td>Fall im Seller Central</td></tr>
              <tr><td><strong>PSTAM (technischer Support)</strong></td><td>Wenn der Premium Support das Problem nicht löst oder der Fall seit mehr als 2 Tagen offen ist (je Store ein eigener Fall); Updates über den Primary Case</td><td>Seller Central, Primary Case</td></tr>
              <tr><td><strong>Account Health Support</strong></td><td>Verkäuferleistung, Konto- oder Listing-Sperren, Richtlinien-Warnungen</td><td>Seller Central → Kontozustand</td></tr>
              <tr><td><strong>EPS (Eskalation)</strong></td><td>Wenn Account Health einen Widerspruch abgelehnt hat oder nach 72 h nicht geantwortet hat (Fall-ID nötig)</td><td>EPS-Formular</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card-pad small muted">Für einen guten Fall: Problem klar beschreiben (wo, was passiert), bisherige Schritte, gewünschtes Ergebnis, alle Angaben (FNSKU, Sendungsnummer, Marke, EAN) und frühere Fall-IDs.</div>
      </section>
    </div>
  );
}
