import { requireArea } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { PrintButton } from "@/components/print-button";

// Gefahrgut-Kennzeichen zum Aufkleben (Label aus Chat): LQ-Raute (begrenzte Menge) und Lithium-Batterie-Kennzeichen.
// Aufruf: /etikett/gefahrgut?art=lq|lithium&un=UN3481&format=100|a4|62 – Standard 100 × 100 mm (Mindestgröße).
// Der QL-800 druckt höchstens 62 mm breit: dort nur die verkleinerte Raute 50 × 50 mm (nur zulässig, wenn das Packstück
// für 100 × 100 mm zu klein ist). Für 100 × 100 mm: A4 oder ein 100-mm-Labeldrucker.

const LQ = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="LQ-Kennzeichen"><polygon points="50,1.5 98.5,50 50,98.5 1.5,50" fill="#fff" stroke="#000" stroke-width="3"/><polygon points="50,3 77,30 23,30" fill="#000"/><polygon points="23,70 77,70 50,97" fill="#000"/></svg>`;

function lithiumSvg(un: string, tel: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Lithium-Batterie-Kennzeichen">
  <defs><pattern id="sch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="4" fill="#d00"/></pattern></defs>
  <rect x="0" y="0" width="100" height="100" fill="url(#sch)"/><rect x="5" y="5" width="90" height="90" fill="#fff"/>
  <g stroke="#000" stroke-width="1.6" fill="#fff"><rect x="18" y="16" width="26" height="14" rx="2"/><rect x="44" y="20" width="3" height="6"/><rect x="54" y="16" width="26" height="14" rx="2"/><rect x="80" y="20" width="3" height="6"/></g>
  <path d="M67 13 l3 -5 l2 4 l3 -6 l1 8" stroke="#d00" stroke-width="1.6" fill="none"/>
  <text x="50" y="52" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="bold">${esc(un)}</text>
  <text x="50" y="72" text-anchor="middle" font-family="Arial, sans-serif" font-size="7">Tel.: ${esc(tel || "________________")}</text>
</svg>`;
}

export default async function GefahrgutEtikettPage({ searchParams }: { searchParams: Promise<{ art?: string; un?: string; format?: string; anzahl?: string }> }) {
  const s = await requireArea("service");
  const sp = await searchParams;
  const art = sp.art === "lithium" ? "lithium" : "lq";
  const format = sp.format === "a4" || sp.format === "62" ? sp.format : "100";
  const un = /^(UN)?\s?(3481|3091)$/i.test(sp.un ?? "") ? `UN${(sp.un ?? "").replace(/\D/g, "")}` : "UN3481";
  const tel = (await getSettings(s.tenantId)).shipper.phone ?? "";
  const anzahl = Math.max(1, Math.min(20, Number(sp.anzahl) || 1));
  const mm = format === "62" ? 50 : 100;
  const seite = format === "a4" ? "210mm 297mm" : format === "62" ? "62mm 62mm" : "100mm 100mm";
  const svg = art === "lq" ? LQ : lithiumSvg(un, tel);
  const titel = art === "lq" ? "LQ-Kennzeichen (begrenzte Menge)" : `Lithium-Batterie-Kennzeichen ${un}`;
  return (
    <>
      <style>{`
        @page { size: ${seite}; margin: 0; }
        body { margin: 0; background: #fff; }
        .gk { width: ${format === "a4" ? "210mm" : format === "62" ? "62mm" : "100mm"}; height: ${format === "a4" ? "297mm" : format === "62" ? "62mm" : "100mm"}; display: flex; align-items: ${format === "a4" ? "flex-start" : "center"}; justify-content: center; padding-top: ${format === "a4" ? "20mm" : "0"}; box-sizing: border-box; page-break-after: always; }
        .gk div { width: ${mm}mm; height: ${mm}mm; }
        .gk svg { width: 100%; height: 100%; display: block; }
        @media screen { .gk { border: 1px dashed #bbb; margin: 8px; } .bar { padding: 12px; font-family: sans-serif; font-size: 13px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; } }
        @media print { .bar { display: none; } }
      `}</style>
      <div className="bar" data-testid="gk-leiste">
        <PrintButton label={`${titel} drucken`} />
        <span>Format: <a href={`?art=${art}&un=${un}&format=100`}>100 × 100 mm</a> · <a href={`?art=${art}&un=${un}&format=a4`}>A4</a> · <a href={`?art=${art}&un=${un}&format=62`}>QL-800 (62 mm, 50 × 50 mm)</a> · Skalierung 100 %</span>
        {format === "62" && <span style={{ color: "#a15c00" }}>Achtung: 50 × 50 mm nur, wenn das Packstück für 100 × 100 mm zu klein ist.</span>}
        {art === "lithium" && !tel && <span style={{ color: "#a15c00" }}>Telefonnummer fehlt im Absender (Einstellungen → Versand).</span>}
      </div>
      {Array.from({ length: anzahl }, (_, i) => (
        <div className="gk" key={i} data-testid={`gk-${art}`}>
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      ))}
    </>
  );
}
