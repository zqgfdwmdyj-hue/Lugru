import { todayIso } from "@/lib/dates";
import { fairness, fuerMich, gruppeVon, GRUPPE_TEXT, KATEGORIEN, type FamilienAufgabe, type Gruppe } from "@/lib/private/familie-aufgaben";
import { loadEntries, myPartner, privateSettings, requirePrivate, type Entry } from "@/lib/private/service";
import { StateForm } from "../state-form";
import { PrivatHead, dmy } from "../ui";
import { fairnessUmschaltenAction, familienAufgabeAbhakenAction, familienAufgabeAnlegenAction, familienAufgabeLoeschenAction, familienAufgabeZustaendigAction } from "./actions";

// Gemeinsame Familien-Aufgabenliste (Haushalt, Kinder, Arzt, Geld, Geschenke) – auch für den Familien-Zugang.

const WIED = { einmal: "", woechentlich: "wöchentlich", monatlich: "monatlich", jaehrlich: "jährlich" } as const;
const GRUPPEN: Gruppe[] = ["ueberfaellig", "woche", "spaeter", "ohne", "erledigt"];

export default async function FamilienAufgabenPage({ searchParams }: { searchParams: Promise<{ nur?: string; kat?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const heute = todayIso();
  const s = await privateSettings(session.tenantId);
  const ich = myPartner(s, session);
  const alle = await loadEntries<FamilienAufgabe>(session, ["familienaufgabe"]);
  const name = (z: FamilienAufgabe["zustaendig"]) => (z === "a" ? s.partners.a : z === "b" ? s.partners.b : "beide");
  const liste = alle
    .map((e) => ({ ...e, data: { ...e.data, erledigt: e.data.erledigt ?? [] } }))
    .filter((e) => (sp.nur !== "meine" || fuerMich(e.data, ich)) && (!sp.kat || e.data.kategorie === sp.kat))
    .sort((a, b) => (a.data.faellig ?? "9999").localeCompare(b.data.faellig ?? "9999"));
  const fair = s.familienFairness ? fairness(alle.map((e) => ({ ...e.data, erledigt: e.data.erledigt ?? [] })), heute) : null;

  const Zeile = ({ e }: { e: Entry<FamilienAufgabe> }) => {
    const a = e.data;
    const g = gruppeVon(a, heute);
    const zuletzt = a.erledigt[a.erledigt.length - 1];
    return (
      <div className="card card-pad" style={{ padding: 12, display: "flex", gap: 10, alignItems: "flex-start" }} data-testid="fam-aufgabe">
        <form action={familienAufgabeAbhakenAction}>
          <input type="hidden" name="id" value={e.id} />
          <button className={`btn btn-small${a.abgeschlossen ? " btn-primary" : ""}`} type="submit" aria-pressed={!!a.abgeschlossen} title={a.wiederholung === "einmal" ? "erledigt / wieder offen" : "erledigt – nächster Termin"} style={{ minWidth: 40 }} data-testid="fam-abhaken">
            {a.abgeschlossen ? "✓" : "○"}
          </button>
        </form>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, textDecoration: a.abgeschlossen ? "line-through" : undefined }}>{a.titel}</div>
          <div className="small muted">
            {KATEGORIEN[a.kategorie]} · {name(a.zustaendig)}
            {a.faellig && <span style={g === "ueberfaellig" ? { color: "var(--danger)" } : undefined}> · {a.abgeschlossen ? "" : "fällig "}{dmy(a.faellig)}</span>}
            {a.wiederholung !== "einmal" && <> · {WIED[a.wiederholung]}</>}
            {zuletzt && <> · zuletzt {dmy(zuletzt.am)} ({zuletzt.von === "a" ? s.partners.a : s.partners.b})</>}
            {a.quelle && <> · aus {a.quelle}</>}
          </div>
          {a.notiz && <div className="small" style={{ marginTop: 4, whiteSpace: "pre-line" }}>{a.notiz}</div>}
          <details style={{ marginTop: 4 }}>
            <summary className="small" style={{ cursor: "pointer" }}>ändern</summary>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
              <form action={familienAufgabeZustaendigAction} style={{ display: "flex", gap: 6 }}>
                <input type="hidden" name="id" value={e.id} />
                <select className="select" name="zustaendig" defaultValue={a.zustaendig} aria-label="zuständig" style={{ height: 30 }}>
                  <option value="a">{s.partners.a}</option>
                  <option value="b">{s.partners.b}</option>
                  <option value="beide">beide</option>
                </select>
                <button className="btn btn-small" type="submit">übernehmen</button>
              </form>
              <form action={familienAufgabeLoeschenAction}>
                <input type="hidden" name="id" value={e.id} />
                <button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>löschen</button>
              </form>
            </div>
          </details>
        </div>
      </div>
    );
  };

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ nur: sp.nur, kat: sp.kat, ...patch })) if (v) p.set(k, v);
    return `/privat/familienaufgaben${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PrivatHead active="familienaufgaben" title="Familien-Aufgaben" />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <a href={link({ nur: undefined })} className={`chip${sp.nur !== "meine" ? " active" : ""}`}>Alle</a>
        <a href={link({ nur: "meine" })} className={`chip${sp.nur === "meine" ? " active" : ""}`} data-testid="fam-meine">Meine{ich ? ` (${ich === "a" ? s.partners.a : s.partners.b})` : ""}</a>
        <span className="muted small" style={{ alignSelf: "center" }}>·</span>
        <a href={link({ kat: undefined })} className={`chip${!sp.kat ? " active" : ""}`}>alle Bereiche</a>
        {Object.entries(KATEGORIEN).map(([k, l]) => (
          <a key={k} href={link({ kat: k })} className={`chip${sp.kat === k ? " active" : ""}`}>{l}</a>
        ))}
      </div>

      <details className="card card-pad" style={{ marginBottom: 14 }} open={alle.length === 0}>
        <summary><strong>+ Aufgabe</strong></summary>
        <StateForm action={familienAufgabeAnlegenAction} submit="Anlegen" testid="fam-neu">
          <input className="input" name="titel" placeholder="z. B. Kita-Beitrag überweisen, Geschenk Oma" required aria-label="Aufgabe" />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="small">zuständig
              <select className="select" name="zustaendig" defaultValue={ich ?? "beide"}>
                <option value="a">{s.partners.a}</option>
                <option value="b">{s.partners.b}</option>
                <option value="beide">beide</option>
              </select>
            </label>
            <label className="small">fällig<input className="input" type="date" name="faellig" /></label>
            <label className="small">wiederkehrend
              <select className="select" name="wiederholung" defaultValue="einmal">
                <option value="einmal">einmalig</option>
                <option value="woechentlich">wöchentlich</option>
                <option value="monatlich">monatlich</option>
                <option value="jaehrlich">jährlich</option>
              </select>
            </label>
            <label className="small">Bereich
              <select className="select" name="kategorie" defaultValue="haushalt">
                {Object.entries(KATEGORIEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
          <textarea className="input" name="notiz" rows={2} placeholder="Notiz (optional)" aria-label="Notiz" />
        </StateForm>
      </details>

      {liste.length === 0 && <div className="card card-pad small muted" data-testid="fam-leer">Keine Aufgaben{sp.nur || sp.kat ? " in dieser Auswahl" : ""}.</div>}
      {GRUPPEN.map((g) => {
        const teil = liste.filter((e) => gruppeVon(e.data, heute) === g);
        if (!teil.length) return null;
        return (
          <section key={g} style={{ marginBottom: 14 }} data-testid={`fam-gruppe-${g}`}>
            <h2 style={{ fontSize: 16, color: g === "ueberfaellig" ? "var(--danger)" : undefined }}>{GRUPPE_TEXT[g]} <span className="muted small">{teil.length}</span></h2>
            <div className="stack" style={{ gap: 8 }}>{(g === "erledigt" ? teil.slice(-20).reverse() : teil).map((e) => <Zeile key={e.id} e={e} />)}</div>
          </section>
        );
      })}

      <section className="card card-pad" style={{ marginTop: 10 }} data-testid="fam-fairness">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Wer hat wie viel übernommen?</strong>
          <form action={fairnessUmschaltenAction}><button className="btn-link small" type="submit">{fair ? "Übersicht ausschalten" : "Übersicht einschalten"}</button></form>
        </div>
        {fair ? (
          <div className="small" style={{ marginTop: 6 }}>
            Letzte 30 Tage: {s.partners.a} {fair.a} · {s.partners.b} {fair.b}
            {Object.keys(fair.jeKategorie).length > 0 && (
              <div className="muted" style={{ marginTop: 4 }}>
                {Object.entries(fair.jeKategorie).map(([k, v]) => `${KATEGORIEN[k as keyof typeof KATEGORIEN]}: ${v.a}/${v.b}`).join(" · ")}
              </div>
            )}
          </div>
        ) : (
          <div className="small muted" style={{ marginTop: 4 }}>Ausgeschaltet (Standard). Zählt nur, wer eine Aufgabe abgehakt hat – keine Bewertung.</div>
        )}
      </section>
    </>
  );
}
