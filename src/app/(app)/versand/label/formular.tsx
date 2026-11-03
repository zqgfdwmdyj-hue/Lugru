"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { gefahrgutPruefen, KANAELE, paketFuerGewicht, VERSAND_PRODUKTE, VERSICHERUNG_MAX, ZAHLUNGSARTEN, type Empfaenger, type ProduktKey } from "@/lib/versand-label/logic";
import type { LabelErgebnis } from "@/lib/versand-label/service";
import { erkennenAction, erstellenAction, pruefenAction } from "./actions";

// Versand → Label erstellen: Adresse einfügen (Text) oder Bild (Drag-and-Drop, Kamera, Einfügen) → KI füllt das
// Formular, unsichere Felder gelb → DHL-Prüfung → Label. Bei Fehlern bleibt alles ausgefüllt.

type Stamm = { quelle: "b2b" | "paletten" | "zuletzt"; titel: string; adresse: Empfaenger };
export type Vorbelegung = Partial<{
  id: string;
  kanal: string;
  produkt: string;
  empfaenger: Empfaenger;
  unsicher: string[];
  gewichtKg: string;
  artikel: string;
  sku: string;
  menge: number;
  preis: string;
  zahlungsart: string;
}>;

const LEER: Empfaenger = { name: "", name2: "", strasse: "", hausnummer: "", plz: "", ort: "", land: "DE", telefon: "", email: "", packstation: "", postnummer: "" };
const FELDER: { k: keyof Empfaenger; titel: string; breit?: boolean; klein?: boolean }[] = [
  { k: "name", titel: "Name", breit: true },
  { k: "name2", titel: "Zusatz (Firma, c/o)", breit: true },
  { k: "strasse", titel: "Straße" },
  { k: "hausnummer", titel: "Hausnr.", klein: true },
  { k: "plz", titel: "PLZ", klein: true },
  { k: "ort", titel: "Ort" },
  { k: "land", titel: "Land", klein: true },
  { k: "telefon", titel: "Telefon" },
  { k: "email", titel: "E-Mail" },
  { k: "packstation", titel: "Packstation (z. B. Packstation 123)" },
  { k: "postnummer", titel: "Postnummer" },
];
const zahl = (s: string) => {
  const n = Number(String(s).replace(",", ".").trim());
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};
const euro = (n: number | null) => (n === null ? "–" : `${n.toFixed(2).replace(".", ",")} €`);

