import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { faelleListe, rechtsfristen } from "@/lib/recht/service";
import { getSettings } from "@/lib/settings";
import { FallListe } from "./ansicht";
import { asanaJetztAction, fallAnlegenAction, rechtEinstellungenAction } from "./actions";

// Rechtsfälle beim Anwalt (B14) – geschäftlich, nur Inhaber. Private Fälle stehen im Privatbereich.

export default async function RechtsfaellePage({ searchParams }: { searchParams: Promise<{ meldung?: string; alle?: string }> }) {
  const session = await requireOwner();
  const sp = await searchParams;
  const heute = todayIso();
  const t = session.tenantId;
  const [faelle, fristen, settings, [asana]] = await Promise.all([
    faelleListe(t, "geschaeft", { mitAbgeschlossenen: sp.alle === "1" }),
    rechtsfristen(t, heute, 14),
    getSettings(t),
    db.select({ id: schema.integrations.id }).from(schema.integrations).where(and(eq(schema.integrations.tenantId, t), eq(schema.integrations.provider, "asana"))).limit(1),
  ]);
  const cfg = settings.rechtsfaelle;
  const g = fristen.filter((f) => f.bereich === "geschaeft");
  const p = fristen.length - g.length;
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Heute</div><h1>Rechtsfälle (Anwalt)</h1></div>
        <form action={asanaJetztAction}><button className="btn" type="submit">Asana jetzt abgleichen</button></form>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="recht-meldung">{sp.meldung}</div>}
      {!asana && <div className="notice notice-info small" style={{ marginBottom: 12 }}>Asana ist noch nicht verbunden: <Link href="/anbindungen">Anbindungen → Asana (Anwalt)</Link> – persönlicher Zugangstoken, nur lesen.</div>}
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card card-pad">
            <h2 style={{ marginTop: 0 }}>Fristen in 14 Tagen</h2>
            {g.length === 0 && !p && <p className="muted small" style={{ margin: 0 }}>Keine.</p>}
            <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="recht-fristen">
              {g.map((f) => <li key={`${f.fallId}${f.tag}`}><Link href={`/rechtsfaelle/${f.fallId}`}>{f.tag.slice(8, 10)}.{f.tag.slice(5, 7)}. – {f.titel}</Link></li>)}
              {p > 0 && <li className="muted">{p} private Rechtsfrist{p === 1 ? "" : "en"} (siehe Privatbereich)</li>}
            </ul>
          </section>
          <section className="card card-pad">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0 }}>Fälle (geschäftlich)</h2>
              <Link className="small" href={sp.alle === "1" ? "/rechtsfaelle" : "/rechtsfaelle?alle=1"}>{sp.alle === "1" ? "nur offene" : "auch abgeschlossene"}</Link>
            </div>
            <FallListe faelle={faelle} basis="/rechtsfaelle" heute={heute} />
          </section>
          <section className="card card-pad">
            <h2 style={{ marginTop: 0 }}>Fall von Hand anlegen</h2>
            <form action={fallAnlegenAction} className="stack" style={{ gap: 8 }} data-testid="recht-neu">
              <input type="hidden" name="bereich" value="geschaeft" />
              <div className="grid-2" style={{ gap: 8 }}>
                <div className="field"><label className="label" htmlFor="rn-titel">Titel</label><input className="input" id="rn-titel" name="titel" required maxLength={300} /></div>
                <div className="field"><label className="label" htmlFor="rn-az">Aktenzeichen</label><input className="input" id="rn-az" name="aktenzeichen" maxLength={60} /></div>
                <div className="field"><label className="label" htmlFor="rn-firma">Firma</label><input className="input" id="rn-firma" name="firma" maxLength={40} placeholder="LuGru, WiGru, W&G" /></div>
                <div className="field"><label className="label" htmlFor="rn-geg">Gegner / Gegenstand</label><input className="input" id="rn-geg" name="gegenstand" maxLength={2000} /></div>
              </div>
              <div><button className="btn" type="submit">Anlegen</button></div>
            </form>
          </section>
        </div>
        <aside className="stack" style={{ width: 340, maxWidth: "100%" }}>
          <section className="card card-pad">
            <h2 style={{ marginTop: 0 }}>Einstellungen</h2>
            <form action={rechtEinstellungenAction} className="stack" style={{ gap: 8 }} data-testid="recht-einstellungen">
              <div className="field"><label className="label" htmlFor="re-dom">Absender-Domains des Anwalts</label><input className="input" id="re-dom" name="anwaltDomains" defaultValue={cfg.anwaltDomains.join(", ")} placeholder="kanzlei-beispiel.de" /></div>
              <div className="field"><label className="label" htmlFor="re-adr">Mail-Adresse für Entwürfe</label><input className="input" id="re-adr" name="anwaltAdresse" type="email" defaultValue={cfg.anwaltAdresse} /></div>
              <div className="field"><label className="label" htmlFor="re-priv">Private Asana-Projekte (Name oder ID, je Zeile)</label><textarea className="input" id="re-priv" name="privatProjekte" rows={2} defaultValue={cfg.privatProjekte.join("\n")} /></div>
              <div className="grid-2" style={{ gap: 8 }}>
                <div className="field"><label className="label" htmlFor="re-vor">Aufgabe vor Frist (Tage)</label><input className="input" id="re-vor" name="vorlaufTage" type="number" min={0} max={30} defaultValue={cfg.vorlaufTage} /></div>
                <div className="field"><label className="label" htmlFor="re-still">„Nichts passiert“ nach Tagen</label><input className="input" id="re-still" name="stillstandTage" type="number" min={0} max={365} defaultValue={cfg.stillstandTage} /></div>
              </div>
              <div><button className="btn" type="submit">Speichern</button></div>
            </form>
            <p className="small muted" style={{ marginBottom: 0 }}>Mails von diesen Domains bzw. mit bekanntem Aktenzeichen landen im Fall statt im Posteingang. Unbekannte Anwalts-Mails kommen als „bitte zuordnen“ in den Privatbereich. Asana wird nur gelesen.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
