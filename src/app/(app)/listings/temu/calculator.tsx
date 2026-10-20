"use client";

import { useState } from "react";
import { parseAmount } from "@/lib/numbers";
import { TEMU_SHIPPING_DEDUCTION, TEMU_SHIPPING_THRESHOLD, temuBasePrice, temuPriceNote, temuVat, temuWithShipping, type TemuPriceRule } from "@/lib/temu/price";

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const plain = (n: number) => String(Math.round(n * 10000) / 100).replace(".", ",");

/** Temu-Basispreis-Rechner wie die Excel-Vorlage: Referenzpreis eingeben, Basispreis ablesen. */
export function TemuCalculator({ rule }: { rule: TemuPriceRule }) {
  const [ref, setRef] = useState("");
  const [factor, setFactor] = useState(plain(rule.factor));
  const [food, setFood] = useState(rule.food);
  const r = parseAmount(ref) ?? 0;
  const live: TemuPriceRule = { factor: (parseAmount(factor) ?? 0) / 100, food };
  const price = temuBasePrice(r, live);
  const gross = r * live.factor;
  return (
    <section className="card card-pad stack" style={{ gap: 10 }} data-testid="temu-calc">
      <h2 style={{ margin: 0 }}>Temu-Rechner</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="stack" style={{ gap: 4 }}>
          <span className="label">Referenzpreis (€, brutto – z. B. eBay)</span>
          <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} inputMode="decimal" placeholder="z. B. 24,90" aria-label="Referenzpreis" style={{ width: 140 }} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="label">Faktor (%)</span>
          <input className="input" value={factor} onChange={(e) => setFactor(e.target.value)} inputMode="decimal" aria-label="Rechner Faktor in Prozent" style={{ width: 80 }} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="label">Warengruppe</span>
          <select className="select" value={food ? "food" : "nonfood"} onChange={(e) => setFood(e.target.value === "food")} aria-label="Rechner Warengruppe">
            <option value="nonfood">Non-Food (19 % MwSt.)</option>
            <option value="food">Food (7 % MwSt.)</option>
          </select>
        </label>
        <div className="stack" style={{ gap: 2 }}>
          <span className="label">Empfohlener Temu-Basispreis</span>
          <strong style={{ fontSize: 22 }} data-testid="temu-calc-result">{r > 0 ? (price > 0 ? euro(price) : "zu niedrig") : "–"}</strong>
        </div>
      </div>
      {r > 0 && (
        <div className="small muted" data-testid="temu-calc-note">
          {temuPriceNote(r, live)}: {euro(r)} × {plain(live.factor)} % = {euro(gross)}
          {temuWithShipping(r, live) ? ` − ${euro(TEMU_SHIPPING_DEDUCTION)}` : ""} ÷ {plain(1 + temuVat(food))} %
          {price <= 0 ? " – bei so niedrigem Preis bleibt nach dem Versandabzug nichts übrig." : ""}
        </div>
      )}
      <div className="small muted">
        Wie der Basispreis-Kalkulator: Referenzpreis × Faktor; liegt das bei {euro(TEMU_SHIPPING_THRESHOLD)} oder darunter, gehen {euro(TEMU_SHIPPING_DEDUCTION)} Versand ab; dann ohne MwSt. Dieselbe Rechnung schlägt unten je Angebot den Temu-Preis vor.
      </div>
    </section>
  );
}
