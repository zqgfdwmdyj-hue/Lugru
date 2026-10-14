"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { parseAmount } from "@/lib/numbers";
import type { TemuPackage } from "@/lib/temu/goods";
import { temuBasePrice, type TemuPriceRule } from "@/lib/temu/price";
import type { Candidate } from "@/lib/temu/transfer";
import { queueTransfersAction, type TransferState } from "./actions";

type Pack = Partial<TemuPackage>;
const PACK_FIELDS: [keyof TemuPackage, string][] = [["weightG", "g"], ["lengthCm", "L"], ["widthCm", "B"], ["heightCm", "H"]];
const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const plain = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));
type Filter = "alle" | "offen" | "temu" | "ohne-wawi";

/**
 * Alle eBay-Angebote (eBay-Tool und ältere) mit Auswahl: Temu-Preis nach dem Basispreis-Rechner (je
 * Zeile änderbar), Paket je Zeile oder als Standard, dann „auf Temu“ oder „nur in die Wawi“.
 */
export function TransferTable({ candidates, rule, pack, temuConnected, running }: { candidates: Candidate[]; rule: TemuPriceRule; pack: Pack; temuConnected: boolean; running: boolean }) {
  const router = useRouter();
  const [factor, setFactor] = useState(plain(Math.round(rule.factor * 10000) / 100));
  const [food, setFood] = useState(rule.food);
  const [std, setStd] = useState<Record<string, string>>(Object.fromEntries(PACK_FIELDS.map(([k]) => [k, plain(pack[k])])));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [packs, setPacks] = useState<Record<string, Record<string, string>>>({});
  const [filter, setFilter] = useState<Filter>("alle");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<TransferState>(null);

  // Solange die Warteschlange läuft, die Liste alle paar Sekunden neu laden.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [running, router]);

  const liveRule = { factor: (parseAmount(factor) ?? 0) / 100, food };
  const busyJob = (c: Candidate) => c.job?.status === "wartet" || c.job?.status === "läuft";
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return candidates.filter((c) => {
      if (filter === "offen" && c.temu) return false;
      if (filter === "temu" && !c.temu) return false;
      if (filter === "ohne-wawi" && c.wawi) return false;
      return !needle || c.title.toLowerCase().includes(needle) || (c.sku ?? "").toLowerCase().includes(needle) || c.ref.includes(needle);
    });
  }, [candidates, filter, q]);
  const count = (f: Filter) => candidates.filter((c) => (f === "offen" ? !c.temu : f === "temu" ? Boolean(c.temu) : f === "ohne-wawi" ? !c.wawi : true)).length;

  function toggle(key: string, on: boolean) {
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  }

  async function submit(target: "temu" | "wawi") {
    setState(null);
    const chosen = candidates.filter((c) => picked.has(c.key) && !busyJob(c));
    const todo = chosen.filter((c) => (target === "temu" ? !c.temu : !c.wawi));
    const skipped = chosen.length - todo.length;
    if (!todo.length) {
      setState({ ok: false, message: skipped ? `Die Auswahl ist schon ${target === "temu" ? "bei Temu" : "in der Wawi"}.` : "Bitte Angebote auswählen." });
      return;
    }
    const num = (v: string | undefined) => (v ? parseAmount(v) ?? undefined : undefined);
    const stdPack = Object.fromEntries(PACK_FIELDS.map(([k]) => [k, num(std[k])]).filter(([, v]) => v !== undefined)) as Pack;
    setBusy(true);
    try {
      const r = await queueTransfersAction({
        target,
        factorPercent: parseAmount(factor) ?? 0,
        food,
        pack: stdPack,
        picks: todo.map((c) => {
          const own = Object.fromEntries(PACK_FIELDS.map(([k]) => [k, num(packs[c.key]?.[k]) ?? c.pack[k]]).filter(([, v]) => v !== undefined)) as Pack;
          return { source: c.source, ref: c.ref, title: c.title, ...(num(prices[c.key]) ? { price: num(prices[c.key]) } : {}), pack: own };
        }),
      });
      setState(r && skipped ? { ...r, message: `${r.message} ${skipped} schon erledigt – übersprungen.` } : r);
      if (r?.ok) setPicked(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const allShown = shown.length > 0 && shown.every((c) => picked.has(c.key) || busyJob(c));

  return (
    <div className="stack" data-testid="transfer">
      <section className="card card-pad stack" style={{ gap: 10 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="stack" style={{ gap: 4 }}>
            <span className="label">Faktor (%)</span>
            <input className="input" value={factor} onChange={(e) => setFactor(e.target.value)} inputMode="decimal" aria-label="Faktor in Prozent" style={{ width: 80 }} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="label">Warengruppe</span>
            <select className="select" value={food ? "food" : "nonfood"} onChange={(e) => setFood(e.target.value === "food")} aria-label="Warengruppe">
              <option value="nonfood">Non-Food (19 % MwSt.)</option>
              <option value="food">Food (7 % MwSt.)</option>
            </select>
          </label>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Standardpaket (wenn in der Zeile nichts steht)</span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {PACK_FIELDS.map(([k, label]) => (
                <input key={k} className="input" value={std[k] ?? ""} onChange={(e) => setStd((s) => ({ ...s, [k]: e.target.value }))} placeholder={label === "g" ? "Gramm" : `${label} cm`} aria-label={`Standardpaket ${label === "g" ? "Gewicht in Gramm" : `${label} in cm`}`} inputMode="decimal" style={{ width: 76 }} />
              ))}
            </div>
          </div>
        </div>
        <div className="small muted">
          Temu-Basispreis = (eBay-Preis × Faktor − 2,99 € Versand, wenn das 30 € oder weniger sind) ÷ (1 + MwSt.) – wie im Basispreis-Kalkulator. Bei
          Varianten gilt der Rechner je Variante. Kategorie und Pflichtmerkmale ordnet Temu selbst zu; nur Neuware.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-primary" type="button" disabled={busy || !temuConnected || !picked.size} onClick={() => void submit("temu")} data-testid="to-temu">
            Ausgewählte auf Temu einstellen ({picked.size})
          </button>
          <button className="btn" type="button" disabled={busy || !picked.size} onClick={() => void submit("wawi")} data-testid="to-wawi" title="eBay-Angebot in die Wawi: Bestand aus der eBay-Menge, ab jetzt mit allen Kanälen abgeglichen">
            Nur in die Wawi übernehmen ({picked.size})
          </button>
          {busy && <span className="small muted">Reihe ein …</span>}
        </div>
        {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`} data-testid="transfer-msg">{state.message}</div>}
      </section>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {([["alle", "Alle"], ["offen", "Noch nicht bei Temu"], ["temu", "Bei Temu"], ["ohne-wawi", "Nicht in der Wawi"]] as [Filter, string][]).map(([f, label]) => (
          <button key={f} type="button" className={`chip${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>{label} ({count(f)})</button>
        ))}
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Titel, SKU, Artikelnummer" aria-label="Angebote durchsuchen" style={{ maxWidth: 260 }} />
      </div>

      <section className="card" style={{ minWidth: 0, overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Alle sichtbaren auswählen" checked={allShown} onChange={(e) => setPicked((s) => { const n = new Set(s); for (const c of shown) if (!busyJob(c)) { if (e.target.checked) n.add(c.key); else n.delete(c.key); } return n; })} /></th>
              <th>Angebot</th>
              <th className="right">eBay</th>
              <th className="right">Menge</th>
              <th>Temu-Preis</th>
              <th>Paket (g · L × B × H cm)</th>
              <th>Stand</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="muted">Keine Angebote.</td></tr>}
            {shown.map((c) => {
              const calc = temuBasePrice(c.price, liveRule);
              return (
                <tr key={c.key} data-testid="transfer-row" data-key={c.key}>
                  <td><input type="checkbox" aria-label={`Auswählen: ${c.title}`} checked={picked.has(c.key)} disabled={busyJob(c)} onChange={(e) => toggle(c.key, e.target.checked)} /></td>
                  <td style={{ minWidth: 220, maxWidth: 360 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {c.image ? <img src={c.image} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 6, flex: "none" }} /> : <span style={{ width: 40, height: 40, background: "var(--row)", borderRadius: 6, flex: "none" }} />}
                      <div>
                        <div>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}</div>
                        <div className="small muted">
                          {c.source === "attempt" ? "eBay-Tool" : "eBay (älter)"} · {c.sku ? `SKU ${c.sku}` : `Nr. ${c.ref}`}
                          {c.variations ? ` · ${c.variations} Varianten` : ""}
                          {c.condition && c.condition !== "NEW" ? " · gebraucht" : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="num right">{c.variations ? "ab " : ""}{euro(c.price)}</td>
                  <td className="num right">{c.quantity}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {c.variations ? (
                      <span className="small muted">je Variante, ab {calc > 0 ? euro(calc) : "–"}</span>
                    ) : (
                      <><input className="input num" value={prices[c.key] ?? ""} onChange={(e) => setPrices((p) => ({ ...p, [c.key]: e.target.value }))} placeholder={calc > 0 ? calc.toFixed(2).replace(".", ",") : "eigener Preis"} aria-label={`Temu-Preis ${c.title}`} inputMode="decimal" style={{ width: 84, padding: "4px 6px" }} /> €</>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {PACK_FIELDS.map(([k, label]) => (
                      <input key={k} className="input num" value={packs[c.key]?.[k] ?? ""} onChange={(e) => setPacks((p) => ({ ...p, [c.key]: { ...p[c.key], [k]: e.target.value } }))} placeholder={plain(c.pack[k]) || label} aria-label={`${label === "g" ? "Gewicht" : label} ${c.title}`} inputMode="decimal" style={{ width: 52, padding: "4px 5px", marginRight: 3 }} />
                    ))}
                  </td>
                  <td className="small" style={{ minWidth: 160 }}>
                    {c.job && busyJob(c) ? (
                      <span className="tag tag-info">{c.job.status === "läuft" ? "läuft …" : "wartet …"}</span>
                    ) : c.job?.status === "fehler" ? (
                      <div style={{ color: "var(--danger)" }} data-testid="transfer-error">Fehler: {c.job.message}</div>
                    ) : null}
                    {c.temu && (
                      <div>
                        <span className={`tag ${c.temu.status === "ACTIVE" ? "tag-ok" : "tag-warn"}`}>Temu: {c.temu.label}</span>
                        {c.temu.goodsId && <span className="muted"> · {c.temu.goodsId}</span>}
                      </div>
                    )}
                    {c.wawi ? <div className="muted">in der Wawi</div> : !c.temu && !c.job && <div className="muted">nicht in der Wawi</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
