import { druckenAction } from "@/app/(app)/drucken/actions";
import type { Session } from "@/lib/auth/session";
import { darfDrucken, VORLAGEN, type VorlageId } from "@/lib/druck/logic";
import { DruckerSymbol } from "./drucker-symbol";

// Druckknopf für eine Vorlage mit Anzahl und Druckersymbol – an jeder Stelle, an der etwas gedruckt wird.

export function DruckKnopf({ session, vorlage, eingabe, zurueck, anzahl = 1, text, testid = "druck-knopf" }: { session: Session; vorlage: VorlageId; eingabe: Record<string, string>; zurueck: string; anzahl?: number; text?: string; testid?: string }) {
  if (!darfDrucken(session, vorlage)) return null;
  const v = VORLAGEN[vorlage];
  return (
    <form action={druckenAction} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid={testid}>
      <input type="hidden" name="vorlage" value={vorlage} />
      <input type="hidden" name="zurueck" value={zurueck} />
      {Object.entries(eingabe).map(([k, wert]) => <input key={k} type="hidden" name={`e_${k}`} value={wert} />)}
      <input className="input" name="anzahl" type="number" min={1} max={500} defaultValue={anzahl} style={{ width: 70 }} aria-label="Anzahl" data-testid={`${testid}-anzahl`} />
      <button className="btn btn-sm btn-primary" type="submit" data-testid={`${testid}-los`}>{text ?? `🖨 An ${v.drucker}`}</button>
      <DruckerSymbol tenantId={session.tenantId} modell={v.drucker} />
    </form>
  );
}
