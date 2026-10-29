import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { formatDate, formatEuro } from "@/lib/numbers";
import { ART_LABEL } from "@/lib/retouren-station/fall";
import { BEFUND_KURZ, ENTSCHEIDUNG_TEXT, VERBLEIB_TEXT } from "@/lib/retouren-station/logic";

export default async function PruefungPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireArea("amazon");
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const t = session.tenantId;
  const P = schema.retourenPruefungen;
  const [p] = await db.select().from(P).where(and(eq(P.tenantId, t), eq(P.id, id.data)));
  if (!p) notFound();
  const [pos, med] = await Promise.all([
    db.select().from(schema.retourenPositionen).where(and(eq(schema.retourenPositionen.tenantId, t), eq(schema.retourenPositionen.pruefungId, p.id))).orderBy(asc(schema.retourenPositionen.nr)),
    db.select().from(schema.retourenMedien).where(and(eq(schema.retourenMedien.tenantId, t), eq(schema.retourenMedien.pruefungId, p.id), isNull(schema.retourenMedien.geloeschtAm))).orderBy(asc(schema.retourenMedien.aufgenommenAm)),
  ]);
  const video = med.find((m) => m.art === "video");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/remissionen/pruefungen?ansicht=pakete">Prüfungen & Fälle</Link></div>
          <h1>Paket vom {p.angelegtAm.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</h1>
        </div>
      </div>
      <section className="card card-pad stack small" style={{ gap: 4 }}>
        <div>Status: <b>{p.status}</b>{p.zusammenfassung ? ` · ${p.zusammenfassung}` : ""}</div>
        <div>Remission: <b>{p.remissionId ?? "–"}</b>{p.zuordnung ? ` (über ${p.zuordnung})` : ""} · Sendung: {p.versender ?? "–"} {p.sendungsnummer ?? ""}</div>
        {p.erwartet && <div>Erwartet: {p.erwartet.map((e) => `${e.titel ?? e.fnsku ?? e.sku} × ${e.menge}`).join(", ")}</div>}
        {p.lieferschein && <div>Lieferschein: {p.lieferschein.map((e) => `${e.titel ?? e.fnsku ?? e.sku} × ${e.menge}`).join(", ")}</div>}
        {p.abweichungen.length > 0 && <div style={{ color: "var(--danger)" }}>Abweichungen: {p.abweichungen.join(" · ")}</div>}
        {p.notiz && <div>Notiz: {p.notiz}</div>}
        {video ? (
          <div>
            Video ({video.teile} Teile, wird ab {formatDate(video.loeschenAb)} gelöscht, außer ein Fall ist offen):
            <video src={`/remissionen/pruefungen/medien/${video.id}`} controls preload="none" style={{ display: "block", maxWidth: "100%", maxHeight: 360, marginTop: 6, background: "#000" }} />
          </div>
        ) : (
          <div className="muted">Kein Video.</div>
        )}
      </section>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>#</th><th>Artikel</th><th>LPN / Bestellung</th><th>Befund</th><th className="right">Erstattet</th><th>Entscheidung</th><th>Verbleib / RET-SKU</th></tr></thead>
          <tbody>
            {pos.length === 0 && <tr><td colSpan={7} className="muted">Keine Artikel.</td></tr>}
            {pos.map((x) => (
              <tr key={x.id}>
                <td className="num">{x.nr}</td>
                <td><Link href={`/remissionen/pruefungen/fall/${x.id}`}>{x.titel ?? (x.zuordnung === "unbekannt" ? "nicht erkannt" : "–")}</Link>{x.kiAbweichung && <span className="tag tag-warn" style={{ marginLeft: 6 }}>KI weicht ab</span>}</td>
                <td className="num small">{x.lpn ?? x.fnsku ?? "–"}<div className="muted">{x.bestellnummer ?? ""}</div></td>
                <td>{x.befund ? BEFUND_KURZ[x.befund] : "–"}</td>
                <td className="num right">{formatEuro(x.erstattetBetrag)}</td>
                <td className="small">{x.entscheidung ? ENTSCHEIDUNG_TEXT[x.entscheidung] : "–"}</td>
                <td className="small">{x.verbleib ? VERBLEIB_TEXT[x.verbleib] : "–"}{x.retSku ? <div className="num">{x.retSku}</div> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card card-pad">
        <h2>Fotos</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 8 }}>
          {med.filter((m) => m.art !== "video").map((m) => (
            <a key={m.id} href={`/remissionen/pruefungen/medien/${m.id}`} target="_blank" rel="noreferrer" className="small" style={{ textDecoration: "none", color: "inherit" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/remissionen/pruefungen/medien/${m.id}?klein=1`} alt={ART_LABEL[m.art]} style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 6, background: "#eee" }} />
              <div>{ART_LABEL[m.art]}{m.positionId ? ` · Artikel ${pos.find((x) => x.id === m.positionId)?.nr ?? ""}` : ""}</div>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
