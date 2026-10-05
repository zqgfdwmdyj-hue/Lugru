import Link from "next/link";
import { headers } from "next/headers";
import { requireArea } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { sellerCentralRemovalUrl } from "@/lib/claims/sc-removal";
import { scBookmarkletHref } from "@/lib/claims/sc-bookmarklet";
import { ScBookmark, ScCapture } from "./capture";

export default async function ErfassenPage() {
  await requireArea("amazon");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || /^\d/.test(host) ? "http" : "https");
  const origin = `${proto}://${host}`;
  const today = todayIso();
  const scUrl = sellerCentralRemovalUrl(addDaysIso(today, -75), today);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/remissionen">Remissionen</Link></div><h1>Tendron-Pakete aus Seller Central holen</h1></div>
      </div>
      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>So geht’s – statt jeden Auftrag einzeln zu öffnen</h2>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>
            Einmalig: Lesezeichenleiste einblenden (<kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>B</kbd>) und diesen Knopf hineinziehen:{" "}
            <ScBookmark href={scBookmarkletHref(origin)} />
          </li>
          <li>
            <a className="btn btn-small btn-primary" href={scUrl} target="_blank" rel="noreferrer">Seller Central: abgeschlossene Remissionen (letzte 75 Tage)</a>{" "}
            öffnen und „Bericht erstellen“ klicken.
          </li>
          <li>In der Liste das Lesezeichen <strong>„→ Seller-System Remissionen“</strong> klicken. Es öffnet jeden Auftrag im Hintergrund, wählt „Alle versendeten Einheiten anzeigen“, klappt die Sendungsverfolgung auf und liest Pakete, Sendungsnummern (z. B. <em>(TENDRON_VRETURN)</em>), FNSKUs und Stückzahl. Den Tab so lange offen lassen.</li>
          <li>Am Ende „Kopieren und ans Seller-System senden“ – die Daten erscheinen hier automatisch. Sonst hier mit <kbd>Strg</kbd>+<kbd>V</kbd> einfügen.</li>
        </ol>
        <div className="small muted">
          Mehrere Seiten in der Liste? Lesezeichen auf jeder Seite einmal klicken. Klappt das automatische Öffnen nicht: einen Auftrag öffnen, „Alle versendeten Einheiten anzeigen“ wählen, Lesezeichen klicken – oder die Seite markieren (Strg+A), kopieren und hier einfügen.
          Das Lesezeichen klickt nur Anzeige-Schalter und ändert in Seller Central nichts.
        </div>
      </section>
      <ScCapture />
    </>
  );
}
