import Link from "next/link";
import type { DealAnkauf, DealEingangZeile } from "@/db/tables/deal-eingang";
import { ANKAUF_AUSGANG, ANKAUF_ZAHLUNGSZIEL_STANDARD, LEGIT_CHECK, ankaufAktiv, ankaufCheckliste, ausstiegVergleich, type Ausstieg } from "@/lib/deal-eingang/ankauf-logic";
import { formatEuro } from "@/lib/numbers";
import { ankaufAction, ankaufAusgangAction } from "../actions";

// B34.4/5 Ausstieg „Amazon oder Ankauf“ am Deal – nur für den Inhaber (Insider-Wissen, nie in Texten nach außen).

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatEuro(n));
const pz = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${String(n).replace(".", ",")} %`);
const zahl = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

export type AmazonAusstieg = { land: string | null; gewinnStk: number | null; vkBrutto: number | null; tage: number | null; ekPruefung: number | null };

type Props = {
  id: string;
  zeilen: DealEingangZeile[];
  ankauf: DealAnkauf | null;
  amazon: Map<number, AmazonAusstieg>;
  gekauft: { menge: number | null; preis: number | null; am: Date | null };
  schreiben: boolean;
  wissenId: string | null;
  heute: string;
};

/** Zahlen für eine Angebotszeile: EK (gekaufter Preis vor Prüf-EK), Menge, Vergleich. */
export function ausstiegFuer(p: Pick<Props, "zeilen" | "ankauf" | "amazon" | "gekauft">) {
  const a = p.ankauf;
  const z = p.zeilen.find((x) => x.nr === a?.zeile) ?? p.zeilen.find((x) => x.asin) ?? p.zeilen[0] ?? null;
  if (!z) return null;
  const am = p.amazon.get(z.nr) ?? { land: null, gewinnStk: null, vkBrutto: null, tage: null, ekPruefung: null };
  const ek = p.gekauft.preis ?? z.ekNetto ?? null;
  // Gewinn bei Amazon aus der Prüfung gilt für den Prüf-EK – bei anderem Kaufpreis um die Differenz verschieben.
  const gewinnAmazon = am.gewinnStk !== null && am.ekPruefung !== null && ek !== null ? am.gewinnStk - (ek - am.ekPruefung) : am.gewinnStk;
  // Geplante bzw. gekaufte Menge – die angemeldete Menge nur als letzter Ersatz (sonst prüfte sie sich selbst).
  const menge = p.gekauft.menge ?? z.empfohlen ?? z.angebot.menge ?? z.angebot.moq ?? a?.mengeAngemeldet ?? null;
  const v = ausstiegVergleich({ ek, menge, rueckProzent: a?.rueckverguetungProzent ?? 0, amazon: { gewinnStk: gewinnAmazon, vkBrutto: am.vkBrutto, tage: am.tage }, ankauf: { preis: a?.preis ?? null, tage: a?.zahlungszielTage ?? null } });
  return { z, am, ek, menge, v };
}

function Zeile({ name, k, a, b, fmt }: { name: string; k: keyof Ausstieg; a: Ausstieg; b: Ausstieg; fmt: (n: number | null) => string }) {
  return (
    <tr>
      <td>{name}</td>
      <td data-testid={`de-ausstieg-amazon-${k}`}>{fmt(a[k])}</td>
      <td data-testid={`de-ausstieg-ankauf-${k}`}>{fmt(b[k])}</td>
    </tr>
  );
}

/** Abschnitt „Ausstieg: Amazon oder Ankauf“ (Formular, Vergleich nebeneinander, Checkliste, Ausgang). */
export function AnkaufAbschnitt(p: Props) {
  const a = p.ankauf;
  const aktiv = ankaufAktiv(a);
  const r = ausstiegFuer(p);
  const mitAsin = p.zeilen.filter((z) => z.asin);
  const check = aktiv && r ? ankaufCheckliste(a, r.menge, p.heute) : [];
  return (
    <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="ankauf" data-testid="de-ankauf" data-aktiv={aktiv ? "1" : "0"}>
      <h2 style={{ margin: 0 }}>Ausstieg: Amazon oder Ankauf</h2>
      <div className="small muted">
        Ankauf = Ware zu festem Preis an einen Ankäufer statt über Amazon. Nur intern (Insider-Wissen) – nie in Deal-Blätter, Kundenmails oder den B2B-Kanal. Gekauft wird nie automatisch, fremde Discord-Server werden nicht mitgelesen.
        {p.wissenId ? <> · <Link href={`/wissen/${p.wissenId}`} data-testid="de-ankauf-wissen">Wissen: Ankaufserver (Einzelmeinung, ungeprüft)</Link></> : null}
      </div>
      {p.schreiben && (
        <form action={ankaufAction} className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }} data-testid="de-ankauf-form">
          <input type="hidden" name="id" value={p.id} />
          {mitAsin.length > 1 && (
            <label className="stack" style={{ gap: 2 }}>Angebot<select name="zeile" defaultValue={String(r?.z.nr ?? "")}>{mitAsin.map((z) => <option key={z.nr} value={z.nr}>{(z.titel ?? z.angebot.name ?? z.asin ?? "").slice(0, 40)}</option>)}</select></label>
          )}
          {mitAsin.length <= 1 && r && <input type="hidden" name="zeile" value={r.z.nr} />}
          <label className="stack" style={{ gap: 2 }}>Ankaufspreis netto/Stk<input className="input" name="preis" inputMode="decimal" defaultValue={zahl(a?.preis)} style={{ width: 90 }} data-testid="de-ankauf-preis" /></label>
          <label className="stack" style={{ gap: 2 }}>Ankäufer<input className="input" name="ankaeufer" defaultValue={a?.ankaeufer ?? ""} style={{ width: 150 }} data-testid="de-ankauf-ankaeufer" /></label>
          <label className="stack" style={{ gap: 2 }}>Rang/Legit-Check<select name="legit" defaultValue={a?.legitCheck ?? "offen"} data-testid="de-ankauf-legit">{Object.entries(LEGIT_CHECK).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label className="stack" style={{ gap: 2 }}>Notiz Check<input className="input" name="legit_notiz" defaultValue={a?.legitNotiz ?? ""} style={{ width: 150 }} /></label>
          <label className="stack" style={{ gap: 2 }}>Menge angemeldet<input className="input" name="menge_angemeldet" inputMode="numeric" defaultValue={zahl(a?.mengeAngemeldet)} style={{ width: 80 }} data-testid="de-ankauf-menge" /></label>
          <label className="stack" style={{ gap: 2 }}>Annahmefrist<input className="input" type="date" name="annahmefrist" defaultValue={a?.annahmefrist ?? ""} data-testid="de-ankauf-frist" /></label>
          <label className="stack" style={{ gap: 2 }}>Kauft noch an (bestätigt am)<input className="input" type="date" name="bestaetigt" defaultValue={a?.ankauftBestaetigtAm ?? ""} data-testid="de-ankauf-bestaetigt" /></label>
          <label className="stack" style={{ gap: 2 }}>Versandfrist<input className="input" type="date" name="versandfrist" defaultValue={a?.versandfrist ?? ""} data-testid="de-ankauf-versandfrist" /></label>
          <label className="stack" style={{ gap: 2 }}>Zahlungsziel (Tage)<input className="input" name="zahlungsziel" inputMode="numeric" defaultValue={zahl(a?.zahlungszielTage)} placeholder={String(ANKAUF_ZAHLUNGSZIEL_STANDARD)} style={{ width: 70 }} data-testid="de-ankauf-ziel" /></label>
          <label className="stack" style={{ gap: 2 }}>Rückvergütung %<input className="input" name="rueckverguetung" inputMode="decimal" defaultValue={a?.rueckverguetungProzent ? zahl(a.rueckverguetungProzent) : ""} placeholder="0" style={{ width: 60 }} data-testid="de-ankauf-rueck" /></label>
          <button className="btn btn-sm btn-primary" type="submit" data-testid="de-ankauf-speichern">Speichern</button>
        </form>
      )}
      {aktiv && r && (
        <>
          <div className="table-wrap">
            <table className="table small" data-testid="de-ausstieg" style={{ maxWidth: 560 }}>
              <thead><tr><th></th><th>Amazon{r.am.land ? ` (${r.am.land})` : ""}</th><th>Ankauf{a.ankaeufer ? ` (${a.ankaeufer})` : ""}</th></tr></thead>
              <tbody>
                <tr><td>Erlös je Stück</td><td>{eur(r.am.vkBrutto)} <span className="muted">brutto</span></td><td>{eur(a.preis)} <span className="muted">netto</span></td></tr>
                <Zeile name="Gewinn je Stück" k="gewinnStk" a={r.v.amazon} b={r.v.ankauf} fmt={eur} />
                <Zeile name={`Gewinn gesamt${r.menge ? ` (${r.menge} Stk)` : ""}`} k="gewinnGesamt" a={r.v.amazon} b={r.v.ankauf} fmt={eur} />
                <Zeile name="Marge" k="marge" a={r.v.amazon} b={r.v.ankauf} fmt={pz} />
                <Zeile name="ROI" k="roi" a={r.v.amazon} b={r.v.ankauf} fmt={pz} />
                <Zeile name="Geld nach" k="tage" a={r.v.amazon} b={r.v.ankauf} fmt={(n) => (n === null ? "–" : `${n} Tagen`)} />
                <Zeile name="ROI p. a." k="roiPa" a={r.v.amazon} b={r.v.ankauf} fmt={pz} />
              </tbody>
            </table>
          </div>
          <div className="small" data-testid="de-ausstieg-fazit" data-besser={r.v.besser ?? ""}><strong>{r.v.text}</strong></div>
          <div className="small muted">EK {eur(r.ek)} netto{p.gekauft.preis !== null ? " (gekauft)" : " (Prüfung)"}{a.rueckverguetungProzent ? ` · Rückvergütung ${pz(a.rueckverguetungProzent)} vom EK bei beiden Wegen` : ""} · Amazon: Gewinn bestes Land, Marge vom Buy-Box-Preis, Geld nach Umschlagszeit (geschätzt) · Ankauf: Gewinn = Ankaufspreis − EK + Rückvergütung, Geld nach Zahlungsziel{a.zahlungszielTage === null ? ` (angenommen ${ANKAUF_ZAHLUNGSZIEL_STANDARD} Tage)` : ""}.</div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="de-ankauf-check">
            {check.map((c) => <li key={c.punkt} data-ok={c.ok ? "1" : "0"}>{c.ok ? "✓" : "⚠"} {c.punkt}: {c.hinweis}</li>)}
          </ul>
          {p.gekauft.am && (
            <div className="stack small" style={{ gap: 6 }}>
              {a.ausgang && <div data-testid="de-ankauf-ausgang" data-ausgang={a.ausgang}>Ausgang: <strong>{ANKAUF_AUSGANG[a.ausgang]}</strong>{a.ausgangAm ? ` am ${a.ausgangAm.split("-").reverse().join(".")}` : ""}{a.ausgangNotiz ? ` – „${a.ausgangNotiz}“` : ""}</div>}
              {p.schreiben && (
                <form action={ankaufAusgangAction} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid="de-ankauf-ausgang-form">
                  <input type="hidden" name="id" value={p.id} />
                  <select name="ausgang" defaultValue={a.ausgang ?? ""} aria-label="Ausgang" data-testid="de-ankauf-ausgang-wahl"><option value="">Ausgang –</option>{Object.entries(ANKAUF_AUSGANG).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
                  <input className="input" name="notiz" defaultValue={a.ausgangNotiz ?? ""} placeholder="Notiz (optional)" style={{ width: 220 }} />
                  <button className="btn btn-sm" type="submit" data-testid="de-ankauf-ausgang-knopf">Ausgang speichern</button>
                  <span className="muted">„liegt“ und „Verlust“ kommen als Frage in die Lernschleife.</span>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** B34.5 Warnung im Kaufen-Abschnitt (kein Stopp): offene Punkte der Checkliste vor „Gekauft“. */
export function AnkaufKaufWarnung(p: Pick<Props, "zeilen" | "ankauf" | "amazon" | "gekauft" | "heute">) {
  if (!ankaufAktiv(p.ankauf) || p.gekauft.am) return null;
  const r = ausstiegFuer(p);
  const offen = ankaufCheckliste(p.ankauf, r?.menge ?? null, p.heute).filter((c) => !c.ok);
  if (!offen.length) return <div className="small" data-testid="de-ankauf-warnung" data-offen="0">Ankauf-Deal: Checkliste vollständig – nach „Gekauft“ entsteht die Aufgabe „Ankauf bestätigen“.</div>;
  return (
    <div className="notice notice-warn small" data-testid="de-ankauf-warnung" data-offen={offen.length}>
      <strong>Ankauf-Deal – vor dem Kauf prüfen</strong> (Warnung, kein Stopp):
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{offen.map((c) => <li key={c.punkt}>{c.punkt}: {c.hinweis}</li>)}</ul>
      <a href="#ankauf">Zum Ankauf →</a>
    </div>
  );
}