export function LabelFormular({ stamm, vorbelegung, b2bErlaubt, absender2, absender1 }: { stamm: Stamm[]; vorbelegung: Vorbelegung | null; b2bErlaubt: boolean; absender2: string | null; absender1: string }) {
  const [text, setText] = useState("");
  const [bild, setBild] = useState<File | null>(null);
  const [vorschau, setVorschau] = useState<string | null>(null);
  const [ueber, setUeber] = useState(false);
  const [erkennt, setErkennt] = useState(false);
  const [erkannt, setErkannt] = useState<string | null>(null);
  const [a, setA] = useState<Empfaenger>({ ...LEER, ...(vorbelegung?.empfaenger ?? {}) });
  const [unsicher, setUnsicher] = useState<string[]>(vorbelegung?.unsicher ?? []);
  const [kanal, setKanal] = useState(vorbelegung?.kanal ?? "kleinanzeigen");
  const [absender, setAbsender] = useState<"lugru" | "zweiter">("lugru");
  const [gewicht, setGewicht] = useState(vorbelegung?.gewichtKg ?? "");
  const [produkt, setProdukt] = useState<ProduktKey>((vorbelegung?.produkt as ProduktKey) ?? "paket_2");
  const [produktVonHand, setProduktVonHand] = useState(Boolean(vorbelegung?.produkt && vorbelegung.produkt !== "paket_2"));
  const [masse, setMasse] = useState({ l: "", b: "", h: "" });
  const [wert, setWert] = useState("");
  const [versichern, setVersichern] = useState(false);
  const [alterssicht, setAlterssicht] = useState<"" | "A16" | "A18">("");
  const [artikel, setArtikel] = useState(vorbelegung?.artikel ?? "");
  const [sku, setSku] = useState(vorbelegung?.sku ?? "");
  const [menge, setMenge] = useState(String(vorbelegung?.menge ?? 1));
  const [preis, setPreis] = useState(vorbelegung?.preis ?? "");
  const [zahlungsart, setZahlungsart] = useState(vorbelegung?.zahlungsart ?? "");
  const [lq, setLq] = useState(false);
  const [un, setUn] = useState("");
  const [klasse, setKlasse] = useState("");
  const [mengeJe, setMengeJe] = useState("");
  const [lithium, setLithium] = useState<"" | "UN3481" | "UN3091">("");
  const [voll, setVoll] = useState(false);
  const [pruefung, setPruefung] = useState<{ ok: boolean; meldungen: string[]; dhl: boolean } | null>(null);
  const [laeuft, setLaeuft] = useState<"pruefen" | "erstellen" | null>(null);
  const [ergebnis, setErgebnis] = useState<LabelErgebnis | null>(null);
  // Nach Fehler/Vorlage denselben Eintrag weiterverwenden (kein doppelter Protokolleintrag).
  const [vorlageId, setVorlageId] = useState<string | null>(vorbelegung?.id ?? null);
  const [kopiert, setKopiert] = useState<string | null>(null);
  const datei = useRef<HTMLInputElement>(null);
  const kamera = useRef<HTMLInputElement>(null);

  const kg = zahl(gewicht) ?? 0;
  const gg = useMemo(() => gefahrgutPruefen({ lq, un, klasse, mengeJePackstueck: mengeJe, lithium: lithium || null, vollgefahrgut: voll }, kg), [lq, un, klasse, mengeJe, lithium, voll, kg]);
  const gesperrt = gg.fehler.some((f) => f.includes("per Spedition"));

  function bildSetzen(f: File | null) {
    setBild(f);
    if (vorschau) URL.revokeObjectURL(vorschau);
    setVorschau(f ? URL.createObjectURL(f) : null);
  }

  async function erkennen() {
    setErkennt(true);
    setErkannt(null);
    setErgebnis(null);
    try {
      const fd = new FormData();
      fd.set("text", text);
      // Auch ein Bild, das vor dem vollständigen Laden der Seite gewählt wurde.
      const b = bild ?? datei.current?.files?.[0] ?? kamera.current?.files?.[0] ?? null;
      if (b) fd.set("bild", b);
      const r = await erkennenAction(fd);
      if ("fehler" in r) {
        setErkannt(r.fehler);
        return;
      }
      setA({ ...LEER, ...r.adresse });
      setUnsicher(r.unsicher);
      setErkannt(`${r.quelle === "ki" ? "Von der KI gelesen" : "Nach Regeln gelesen"}${r.unsicher.length ? ` – ${r.unsicher.length} Feld${r.unsicher.length === 1 ? "" : "er"} gelb: bitte prüfen` : " – alles erkannt"}.${r.hinweis ? ` ${r.hinweis}` : ""}`);
      setPruefung(null);
    } finally {
      setErkennt(false);
    }
  }

  function feld(k: keyof Empfaenger, v: string) {
    setA((x) => ({ ...x, [k]: v }));
    setUnsicher((u) => u.filter((x) => x !== k));
    setPruefung(null);
  }

  function gewichtSetzen(v: string) {
    setGewicht(v);
    const n = zahl(v);
    if (n && !produktVonHand) {
      const p = paketFuerGewicht(n);
      if (p) setProdukt(p);
    }
  }

  const eingabe = () => ({
    kanal,
    absender,
    empfaenger: { ...a, land: (a.land || "DE").toUpperCase().slice(0, 2) },
    unsicher,
    produkt,
    gewichtKg: kg,
    masse: zahl(masse.l) && zahl(masse.b) && zahl(masse.h) ? { l: zahl(masse.l)!, b: zahl(masse.b)!, h: zahl(masse.h)! } : null,
    wert: zahl(wert),
    services: { versicherung: versichern ? (zahl(wert) ?? 0) : null, alterssicht: alterssicht || null },
    gefahrgut: lq || lithium || voll ? { lq, un, klasse, mengeJePackstueck: mengeJe, lithium: lithium || null, vollgefahrgut: voll } : null,
    artikel,
    sku,
    menge: Math.max(1, Math.round(zahl(menge) ?? 1)),
    preis: zahl(preis),
    zahlungsart,
    vorlageId,
  });

  async function pruefen() {
    setLaeuft("pruefen");
    try {
      setPruefung(await pruefenAction(eingabe()));
    } finally {
      setLaeuft(null);
    }
  }

  async function erstellen() {
    setLaeuft("erstellen");
    setErgebnis(null);
    try {
      const r = await erstellenAction(eingabe());
      setErgebnis(r);
      if (!r.ok && r.id) setVorlageId(r.id);
      if (r.ok) setVorlageId(null);
    } catch (x) {
      setErgebnis({ ok: false, fehler: x instanceof Error ? x.message : String(x) });
    } finally {
      setLaeuft(null);
    }
  }

  async function kopieren(was: string, inhalt: string) {
    try {
      await navigator.clipboard.writeText(inhalt);
    } catch {
      /* ohne Zwischenablage: Text steht im Feld */
    }
    setKopiert(was);
    setTimeout(() => setKopiert(null), 2000);
  }

  const gelb = (k: string) => (unsicher.includes(k) ? " feld-unsicher" : "");
  const versicherungZuHoch = versichern && (zahl(wert) ?? 0) > VERSICHERUNG_MAX;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="label-eingabe">
        <h2 style={{ margin: 0 }}>1. Adresse einfügen oder Bild</h2>
        <div
          className={`label-drop${ueber ? " label-drop-aktiv" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setUeber(true);
          }}
          onDragLeave={() => setUeber(false)}
          onDrop={(e) => {
            e.preventDefault();
            setUeber(false);
            const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
            if (f) bildSetzen(f);
          }}
        >
          <textarea
            className="input"
            rows={5}
            placeholder={"WhatsApp-/Kleinanzeigen-Text hier einfügen …\nz. B. Max Mustermann, Teststraße 12a, 12345 Musterstadt"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
              if (f) {
                e.preventDefault();
                bildSetzen(f);
              }
            }}
            data-testid="label-text"
            style={{ width: "100%" }}
          />
          <div className="small muted">oder Screenshot/Foto hierher ziehen, einfügen, auswählen oder fotografieren</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn btn-sm" onClick={() => datei.current?.click()}>
              🖼️ Bild wählen
            </button>
            <button type="button" className="btn btn-sm" onClick={() => kamera.current?.click()}>
              📷 Kamera
            </button>
            <input ref={datei} type="file" accept="image/*" hidden onChange={(e) => bildSetzen(e.target.files?.[0] ?? null)} data-testid="label-bild" />
            <input ref={kamera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => bildSetzen(e.target.files?.[0] ?? null)} />
            {bild && (
              <span className="small" data-testid="label-bild-name">
                {vorschau && <img src={vorschau} alt="" style={{ height: 40, verticalAlign: "middle", borderRadius: 4, marginRight: 6 }} />}
                {bild.name}{" "}
                <button type="button" className="btn btn-sm" onClick={() => bildSetzen(null)} aria-label="Bild entfernen">
                  ✕
                </button>
              </span>
            )}
            <button type="button" className="btn btn-primary" onClick={erkennen} disabled={erkennt} data-testid="label-erkennen">
              {erkennt ? "Lese …" : "Adresse erkennen"}
            </button>
          </div>
          {erkannt && (
            <div className="small" data-testid="label-erkannt">
              {erkannt}
            </div>
          )}
        </div>
        {stamm.length > 0 && (
          <div className="field" style={{ maxWidth: 420 }}>
            <label className="label" htmlFor="stamm">
              Stammadresse
            </label>
            <select
              className="select"
              id="stamm"
              defaultValue=""
              data-testid="label-stamm"
              onChange={(e) => {
                const s = stamm[Number(e.target.value)];
                if (!s) return;
                setA({ ...LEER, ...s.adresse });
                setUnsicher([]);
                if (s.quelle === "b2b") setKanal("b2b");
              }}
            >
              <option value="">– auswählen –</option>
              {stamm.map((s, i) => (
                <option key={`${s.quelle}-${i}`} value={i}>
                  {s.quelle === "b2b" ? "B2B · " : s.quelle === "paletten" ? "Palettenkunde · " : "Zuletzt · "}
                  {s.titel}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="label-adresse">
        <h2 style={{ margin: 0 }}>2. Empfänger</h2>
        {unsicher.length > 0 && <div className="small muted">Gelbe Felder bitte prüfen – ändern oder einmal antippen bestätigt sie.</div>}
        <div className="label-felder">
          {FELDER.map((f) => (
            <div key={f.k} className={`field${f.breit ? " label-breit" : ""}${f.klein ? " label-klein" : ""}`}>
              <label className="label" htmlFor={`ad-${f.k}`}>
                {f.titel}
                {unsicher.includes(f.k) ? " ⚠︎" : ""}
              </label>
              <input className={`input${gelb(f.k)}`} id={`ad-${f.k}`} value={a[f.k] ?? ""} onChange={(e) => feld(f.k, e.target.value)} onBlur={() => setUnsicher((u) => u.filter((x) => x !== f.k))} data-testid={`ad-${f.k}`} data-unsicher={unsicher.includes(f.k) ? "1" : "0"} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn btn-sm" onClick={pruefen} disabled={laeuft !== null} data-testid="label-pruefen">
            {laeuft === "pruefen" ? "Prüfe …" : "Adresse prüfen (DHL)"}
          </button>
          {pruefung && (
            <span className={`small tag ${pruefung.ok ? "tag-ok" : "tag-warn"}`} data-testid="label-pruefung">
              {pruefung.meldungen.join(" · ")}
            </span>
          )}
        </div>
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="label-sendung">
        <h2 style={{ margin: 0 }}>3. Sendung</h2>
        <div className="label-felder">
          <div className="field">
            <label className="label" htmlFor="kanal">Kanal</label>
            <select className="select" id="kanal" value={kanal} onChange={(e) => setKanal(e.target.value)} data-testid="label-kanal">
              {KANAELE.filter((k) => k.key !== "b2b" || b2bErlaubt).map((k) => (
                <option key={k.key} value={k.key}>{k.titel}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="absender">Absender</label>
            <select className="select" id="absender" value={absender} onChange={(e) => setAbsender(e.target.value as "lugru" | "zweiter")} data-testid="label-absender">
              <option value="lugru">{absender1}</option>
              {absender2 && <option value="zweiter">{absender2}</option>}
            </select>
          </div>
          <div className="field label-breit">
            <label className="label" htmlFor="artikel">Artikel (frei)</label>
            <input className="input" id="artikel" value={artikel} onChange={(e) => setArtikel(e.target.value)} data-testid="label-artikel" />
          </div>
          <div className="field">
            <label className="label" htmlFor="sku">SKU/EAN (Scanner)</label>
            <input className="input" id="sku" value={sku} onChange={(e) => setSku(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} data-testid="label-sku" />
          </div>
          <div className="field label-klein">
            <label className="label" htmlFor="menge">Stück</label>
            <input className="input" id="menge" inputMode="numeric" value={menge} onChange={(e) => setMenge(e.target.value)} />
          </div>
          <div className="field label-klein">
            <label className="label" htmlFor="preis">Preis €/Stk</label>
            <input className="input" id="preis" inputMode="decimal" value={preis} onChange={(e) => setPreis(e.target.value)} data-testid="label-preis" />
          </div>
          <div className="field">
            <label className="label" htmlFor="zahlungsart">Zahlungsart</label>
            <input className="input" id="zahlungsart" list="zahlungsarten" value={zahlungsart} onChange={(e) => setZahlungsart(e.target.value)} data-testid="label-zahlungsart" />
            <datalist id="zahlungsarten">{ZAHLUNGSARTEN.map((z) => <option key={z} value={z} />)}</datalist>
          </div>
          <div className="field label-klein">
            <label className="label" htmlFor="gewicht">Gewicht kg</label>
            <input className="input" id="gewicht" inputMode="decimal" value={gewicht} onChange={(e) => gewichtSetzen(e.target.value)} data-testid="label-gewicht" />
          </div>
          <div className="field">
            <label className="label">Maße L × B × H cm</label>
            <div style={{ display: "flex", gap: 4 }}>
              {(["l", "b", "h"] as const).map((k) => (
                <input key={k} className="input" inputMode="decimal" style={{ width: 56 }} value={masse[k]} onChange={(e) => setMasse((m) => ({ ...m, [k]: e.target.value }))} aria-label={k.toUpperCase()} />
              ))}
            </div>
          </div>
          <div className="field label-klein">
            <label className="label" htmlFor="wert">Wert €</label>
            <input className="input" id="wert" inputMode="decimal" value={wert} onChange={(e) => setWert(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="produkt">Produkt</label>
            <select
              className="select"
              id="produkt"
              value={produkt}
              onChange={(e) => {
                setProdukt(e.target.value as ProduktKey);
                setProduktVonHand(true);
              }}
              data-testid="label-produkt"
            >
              {VERSAND_PRODUKTE.map((p) => (
                <option key={p.key} value={p.key}>{p.titel}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }} className="small">
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={versichern} onChange={(e) => setVersichern(e.target.checked)} data-testid="label-versichern" /> Versicherung (Wert, bis {VERSICHERUNG_MAX.toLocaleString("de-DE")} €)
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Alterssichtprüfung
            <select className="select" value={alterssicht} onChange={(e) => setAlterssicht(e.target.value as "" | "A16" | "A18")} style={{ width: "auto" }}>
              <option value="">nein</option>
              <option value="A16">ab 16</option>
              <option value="A18">ab 18</option>
            </select>
          </label>
          <span className="muted">Packstation: oben „Packstation“ + „Postnummer“ ausfüllen. Keine Nachnahme, keine Wunschzeit.</span>
        </div>
        {versicherungZuHoch && <div className="notice notice-warn small">Versicherung höchstens {VERSICHERUNG_MAX.toLocaleString("de-DE")} €.</div>}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="label-gefahrgut">
        <h2 style={{ margin: 0 }}>Gefahrgut</h2>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }} className="small">
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={lq} onChange={(e) => setLq(e.target.checked)} data-testid="gg-lq" /> Gefahrgut (begrenzte Menge, LQ)
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Lithium-Batterien in Ausrüstung
            <select className="select" value={lithium} onChange={(e) => setLithium(e.target.value as "" | "UN3481" | "UN3091")} style={{ width: "auto" }} data-testid="gg-lithium">
              <option value="">nein</option>
              <option value="UN3481">UN3481 (Lithium-Ionen)</option>
              <option value="UN3091">UN3091 (Lithium-Metall)</option>
            </select>
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={voll} onChange={(e) => setVoll(e.target.checked)} data-testid="gg-voll" /> Vollgefahrgut (nicht LQ)
          </label>
        </div>
        {lq && (
          <div className="label-felder">
            <div className="field label-klein">
              <label className="label" htmlFor="gg-un">UN-Nummer</label>
              <input className="input" id="gg-un" value={un} onChange={(e) => setUn(e.target.value)} placeholder="UN1950" data-testid="gg-un" />
            </div>
            <div className="field label-klein">
              <label className="label" htmlFor="gg-klasse">Klasse</label>
              <input className="input" id="gg-klasse" value={klasse} onChange={(e) => setKlasse(e.target.value)} placeholder="2.1" data-testid="gg-klasse" />
            </div>
            <div className="field">
              <label className="label" htmlFor="gg-menge">Menge je Packstück</label>
              <input className="input" id="gg-menge" value={mengeJe} onChange={(e) => setMengeJe(e.target.value)} placeholder="6 × 0,4 L" data-testid="gg-menge" />
            </div>
          </div>
        )}
        {(lq || lithium || voll) && (
          <div className="stack small" style={{ gap: 4 }} data-testid="gg-ergebnis" data-gesperrt={gesperrt ? "1" : "0"}>
            {gg.fehler.map((f) => (
              <div key={f} className={`notice ${f.includes("per Spedition") ? "notice-error" : "notice-warn"}`}>{f}</div>
            ))}
            {gg.hinweise.map((h) => (
              <div key={h} className="notice notice-info">{h}</div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn btn-primary" onClick={erstellen} disabled={laeuft !== null || gesperrt || versicherungZuHoch} data-testid="label-erstellen">
          {laeuft === "erstellen" ? "Erstelle Label …" : "Label erstellen"}
        </button>
        {gesperrt && <span className="small" style={{ color: "var(--danger)" }}>Gesperrt – per Spedition.</span>}
      </div>

      {ergebnis && !ergebnis.ok && (
        <div className={`notice ${ergebnis.vorlage ? "notice-warn" : "notice-error"}`} role="alert" data-testid="label-fehler" data-vorlage={ergebnis.vorlage ? "1" : "0"}>
          {ergebnis.fehler}
        </div>
      )}
      {ergebnis?.ok && (
        <section className="card card-pad stack" style={{ gap: 8 }} data-testid="label-ergebnis">
          <div className="notice notice-ok">
            Label erstellt{ergebnis.nr ? ` – Sendungsnummer ${ergebnis.nr}` : ""} ({String(ergebnis.sekunden).replace(".", ",")} s){ergebnis.kosten !== null ? ` · Kosten laut Preisliste ${euro(ergebnis.kosten)}` : ""}.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn btn-primary" href={`/datei/${ergebnis.fileId}`} target="_blank" rel="noreferrer" data-testid="label-pdf">
              🖨️ Label drucken (PDF)
            </a>
            {ergebnis.kennzeichen.map((k) => (
              <a key={k} className="btn" href={`/etikett/gefahrgut?art=${k}${ergebnis.un && k === "lithium" ? `&un=${encodeURIComponent(ergebnis.un)}` : ""}`} target="_blank" rel="noreferrer" data-testid={`label-kennzeichen-${k}`}>
                {k === "lq" ? "◆ LQ-Kennzeichen drucken" : "🔋 Batterie-Kennzeichen drucken"}
              </a>
            ))}
            {ergebnis.orderId && (
              <Link className="btn" href={`/auftraege/${ergebnis.orderId}`} data-testid="label-auftrag">
                Auftrag öffnen
              </Link>
            )}
          </div>
          {ergebnis.tracking && (
            <div className="stack" style={{ gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="btn btn-sm" onClick={() => kopieren("link", ergebnis.tracking!)} data-testid="label-link-kopieren">
                  🔗 Tracking-Link kopieren
                </button>
                <button type="button" className="btn btn-sm" onClick={() => kopieren("text", ergebnis.text ?? "")} data-testid="label-text-kopieren">
                  💬 Text für WhatsApp/Kleinanzeigen kopieren
                </button>
                {kopiert && <span className="small tag tag-ok">kopiert</span>}
              </div>
              <textarea className="input" readOnly rows={4} value={ergebnis.text ?? ""} data-testid="label-textbaustein" style={{ width: "100%" }} />
            </div>
          )}
          {ergebnis.hinweise.length > 0 && <div className="small muted">{ergebnis.hinweise.join(" · ")}</div>}
        </section>
      )}
    </div>
  );
}
