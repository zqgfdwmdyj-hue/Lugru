"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STATUS_ALL = "";

/**
 * Suche und Filter über der Produktliste. Filtert nur die Anzeige im Browser – alle Zeilen bleiben im Formular, so
 * gehen beim Filtern keine Eingaben verloren. Kategorie und Prüfstatus lassen sich kombinieren; der Stand steht in
 * der Adresse (Links aus „Prüfen“ öffnen die Liste gleich gefiltert).
 */
export function ListControls({ listId, categories, statuses, total, initial }: {
  listId: string;
  categories: { name: string; count: number }[];
  statuses: { key: string; label: string; count: number }[];
  total: number;
  initial: { q: string; kat: string; status: string };
}) {
  const [q, setQ] = useState(initial.q);
  const [kat, setKat] = useState(initial.kat);
  const [status, setStatus] = useState(initial.status);
  const [shown, setShown] = useState(total);
  const [shownOpen, setShownOpen] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const apply = useCallback(() => {
    const list = document.getElementById(listId);
    if (!list) return;
    const words = q.toLocaleLowerCase("de-DE").split(/\s+/).filter(Boolean);
    let n = 0;
    let open = 0;
    let unchecked = false;
    for (const row of list.querySelectorAll<HTMLElement>("[data-row]")) {
      const text = row.dataset.search ?? "";
      const ok =
        words.every((w) => text.includes(w)) &&
        (!kat || row.dataset.cat === kat) &&
        (status === STATUS_ALL || (status === "fertig" ? !row.dataset.issues : (row.dataset.issues ?? "").split(" ").includes(status)));
      row.hidden = !ok;
      // Auch für Screenreader und Vorlese-Werkzeuge ausblenden (Warnsymbole ausgeblendeter Produkte).
      if (ok) {
        row.removeAttribute("aria-hidden");
        row.inert = false;
      } else {
        row.setAttribute("aria-hidden", "true");
        row.inert = true;
      }
      // Ausgeblendete Zeilen nicht versehentlich in Stapelaktionen mitnehmen.
      if (!ok) {
        const box = row.querySelector<HTMLInputElement>("input[name=sel]");
        if (box?.checked) {
          box.checked = false;
          unchecked = true;
        }
      }
      if (ok) n++;
      if (ok && row.dataset.issues) open++;
    }
    setShown(n);
    setShownOpen(open);
    if (unchecked) list.dispatchEvent(new Event("change", { bubbles: true }));
    const u = new URL(location.href);
    for (const [k, v] of [["q", q], ["kat", kat], ["status", status]] as const) {
      if (v) u.searchParams.set(k, v);
      else u.searchParams.delete(k);
    }
    history.replaceState(history.state, "", u);
  }, [listId, q, kat, status]);

  useEffect(() => {
    apply();
  }, [apply]);
  // Nach dem Neuladen der Liste (Speichern, KI fertig …) Filter erneut anwenden.
  useEffect(() => {
    const list = document.getElementById(listId);
    if (!list) return;
    const obs = new MutationObserver((m) => {
      if (m.some((x) => [...x.addedNodes].some((n) => n instanceof HTMLElement && (n.matches("[data-row]") || n.querySelector("[data-row]"))))) apply();
    });
    obs.observe(list, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [listId, apply]);

  // Beim Aufklappen das erste Feld der Details erreichbar machen (Tastatur) – das Aufklappen selbst macht CSS.
  useEffect(() => {
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (!t.classList?.contains("pl-open") || !t.checked) return;
      t.closest("[data-row]")?.querySelector<HTMLElement>(".pl-details input:not([type=hidden]), .pl-details select")?.focus({ preventScroll: true });
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, []);

  // Nach jedem Absenden setzt React das Formular zurück – aufgeklappte Details bleiben trotzdem offen.
  useEffect(() => {
    const form = document.getElementById(listId);
    if (!form) return;
    const onReset = () => {
      const open = [...form.querySelectorAll<HTMLInputElement>("input.pl-open:checked")].map((b) => b.id);
      setTimeout(() => open.forEach((id) => {
        const b = document.getElementById(id) as HTMLInputElement | null;
        if (b) b.checked = true;
      }), 0);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [listId]);

  const reset = () => {
    setQ("");
    setKat("");
    setStatus(STATUS_ALL);
    searchRef.current?.focus();
  };
  const filtered = !!(q || kat || status);

  return (
    <div className="list-controls">
      <div className="list-search">
        <input ref={searchRef} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="In dieser Verteilung suchen …" aria-label="In dieser Verteilung suchen" enterKeyHint="search" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
      </div>
      <select className="select" value={kat} onChange={(e) => setKat(e.target.value)} aria-label="Kategorie">
        <option value="">Alle Kategorien</option>
        {categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
      </select>
      <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Prüfstatus">
        <option value="">Jeder Prüfstatus</option>
        {statuses.map((s) => <option key={s.key} value={s.key} disabled={s.count === 0}>{s.label} ({s.count})</option>)}
      </select>
      <span className="small muted list-count" aria-live="polite">
        {filtered ? <>{shown} von {total} angezeigt{shown ? `, davon ${shownOpen} mit offenen Punkten` : ""} · <button type="button" className="btn-link small" onClick={reset}>Filter zurücksetzen</button></> : `${total} Produkte`}
      </span>
    </div>
  );
}

/**
 * Auswahl und Stapelaktionen: erscheint, sobald Zeilen angehakt sind. Die Knöpfe senden das Produktformular mit
 * (vorher werden alle Eingaben gespeichert).
 */
export function BulkBar({ formId, categories, ai, costs }: { formId: string; categories: string[]; ai: boolean; costs: Record<string, number> }) {
  const [count, setCount] = useState(0);
  const [stufe, setStufe] = useState("sparsam");
  const [stockSel, setStockSel] = useState("kartons");
  const [outcomeSel, setOutcomeSel] = useState("weg");
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const update = () => setCount(form.querySelectorAll<HTMLInputElement>("input[name=sel]:checked").length);
    form.addEventListener("change", update);
    update();
    const obs = new MutationObserver(update);
    obs.observe(form, { childList: true, subtree: true });
    return () => {
      form.removeEventListener("change", update);
      obs.disconnect();
    };
  }, [formId]);
  const selectVisible = (on: boolean) => {
    const form = document.getElementById(formId);
    form?.querySelectorAll<HTMLElement>("[data-row]").forEach((row) => {
      const box = row.querySelector<HTMLInputElement>("input[name=sel]");
      if (box && (!row.hidden || !on)) box.checked = on;
    });
    form?.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const confirmRun = (msg: string) => (e: React.MouseEvent) => {
    if (!confirm(msg)) e.preventDefault();
  };
  const cost = (costs[stufe] ?? 0) * count;

  return (
    <div className={`bulk-bar${count ? " active" : ""}`}>
      <div className="bulk-head">
        <button type="button" className="btn-link small" onClick={() => selectVisible(true)}>Alle sichtbaren auswählen</button>
        {count > 0 && <><strong>{count} ausgewählt</strong><button type="button" className="btn-link small" onClick={() => selectVisible(false)}>Auswahl aufheben</button></>}
      </div>
      {count > 0 && (
        <div className="bulk-actions">
          <span className="bulk-group">
            <select className="select select-compact" name="bulk_cat" defaultValue="" aria-label="Kategorie für die Auswahl">
              <option value="" disabled>Kategorie …</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-small" type="submit" name="op" value="bulk:cat">Zuordnen</button>
          </span>
          <span className="bulk-group">
            <span className="small muted">Collage</span>
            <button className="btn btn-small" type="submit" name="op" value="bulk:col-on">an</button>
            <button className="btn btn-small" type="submit" name="op" value="bulk:col-off">aus</button>
          </span>
          <span className="bulk-group">
            <span className="small muted">Aushang</span>
            <button className="btn btn-small" type="submit" name="op" value="bulk:fly-on">an</button>
            <button className="btn btn-small" type="submit" name="op" value="bulk:fly-off">aus</button>
          </span>
          <span className="bulk-group">
            <select className="select select-compact" value={stockSel} onChange={(e) => setStockSel(e.target.value)} aria-label="Bestand für die Auswahl">
              <option value="palette">Bestand: 1 Palette</option>
              <option value="halbe-palette">Bestand: ½ Palette</option>
              <option value="viertel-palette">Bestand: ¼ Palette</option>
              <option value="kartons">Bestand: mehrere Kartons</option>
              <option value="einzeln">Bestand: Einzelprodukt</option>
              <option value="reste">Bestand: wenige / Reste</option>
              <option value="leer">Bestand: leeren</option>
            </select>
            <button className="btn btn-small" type="submit" name="op" value={`bulk:stock-${stockSel}`}>Setzen</button>
          </span>
          <span className="bulk-group">
            <select className="select select-compact" value={outcomeSel} onChange={(e) => setOutcomeSel(e.target.value)} aria-label="Ergebnis für die Auswahl">
              <option value="weg">Ergebnis: alles weg</option>
              <option value="wenig">Ergebnis: wenig übrig</option>
              <option value="viel">Ergebnis: viel übrig</option>
              <option value="leer">Ergebnis: offen</option>
            </select>
            <button className="btn btn-small" type="submit" name="op" value={`bulk:outcome-${outcomeSel}`}>Setzen</button>
          </span>
          <span className="bulk-group">
            <span className="small muted">MHD</span>
            <button className="btn btn-small" type="submit" name="op" value="bulk:mhd-nein" title="Kein MHD nötig, z. B. Spielzeug, Haushaltswaren">nicht nötig</button>
            <button className="btn btn-small" type="submit" name="op" value="bulk:mhd-auto" title="Nach Kategorie entscheiden">automatisch</button>
          </span>
          <span className="bulk-group">
            <span className="small muted">Bestätigen</span>
            <button className="btn btn-small" type="submit" name="op" value="bulk:confirm" title="Preise und KI-Angaben der Auswahl als geprüft markieren" onClick={confirmRun(`Preise und KI-Angaben von ${count} Produkt(en) als geprüft markieren?\n\nAbgabeeinheit und Kategorie bleiben getrennt zu bestätigen.`)}>Preise</button>
            <button className="btn btn-small" type="submit" name="op" value="bulk:unit-ok" title="Abgabeeinheit so übernehmen, wie sie eingetragen ist" onClick={confirmRun(`Abgabeeinheit von ${count} Produkt(en) so bestätigen, wie sie eingetragen ist?`)}>Einheit</button>
            <button className="btn btn-small" type="submit" name="op" value="bulk:cat-ok" title="Kategorie stimmt so – keine Auffälligkeit mehr anzeigen">Kategorie</button>
          </span>
          {ai && (
            <span className="bulk-group">
              <select className="select select-compact" name="stufe" value={stufe} onChange={(e) => setStufe(e.target.value)} aria-label="KI-Stufe">
                <option value="erkennen">KI: nur Namen erkennen</option>
                <option value="minimal">KI: Preis minimal</option>
                <option value="sparsam">KI: Preis sparsam</option>
                <option value="genau">KI: Preis genau</option>
              </select>
              <button
                className="btn btn-small"
                type="submit"
                name="op"
                value="bulk:ai"
                onClick={confirmRun(`KI-Suche für ${count} Produkt(e) starten?\n\nUmfang: ${stufe === "erkennen" ? "nur Namen erkennen" : `Namen erkennen und Preise suchen (${stufe})`}.\nProdukte mit Ergebnis aus den letzten 60 Tagen werden übersprungen.\nGeschätzte Kosten: höchstens ca. ${cost.toFixed(2).replace(".", ",")} $.\n\nEingetragene Preise werden nicht verändert – Vorschläge erscheinen unter „Prüfen“.`)}
              >
                KI starten (~{cost.toFixed(2).replace(".", ",")} $)
              </button>
            </span>
          )}
          {count === 2 && (
            <button className="btn btn-small" type="submit" name="op" value="bulk:rueckseite" title="Die beiden sind dasselbe Produkt: das obere bleibt, das untere wird Rückseite/Infofoto" onClick={confirmRun("Die zwei ausgewählten zu einem Produkt zusammenführen?\n\nDas obere in der Liste bleibt (Vorderseite), das untere wird nur noch Infofoto (Rückseite) und erscheint nicht mehr als eigenes Produkt.")}>Zu einem Produkt (Rückseite)</button>
          )}
          <button className="btn btn-small btn-danger-link" type="submit" name="op" value="bulk:remove" onClick={confirmRun(`${count} Produkt(e) aus dieser Verteilung entfernen? Sie bleiben in der Produktdatenbank.`)}>Entfernen</button>
        </div>
      )}
    </div>
  );
}

/** „Produkte hinzufügen“ – drei Wege, nur bei Bedarf aufgeklappt. */
export function AddPanel({ initial, photos, database, manual }: { initial: string; photos: React.ReactNode; database: React.ReactNode; manual: React.ReactNode }) {
  const [tab, setTab] = useState(initial);
  const tabs = [
    { key: "fotos", label: "📷 Fotos hochladen" },
    { key: "datenbank", label: "Aus der Datenbank" },
    { key: "manuell", label: "Manuell anlegen" },
  ];
  return (
    <div className="add-panel">
      <div className="add-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`btn${tab === t.key ? " btn-primary" : ""}`} onClick={() => setTab(tab === t.key ? "" : t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "fotos" && <div className="add-body">{photos}</div>}
      {tab === "datenbank" && <div className="add-body">{database}</div>}
      {tab === "manuell" && <div className="add-body">{manual}</div>}
    </div>
  );
}
