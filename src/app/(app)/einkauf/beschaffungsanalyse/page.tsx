import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { Cleaner } from "./cleaner";

export default async function BeschaffungsanalysePage() {
  await requireArea("wawi");
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/einkauf">Einkauf</Link></div><h1>Dropship-Trackings (Beschaffungsanalyse)</h1></div>
        <Link className="btn" href="/rechnungen/ausgang/rechnungshelfer">Rechnungshelfer</Link>
      </div>
      <div className="small muted" style={{ maxWidth: 760 }}>
        Amazon Business → Beschaffungsanalyse → Bericht „Sendungen“ (DE/FR/ES/IT) als CSV herunterladen und hier hineinziehen. Übrig bleiben nur Bestellungen an die Ankauf-Adresse – deine anderen Lieferungen (eigene Adresse, Kunden) fliegen raus. Die bereinigte Datei ziehst du in Discord in <span className="num">#beschaffungsanalyse-csv</span>; der Bot ordnet die Sendungsnummern deinen Tickets zu.
      </div>
      <Cleaner />
      <section className="card card-pad stack small" style={{ gap: 6 }}>
        <h2>Bericht in Amazon Business einrichten (einmalig je Land)</h2>
        <div>Pflichtspalten: Bestellnummer · Sendungsverfolgung · Lieferdatum · Liefermenge · Versandadresse · ASIN · Titel (auf „Übernehmen“ klicken). „Stornierte Artikel ausblenden“ abwählen, Zeitraum z. B. letzte 12 Monate, als eigenen Bericht speichern (z. B. DEBHVCSV) und als Lesezeichen ablegen.</div>
        <div className="muted">Die Datei bleibt auf deinem Gerät – das Bereinigen läuft im Browser, nichts wird hochgeladen oder gespeichert.</div>
      </section>
    </>
  );
}
