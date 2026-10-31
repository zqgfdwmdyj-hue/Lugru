"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { kundeAusPrognose, preisWarnungen, unserVerdienst } from "@/lib/b2b/logic";
import { SubmitButton } from "@/components/submit-button";

export type RechnerLand = {
  land: string;
  vk: number | null;
  vkEur: number | null;
  vk90: number | null;
  tief12: number | null;
  waehrung: string;
  mwstSatz: number;
  gebuehren: number | null;
  geschaetzt: boolean;
  verkaeufe: number | null;
  angebote: number | null;
  amazonProzent: number | null;
  aktionsmuster: string | null;
  fehler: string | null;
};

const eur = (n: number | null | undefined, w = "EUR") => (n === null || n === undefined ? "–" : `${n.toFixed(2).replace(".", ",")} ${w === "EUR" ? "€" : w === "GBP" ? "£" : w}`);
const zahl = (s: string) => {
  const v = Number(s.replace(/\s/g, "").replace(",", "."));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

/** Live-Rechenhilfe: Kundenpreis eintippen → unser Verdienst und Gewinn/ROI des Kunden je Land, mit Ampel und Warnungen. */
export function Rechner({ id, ek, versandAnteil, prepGebuehr, minRoiProzent, preis, menge, laender, reservierungen, aktion }: { id: string; ek: number; versandAnteil: number | null; prepGebuehr: number | null; minRoiProzent: number; preis: number | null; menge: number | null; laender: RechnerLand[]; reservierungen: number; aktion: (fd: FormData) => Promise<void> }) {
  const [eingabe, setEingabe] = useState(preis === null ? "" : String(preis).replace(".", ","));
  const kp = zahl(eingabe);
  const zeilen = useMemo(() => laender.map((l) => ({ ...l, ...kundeAusPrognose({ vkEur: l.vkEur, mwstSatz: l.mwstSatz, gebuehren: l.gebuehren }, kp, prepGebuehr) })), [laender, kp, prepGebuehr]);
  const verdienst = kp === null ? null : unserVerdienst({ ek, kundenpreis: kp, versandAnteil, menge });
  const besterRoi = zeilen.reduce<number | null>((m, z) => (z.roi !== null && (m === null || z.roi > m) ? z.roi : m), null);
  const warnungen = preisWarnungen({ verdienst, besterRoi, minRoiProzent, kundenpreis: kp });
  const ampel = (roi: number | null) => (roi === null ? "var(--muted)" : roi >= minRoiProzent ? "var(--ok)" : roi >= 0 ? "var(--warn)" : "var(--danger)");
  return (
    <form action={aktion} className="stack" style={{ gap: 10 }} data-testid="rechner">
      <input type="hidden" name="id" value={id} />
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field">
          <label className="label" htmlFor="kp">Kundenpreis netto je Stück</label>
          <input className="input" id="kp" name="kundenpreisNetto" inputMode="decimal" value={eingabe} onChange={(e) => setEingabe(e.target.value)} style={{ width: 110, fontSize: 18 }} data-testid="rechner-preis" />
        </div>
        <div className="small" data-testid="rechner-verdienst">
          EK {eur(ek)}{versandAnteil ? ` + Versand ${eur(versandAnteil)}` : ""}
          <div style={{ fontSize: 16, color: verdienst?.negativ ? "var(--danger)" : undefined }}>
            Unser Verdienst: <b>{eur(verdienst?.proStueck ?? null)}</b>/Stück{verdienst?.prozentAufEk !== null && verdienst?.prozentAufEk !== undefined ? ` (${verdienst.prozentAufEk.toFixed(0)} % auf EK)` : ""}
            {verdienst?.gesamt !== null && verdienst?.gesamt !== undefined && menge ? <> · bei {menge} Stück <b>{eur(verdienst.gesamt)}</b></> : null}
          </div>
        </div>
      </div>
      {warnungen.length > 0 && (
        <div className="notice notice-warn" data-testid="rechner-warnungen">
          {warnungen.map((w) => <div key={w.art}>{w.text}</div>)}
        </div>
      )}
      <div style={{ overflow: "auto" }}>
        <table className="table" data-testid="rechner-laender">
          <thead>
            <tr><th>Land</th><th className="right">Buy Box</th><th className="right">Ø 90 T. / Tief 12 M.</th><th className="right">Verk./Monat</th><th className="right">Angebote</th><th className="right">Amazon</th><th className="right">Gebühren</th><th className="right">Gewinn Kunde</th><th className="right">ROI / Marge</th></tr>
          </thead>
          <tbody>
            {zeilen.length === 0 && <tr><td colSpan={9} className="muted">Noch keine Prognose.</td></tr>}
            {zeilen.map((z) => (
              <tr key={z.land} data-land={z.land}>
                <td><b>{z.land}</b>{z.aktionsmuster ? <span className="tag tag-warn" title={z.aktionsmuster} style={{ marginLeft: 4 }}>Aktionen</span> : null}</td>
                <td className="num right">{eur(z.vk, z.waehrung)}{z.waehrung !== "EUR" && z.vkEur !== null ? <div className="small muted">{eur(z.vkEur)}</div> : null}</td>
                <td className="num right small">{eur(z.vk90, z.waehrung)} / {eur(z.tief12, z.waehrung)}</td>
                <td className="num right">{z.verkaeufe ?? "–"}</td>
                <td className="num right">{z.angebote ?? "–"}</td>
                <td className="num right">{z.amazonProzent === null ? "–" : `${Math.round(z.amazonProzent)} %`}</td>
                <td className="num right">{eur(z.gebuehren)}{z.geschaetzt && z.gebuehren !== null ? <span className="small muted"> ~</span> : null}</td>
                <td className="num right" style={{ color: ampel(z.roi), fontWeight: 600 }}>{eur(z.gewinn)}</td>
                <td className="num right" style={{ color: ampel(z.roi) }}>{z.roi === null ? "–" : `${z.roi.toFixed(0)} %`}{z.marge !== null ? <span className="small muted"> / {z.marge.toFixed(0)} %</span> : null}{z.fehler ? <div className="small muted">{z.fehler}</div> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="small muted">Kunde: Buy Box brutto → netto (USt des Landes), minus Provision und FBA, minus Kundenpreis{prepGebuehr ? ` und Prep-Gebühr ${eur(prepGebuehr)}` : ""}. Fremdwährung zum EZB-Kurs. „~“ = Gebühren geschätzt. Prognose ohne Garantie.</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {reservierungen > 0 && <label className="check small"><input type="checkbox" name="trotz" /> Es gibt {reservierungen} Reservierung(en) – neuer Preis nur für neue Reservierungen</label>}
        <SubmitButton label="Kundenpreis speichern" pendingLabel="Speichere …" testId="preis-speichern" />
      </div>
    </form>
  );
}

/** Lädt die Seite neu, solange die Prognose im Hintergrund läuft (höchstens 1 Minute). */
export function WartenAufPrognose() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      if (++n > 12) clearInterval(t);
      router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [router]);
  return <div className="notice notice-info" data-testid="prognose-laeuft">Prognose je Land wird berechnet (Keepa/Amazon) – die Seite aktualisiert sich gleich.</div>;
}
