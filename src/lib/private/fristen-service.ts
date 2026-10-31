import "server-only";
import type { Session } from "@/lib/auth/session";
import { fixkostenVertraege, fristenBis, naechsteFrist, type FristEintrag, type Vertrag } from "./fristen";
import { loadEntries, privateSettings } from "./service";

// Vorsorge, Fristen & Verträge: gemeinsame Einträge im Privatbereich (beide Partner mit vollem Umfang).

export async function fristenLaden(session: Session, heute: string) {
  const [eintraege, settings] = await Promise.all([loadEntries<FristEintrag>(session, ["frist"]), privateSettings(session.tenantId)]);
  const mitFrist = eintraege.map((e) => ({ ...e, frist: naechsteFrist(e.data, heute) })).sort((a, b) => (a.frist?.datum ?? "9999").localeCompare(b.frist?.datum ?? "9999"));
  const vertraege = eintraege.filter((e) => e.data.typ === "vertrag").map((e) => e.data as Vertrag);
  return {
    eintraege: mitFrist,
    jetzt: mitFrist.filter((e) => e.frist?.erinnern),
    fixkosten: fixkostenVertraege(vertraege, heute),
    personen: [settings.partners.a, settings.partners.b],
  };
}

/** Für Claude: Fristen bis Datum, privat oder geschäftlich (Firmen-Kennzeichen). */
export async function fristenListe(session: Session, heute: string, bis: string, bereich: "privat" | "geschaeft" | "alle") {
  const eintraege = await loadEntries<FristEintrag>(session, ["frist"]);
  const liste = fristenBis(eintraege, heute, bis, bereich);
  const vertraege = eintraege.filter((e) => e.data.typ === "vertrag" && (bereich === "alle" || (bereich === "geschaeft") === !!e.data.firma)).map((e) => e.data as Vertrag);
  return { liste, fixkosten: fixkostenVertraege(vertraege, heute), anzahl: eintraege.length };
}
