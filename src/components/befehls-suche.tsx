"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Favorite } from "@/db/schema";
import type { NavSection } from "@/lib/nav";

type Eintrag = { art: "seite" | "favorit" | "aufgabe" | "produkt" | "mail"; titel: string; zusatz?: string; link: string };
const ART: Record<Eintrag["art"], string> = { favorit: "★ Favorit", seite: "Seite", aufgabe: "Aufgabe", produkt: "Produkt", mail: "Mail" };

const passt = (text: string, q: string) => {
  const t = text.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w));
};

/**
 * ⌘K / Strg+K: Seiten (aus der Seitenleiste, nur was man sehen darf) sofort, dazu Aufgaben, Produkte und Mails vom
 * Server. Pfeiltasten + Enter, Esc schließt. „Alle Treffer“ führt zur Seite „Suche“.
 */
export function BefehlsSuche({ sections, favorites, serverSuche }: { sections: NavSection[]; favorites: Favorite[]; serverSuche: boolean }) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [q, setQ] = useState("");
  const [server, setServer] = useState<Eintrag[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOffen((o) => !o);
      } else if (e.key === "Escape") setOffen(false);
    };
    const knopf = () => setOffen(true);
    window.addEventListener("keydown", taste);
    window.addEventListener("befehls-suche", knopf);
    return () => {
      window.removeEventListener("keydown", taste);
      window.removeEventListener("befehls-suche", knopf);
    };
  }, []);
  useEffect(() => {
    if (offen) setTimeout(() => input.current?.focus(), 0);
    else {
      setQ("");
      setServer([]);
    }
  }, [offen]);
  useEffect(() => {
    if (!offen || !serverSuche || q.trim().length < 2) {
      setServer([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/suche?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { treffer: [] }))
        .then((d: { treffer: Eintrag[] }) => setServer(d.treffer ?? []))
        .catch(() => null);
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, offen, serverSuche]);

  const seiten = useMemo<Eintrag[]>(() => {
    const alle: Eintrag[] = [
      ...favorites.map((f) => ({ art: "favorit" as const, titel: f.label, link: f.href })),
      ...sections.flatMap((s) => s.items.filter((it) => !it.href.includes("#")).map((it) => ({ art: "seite" as const, titel: it.label, zusatz: s.label, link: it.href }))),
    ];
    const t = q.trim();
    return (t ? alle.filter((e) => passt(`${e.titel} ${e.zusatz ?? ""}`, t)) : alle.filter((e) => e.art === "favorit")).slice(0, 12);
  }, [sections, favorites, q]);
  const liste = [...seiten, ...server];
  const gehe = (e: Eintrag | undefined) => {
    if (!e) return;
    setOffen(false);
    router.push(e.link);
  };

  if (!offen) return null;
  return (
    <div className="bs-hinter" onClick={() => setOffen(false)} data-testid="befehls-suche">
      <div className="bs-box" role="dialog" aria-modal="true" aria-label="Suche" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="input bs-input"
          placeholder="Seiten, Aufgaben, Produkte, Mails suchen …"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(liste.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (liste[sel]) gehe(liste[sel]);
              else if (q.trim()) gehe({ art: "seite", titel: "Suche", link: `/suche?q=${encodeURIComponent(q.trim())}` });
            }
          }}
          aria-label="Suchbegriff"
          data-testid="bs-eingabe"
        />
        <ul className="bs-liste" role="listbox" aria-label="Treffer">
          {liste.map((e, i) => (
            <li key={`${e.art}:${e.link}:${i}`} role="option" aria-selected={i === sel}>
              <button type="button" className={`bs-treffer${i === sel ? " aktiv" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => gehe(e)} data-testid="bs-treffer">
                <span className="bs-art">{ART[e.art]}</span>
                <span className="bs-titel">{e.titel}</span>
                {e.zusatz && <span className="bs-zusatz">{e.zusatz}</span>}
              </button>
            </li>
          ))}
          {!liste.length && <li className="bs-leer small muted">{q.trim() ? "Keine Seite gefunden – Enter sucht überall." : "Tippen zum Suchen. Ohne Favoriten erscheinen hier deine Treffer."}</li>}
        </ul>
        {q.trim() && (
          <div className="bs-fuss small">
            <button type="button" className="btn-link" onClick={() => gehe({ art: "seite", titel: "Suche", link: `/suche?q=${encodeURIComponent(q.trim())}` })}>Alle Treffer zu „{q.trim()}“ →</button>
            <span className="muted">↑↓ wählen · Enter öffnen · Esc schließen</span>
          </div>
        )}
      </div>
    </div>
  );
}
