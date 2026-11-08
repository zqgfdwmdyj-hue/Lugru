import { druckerSymbol } from "@/lib/druck/logic";
import { agentenKurz } from "@/lib/druck/service";
import type { DruckerModell } from "@/lib/druck/brother";

// Kleines Symbol neben jedem Druckknopf: grün = bereit, gelb = Papier leer/aus, rot = Arbeits-PC nicht erreichbar.

const FARBE = { gruen: "var(--success, #1a7f37)", gelb: "var(--warn, #b7791f)", rot: "var(--danger, #c0392b)", grau: "#9a9a9a" } as const;

export async function DruckerSymbol({ tenantId, modell, kurz = false }: { tenantId: string; modell: DruckerModell; kurz?: boolean }) {
  const s = druckerSymbol(await agentenKurz(tenantId), modell);
  return (
    <span className="small" data-testid="drucker-symbol" data-farbe={s.farbe} data-modell={modell} title={s.text} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: FARBE[s.farbe], display: "inline-block", flex: "none" }} />
      <span className={s.farbe === "gruen" ? "muted" : ""} style={{ color: s.farbe === "rot" ? FARBE.rot : undefined }}>{kurz ? modell : s.text}</span>
    </span>
  );
}
