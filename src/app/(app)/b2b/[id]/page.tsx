import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { formatDate, formatEuro } from "@/lib/numbers";
import { CopyButton } from "@/components/copy-button";
import { ConfirmButton } from "@/components/confirm-button";
import { Disclosure } from "@/components/disclosure";
import { SubmitButton } from "@/components/submit-button";
import { getSettings } from "@/lib/settings";
import { besterMarkt, DEAL_STATUS_TAG, DEAL_STATUS_TEXT, mengenVorschlag, RES_STATUS_TAG, RES_STATUS_TEXT, reservierungAktiv } from "@/lib/b2b/logic";
import { staffelText } from "@/lib/b2b/eingabe";
import { dealBlatt, dealReservierungen, freischaltHindernisse, portalLink, vertriebsfreigabe } from "@/lib/b2b/service";
import { discordNochmalAction, freischaltenAction, kundenpreisAction, maxGesamtAction, preisAction, prognoseAction, schliessenAction, verwerfenAction, dealSpeichernAction } from "../actions";
import { DealFelder } from "../deal-felder";
import { Rechner, WartenAufPrognose, type RechnerLand } from "./rechner";

const MELDUNGEN: Record<string, string> = {
  angelegt: "Deal als Entwurf angelegt.",
  gespeichert: "Gespeichert.",
  preis: "Kundenpreis gespeichert – Kundenrechnung je Land neu gerechnet.",
  kundenpreis: "Kundenpreise je Kunde gespeichert.",
  prognose: "Prognose aktualisiert.",
  geschlossen: "Deal geschlossen – keine neuen Reservierungen.",
  verworfen: "Entwurf verworfen.",
};

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("b2b");
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const t = session.tenantId;
  const [d] = await db.select().from(schema.deals).where(and(eq(schema.deals.tenantId, t), eq(schema.deals.id, id)));
  if (!d) notFound();
  const s = await getSettings(t);
  const S = schema.suppliers;
  const lieferanten = (await db.select({ id: S.id, code: S.code, name: S.name }).from(S).where(eq(S.tenantId, t)).orderBy(asc(S.code))).map((x) => ({ id: x.id, name: x.name ? `${x.name} (${x.code})` : x.code }));
  const lieferant = lieferanten.find((l) => l.id === d.supplierId) ?? null;
  const freigabe = await vertriebsfreigabe(t, d.supplierId);
  const hindernisse = d.status === "entwurf" ? await freischaltHindernisse(t, d) : [];
  const res = await dealReservierungen(t, id);
  const aktiv = res.filter((x) => reservierungAktiv(x.r.status));
  const reserviert = aktiv.reduce((n, x) => n + x.r.menge, 0);
  const bezahlt = aktiv.filter((x) => x.r.bezahltAm).reduce((n, x) => n + x.r.menge, 0);
  const K = schema.b2bKunden;
  const KP = schema.dealKundenpreise;
  const kunden = await db.select({ id: K.id, firma: K.firma }).from(K).where(and(eq(K.tenantId, t), eq(K.aktiv, true))).orderBy(asc(K.firma));
  const kundenpreise = await db.select({ kundeId: KP.kundeId, preis: KP.preisNetto, firma: K.firma }).from(KP).innerJoin(K, eq(K.id, KP.kundeId)).where(and(eq(KP.tenantId, t), eq(KP.dealId, id))).orderBy(asc(K.firma));
  const blatt = await dealBlatt(t, d);
  const bester = besterMarkt(d.prognose);
  const vorschlag = mengenVorschlag({ verkaeufeBesterMarkt: bester?.verkaeufe ?? null, faktor: s.b2b.mengenFaktor, eigenerBestand: d.nurRestmenge ? d.eigenerBestand : 0 });
  const laender: RechnerLand[] = s.b2b.marktplaetze
    .filter((l) => d.prognose[l])
    .map((l) => {
      const p = d.prognose[l];
      return { land: l, vk: p.vk, vkEur: p.vkEur, vk90: p.vk90, tief12: p.tief12, waehrung: p.waehrung, mwstSatz: p.mwstSatz, gebuehren: p.gebuehren, geschaetzt: !!p.gebuehrenGeschaetzt, verkaeufe: p.verkaeufeMonat, angebote: p.angeboteFba === null && p.angeboteFbm === null ? null : (p.angeboteFba ?? 0) + (p.angeboteFbm ?? 0), amazonProzent: p.amazonProzent, aktionsmuster: p.aktionsmuster ?? null, fehler: p.fehler ?? null };
    });
  const offen = ["entwurf", "aktiv"].includes(d.status);
  const prognoseLeer = Object.keys(d.prognose).length === 0;
  const frisch = Date.now() - d.createdAt.getTime() < 90_000;
  const muster = laender.filter((l) => l.aktionsmuster);
  const meldung = sp.meldung ? (MELDUNGEN[sp.meldung] ?? sp.meldung) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/b2b">B2B-Deals</Link></div>
          <h1 style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Deal #{d.nr} <span className={`tag ${DEAL_STATUS_TAG[d.status]}`} data-testid="deal-status">{DEAL_STATUS_TEXT[d.status]}</span></h1>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a className="btn" href={`/b2b/${d.id}/blatt`} target="_blank" rel="noreferrer">Deal-Blatt (PDF)</a>
          {offen && (
            <form action={prognoseAction}><input type="hidden" name="id" value={d.id} /><SubmitButton className="btn" label="Prognose aktualisieren" pendingLabel="Frage ab …" /></form>
          )}
          {d.status === "aktiv" && (
            <form action={schliessenAction}><input type="hidden" name="id" value={d.id} /><ConfirmButton className="btn" confirm="Deal schließen? Danach sind keine neuen Reservierungen mehr möglich.">Schließen</ConfirmButton></form>
          )}
        </div>
      </div>
      {meldung && <div className={`notice ${/fehlt|nicht|Bitte|Ungültig|schon/.test(meldung) && !MELDUNGEN[sp.meldung ?? ""] ? "notice-warn" : "notice-ok"}`} data-testid="deal-meldung">{meldung}</div>}
      {prognoseLeer && offen && (frisch ? <WartenAufPrognose /> : <div className="notice notice-warn">Noch keine Prognose – „Prognose aktualisieren“ drücken.</div>)}

      <section className="card card-pad" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {d.bildUrl ? <img src={d.bildUrl} alt="" width={96} height={96} style={{ objectFit: "contain", borderRadius: 8, background: "#fff" }} /> : null}
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 240 }}>
          <b data-testid="deal-titel">{d.titel}</b>
          <div className="small num">ASIN <a href={`https://www.amazon.de/dp/${d.asin}`} target="_blank" rel="noreferrer">{d.asin}</a>{d.ean ? ` · EAN ${d.ean}` : ""}{d.marke ? ` · ${d.marke}` : ""}{d.kategorie ? ` · ${d.kategorie}` : ""}</div>
          <div className="small">Lieferant: {lieferant ? <b>{lieferant.name}</b> : <span className="muted">–</span>} · EK {formatEuro(d.ekNetto)} netto · MOQ {d.moqLieferant}{d.staffel.length ? ` · Staffel ${staffelText(d.staffel)}` : ""}{d.lieferzeitTage !== null ? ` · Lieferzeit ${d.lieferzeitTage} T.` : ""}{d.angebotGueltigBis ? ` · Angebot bis ${formatDate(d.angebotGueltigBis)}` : ""}</div>
          <div className="small">
            Kundenpreis <b>{formatEuro(d.kundenpreisNetto)}</b> netto · ab {d.mindestmengeKunde} Stück{d.maxProKunde ? `, max. ${d.maxProKunde} je Kunde` : ""} · max. gesamt {d.maxGesamt ?? "offen"} · max. {d.maxKunden ?? "–"} Kunden · Frist {formatDate(d.frist)}
          </div>
          <div className="small" data-testid="deal-reserviert">Reserviert <b>{reserviert}</b>{d.maxGesamt ? ` / ${d.maxGesamt}` : ""} Stück von {aktiv.length} Kunde(n) · bezahlt {bezahlt} · MOQ Lieferant {d.moqLieferant} {reserviert >= d.moqLieferant ? "✓ erreicht" : `(fehlen ${d.moqLieferant - reserviert})`}</div>
        </div>
      </section>

      {(d.eigenerBestand > 0 || muster.length > 0 || !freigabe.ok || (d.angebotGueltigBis && d.frist && d.angebotGueltigBis < d.frist)) && (
        <section className="notice notice-warn stack" style={{ gap: 4 }} data-testid="deal-warnungen">
          {d.eigenerBestand > 0 && <div>Wir haben die ASIN selbst: <b>{d.eigenerBestand}</b> Stück im Bestand (FBA inkl. unterwegs, FBM). {d.nurRestmenge ? "Nur die Restmenge wird abgegeben – Vorschlag berücksichtigt den Bestand." : "Achtung: eigene Konkurrenz – „nur Restmenge“ erwägen."}</div>}
          {muster.map((l) => <div key={l.land}>{l.land}: {l.aktionsmuster}</div>)}
          {!freigabe.ok && <div>Vertriebsfreigabe: {freigabe.fehlt.join(", ")}. {d.supplierId ? <Link href={`/b2b/lieferanten/${d.supplierId}`}>Im Lieferanten-Profil klären →</Link> : "Erst einen Lieferanten wählen."}</div>}
          {d.angebotGueltigBis && d.frist && d.angebotGueltigBis < d.frist && <div>Das Angebot des Lieferanten gilt nur bis {formatDate(d.angebotGueltigBis)} – vor der Reservierungsfrist.</div>}
        </section>
      )}

      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>Rechenhilfe</h2>
        {offen ? (
          <Rechner id={d.id} ek={d.ekNetto} versandAnteil={d.versandAnteil} prepGebuehr={d.prepGebuehr} minRoiProzent={s.b2b.minKundenRoi * 100} preis={d.kundenpreisNetto} menge={d.maxGesamt ?? d.moqLieferant} laender={laender} reservierungen={aktiv.length} aktion={preisAction} />
        ) : (
          <div className="small muted">Deal ist {DEAL_STATUS_TEXT[d.status]} – Preis fest bei {formatEuro(d.kundenpreisNetto)}.</div>
        )}
        {offen && vorschlag !== null && vorschlag !== d.maxGesamt && (
          <form action={maxGesamtAction} className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="id" value={d.id} />
            <input type="hidden" name="maxGesamt" value={vorschlag} />
            <span>Vorschlag max. gesamt: <b>{vorschlag}</b> Stück ({bester?.land}: ~{bester?.verkaeufe}/Monat × {String(s.b2b.mengenFaktor).replace(".", ",")}{d.nurRestmenge && d.eigenerBestand ? ` − ${d.eigenerBestand} eigener Bestand` : ""})</span>
            <button className="btn btn-small" type="submit" data-testid="vorschlag-uebernehmen">Übernehmen</button>
          </form>
        )}
      </section>

      {d.status === "entwurf" && (
        <section className="card card-pad stack" style={{ gap: 10 }}>
          <h2>Freischalten</h2>
          {hindernisse.length > 0 ? (
            <div className="notice notice-warn" data-testid="freischalt-hindernisse">{hindernisse.map((h) => <div key={h}>{h}</div>)}</div>
          ) : (
            <form action={freischaltenAction} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="id" value={d.id} />
              <label className="check small"><input type="checkbox" name="mails" defaultChecked /> Kunden mit passendem Abo per Mail benachrichtigen</label>
              <div className="small muted">Danach im Kundenportal sichtbar{blatt.firma.name ? ` (Verkäufer: ${blatt.firma.name})` : ""}; Meldung in Discord, wenn unter Anbindungen ein Webhook eingetragen ist.</div>
              <div><ConfirmButton className="btn btn-primary" confirm="Deal freischalten? Kunden können dann reservieren." testid="freischalten">Freischalten</ConfirmButton></div>
            </form>
          )}
          <form action={verwerfenAction}><input type="hidden" name="id" value={d.id} /><ConfirmButton confirm="Entwurf verwerfen? Er bleibt als „verfallen“ in der Liste.">Entwurf verwerfen</ConfirmButton></form>
        </section>
      )}

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-head"><h2>Reservierungen</h2><span className="small muted">Rechnung, Zahlung und Bestellung folgen im nächsten Schritt</span></div>
        <table className="table" data-testid="reservierungen">
          <thead><tr><th>Kunde</th><th className="right">Menge</th><th className="right">Preis netto</th><th>Steuer</th><th>Status</th><th>Rechnung</th><th>Reserviert am</th></tr></thead>
          <tbody>
            {res.length === 0 && <tr><td colSpan={7} className="muted">Noch keine Reservierungen.</td></tr>}
            {res.map(({ r, firma }) => (
              <tr key={r.id}>
                <td>{firma}</td>
                <td className="num right">{r.menge}{r.zugeteilt !== null && r.zugeteilt !== r.menge ? <div className="small" style={{ color: "var(--danger)" }}>zugeteilt {r.zugeteilt}</div> : null}</td>
                <td className="num right">{formatEuro(r.preisNetto)}</td>
                <td className="small">{r.reverseCharge ? "Reverse Charge" : "mit USt"}</td>
                <td><span className={`tag ${RES_STATUS_TAG[r.status]}`}>{RES_STATUS_TEXT[r.status]}</span></td>
                <td className="small num">{r.rechnungNr ?? "–"}{r.rechnungBrutto !== null ? <div>{formatEuro(r.rechnungBrutto)}</div> : null}</td>
                <td className="small num">{r.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>Preis je Kunde</h2>
        <div className="small muted">Abweichender Preis für einzelne Kunden (z. B. Stammkunden). Gilt für neue Reservierungen.</div>
        {kundenpreise.length > 0 && (
          <table className="table" data-testid="kundenpreise">
            <tbody>
              {kundenpreise.map((k) => (
                <tr key={k.kundeId}>
                  <td>{k.firma}</td>
                  <td className="num right">{formatEuro(k.preis)}</td>
                  <td className="right">
                    {offen && <form action={kundenpreisAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="kundeId" value={k.kundeId} /><input type="hidden" name="entfernen" value="1" /><button className="btn btn-small" type="submit">Entfernen</button></form>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {offen && (kunden.length === 0 ? (
          <div className="small muted">Noch keine B2B-Kunden – <Link href="/b2b/kunden">Kunden anlegen</Link>.</div>
        ) : (
          <form action={kundenpreisAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <input type="hidden" name="id" value={d.id} />
            <div className="field">
              <label className="label" htmlFor="kp-kunde">Kunde</label>
              <select className="input" id="kp-kunde" name="kundeId" style={{ width: 220, maxWidth: "100%" }}>{kunden.map((k) => <option key={k.id} value={k.id}>{k.firma}</option>)}</select>
            </div>
            <div className="field">
              <label className="label" htmlFor="kp-preis">Preis netto</label>
              <input className="input" id="kp-preis" name="preisNetto" inputMode="decimal" style={{ width: 100 }} />
            </div>
            <button className="btn" type="submit">Speichern</button>
          </form>
        ))}
      </section>

      <section className="card card-pad stack" style={{ gap: 10 }}>
        <div className="between"><h2>Deal-Blatt</h2><CopyButton text={blatt.text} label="Text kopieren" /></div>
        <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }} data-testid="deal-blatt">{blatt.text}</pre>
        <div className="small muted">Für WhatsApp/Discord/Mail. Portal-Link: <span className="num">{portalLink(d.id)}</span></div>
        <div className="small" data-testid="discord-status">
          Discord: {(["neu", "fastWeg", "geschlossen"] as const).map((a) => (
            <span key={a} style={{ marginRight: 10 }}>
              {a === "neu" ? "neu" : a === "fastWeg" ? "fast weg" : "geschlossen"} {d.discord[a] ? `✓ ${new Date(d.discord[a]!).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}` : "–"}
            </span>
          ))}
          {d.status !== "entwurf" && !d.discord.neu && (
            <form action={discordNochmalAction} style={{ display: "inline" }}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="art" value="neu" /><button className="btn btn-small" type="submit">Jetzt melden</button></form>
          )}
        </div>
      </section>

      {offen && (
        <section className="card card-pad">
          <Disclosure summary="Deal bearbeiten">
            <form action={dealSpeichernAction} className="stack" style={{ gap: 12, marginTop: 10 }}>
              <input type="hidden" name="id" value={d.id} />
              <DealFelder
                w={{ ...d, staffel: staffelText(d.staffel), kundenpreisNetto: undefined }}
                lieferanten={lieferanten}
                mitPreis={false}
                fest={d.status === "aktiv"}
              />
              {d.status === "aktiv" && <div className="small muted">Nach dem Freischalten sind ASIN, EK, Staffel, MOQ und Lieferant fest.</div>}
              <div><SubmitButton label="Speichern" pendingLabel="Speichere …" testId="deal-speichern" /></div>
            </form>
          </Disclosure>
        </section>
      )}
      <div className="small muted">Rechtliches: Kunden prüfen die Markenfreigabe selbst; Prognosen sind ohne Garantie (steht so im Portal und auf dem Deal-Blatt). Selektiven Vertrieb (Weiterverkaufsverbote) vorher beim Lieferanten klären – deshalb ist die Vertriebsfreigabe Pflicht.</div>
    </>
  );
}
