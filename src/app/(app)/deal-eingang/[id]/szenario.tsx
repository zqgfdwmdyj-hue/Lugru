"use client";

import { useState } from "react";
import { szenarioRechnen, verkaeufeBeiPreis, verkaeufeHinweis, type PreisTag } from "@/lib/deal-eingang/szenario-logic";

export type SzenarioLand = {
  land: string;
  /** Vorbelegung: aktuelle Buy Box brutto in EUR. */
  vk: number | null;
  mwstSatz: number;
  provision: number;
  fba: number;
  prep: number;
  /** Keepa-Tagesverlauf (nur EUR-Länder), „x+ gekauft“-Verlauf und aktuelle Verkäufe. */
  tage: PreisTag[];
  verkauftVerlauf: [string, number][];
  aktuellVerkaeufe: number | null;
};

const eur = (n: number | null) => (n === null ? "–" : `${n.toFixed(2).replace(".", ",")} €`);
const pz = (n: number | null) => (n === null ? "–" : `${String(n).replace(".", ",")} %`);
const lies = (s: string) => {
  const n = Number(s.replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** B28.2: „Was wäre bei VK x?“ – Ziel-VK je Land ändern, Gewinn/Marge/ROI und Verkäufe bei diesem Preisniveau sofort. */
export function PreisSzenario({ nr, ekNetto, laender }: { nr: number; ekNetto: number | null; laender: SzenarioLand[] }) {
  const [vk, setVk] = useState<Record<string, string>>(() => Object.fromEntries(laender.map((l) => [l.land, l.vk !== null ? l.vk.toFixed(2).replace(".", ",") : ""])));
  if (!laender.length) return null;
  return (
    <details className="small" data-testid="de-szenario" data-nr={nr}>
      <summary>Preis-Szenario: Was wäre bei VK x?</summary>
      <div className="muted" style={{ margin: "4px 0" }}>Ziel-VK je Land (brutto) ändern – Gewinn, Marge und ROI rechnen sofort neu; dazu, wie oft sich der Artikel in den letzten 12 Monaten bei diesem Preis verkauft hat.</div>
      <div className="table-wrap">
        <table className="table small">
          <thead><tr><th>Land</th><th>Ziel-VK</th><th>Gewinn</th><th>Marge</th><th>ROI</th><th>Verkäufe bei diesem Preis</th></tr></thead>
          <tbody>
            {laender.map((l) => {
              const preis = lies(vk[l.land] ?? "");
              const r = preis !== null && ekNetto !== null ? szenarioRechnen({ vkBrutto: preis, mwstSatz: l.mwstSatz, provision: l.provision, fba: l.fba, prep: l.prep, ekNetto }) : null;
              const v = preis !== null && l.tage.length ? verkaeufeBeiPreis(l.tage, preis, { verkauftVerlauf: l.verkauftVerlauf, aktuellVerkaeufe: l.aktuellVerkaeufe }) : null;
              return (
                <tr key={l.land} data-testid={`de-szenario-${l.land}`}>
                  <td>{l.land}</td>
                  <td>
                    <input aria-label={`Ziel-VK ${l.land}`} inputMode="decimal" value={vk[l.land] ?? ""} onChange={(e) => setVk((x) => ({ ...x, [l.land]: e.target.value }))} style={{ width: 80 }} data-testid={`de-szenario-vk-${l.land}`} />
                  </td>
                  <td data-testid={`de-szenario-gewinn-${l.land}`}>{r ? eur(r.gewinn) : ekNetto === null ? "EK fehlt" : "–"}</td>
                  <td data-testid={`de-szenario-marge-${l.land}`}>{r ? pz(r.marge) : "–"}</td>
                  <td data-testid={`de-szenario-roi-${l.land}`}>{r ? pz(r.roi) : "–"}</td>
                  <td data-testid={`de-szenario-verkaeufe-${l.land}`}>{preis === null ? "–" : l.tage.length ? verkaeufeHinweis(v) : "keine Keepa-Daten"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
