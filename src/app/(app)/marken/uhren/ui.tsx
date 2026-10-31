import { DEAL_STATUS_LABEL, type DealStatus } from "@/lib/watches/logic";

export const eur = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`);
export const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");

export function FlipHead({ title, brand, sub }: { title: string; brand: string; sub?: string }) {
  return (
    <div className="page-head">
      <div>
        <div className="crumb">Marken & Content · {brand}</div>
        <h1>{title}</h1>
        {sub && <div className="small muted">{sub}</div>}
      </div>
    </div>
  );
}

const STATUS_TAG: Record<DealStatus, string> = { beobachtet: "tag-info", verhandlung: "tag-info", gekauft: "tag-warn", inserat: "tag-warn", verkauft: "tag-ok", verworfen: "" };

export function StatusTag({ status, practice }: { status: DealStatus; practice?: boolean }) {
  return (
    <>
      <span className={`tag ${STATUS_TAG[status]}`}>{DEAL_STATUS_LABEL[status]}</span>
      {practice && <span className="tag" style={{ marginLeft: 4 }}>Übung</span>}
    </>
  );
}
