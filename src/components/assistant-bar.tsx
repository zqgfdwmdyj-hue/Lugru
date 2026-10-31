"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// Fragefeld oben auf jeder Seite: Frage eintippen → Claude antwortet mit den Daten aus dem Seller-System.
// Änderungen kommen als Rückfrage („Ausführen“ / „Ablehnen“) und werden erst nach Bestätigung gemacht.

type Msg = { role: "user" | "assistant"; text: string };
type Vorschau = { anzahl: number; beispiele: string[]; ausgeschlossen?: { anzahl: number; grund: string; beispiele: string[] } };
type Call = { title: string; summary: string; stufe?: "gruen" | "gelb" | "rot"; vorschau?: Vorschau | null };
type Confirm = Call[] | null;
type Ev = { type: "chat"; id: string } | { type: "status"; text: string } | { type: "confirm"; calls: Call[]; grosseMenge?: boolean } | { type: "text"; text: string } | { type: "error"; message: string } | { type: "done" };
const GROSSE_MENGE = 200;

/** Andere Seiten öffnen das Fragefeld mit einem Auftrag: window.dispatchEvent(new CustomEvent("asst:auftrag", { detail: "…" })). */
export const ASST_AUFTRAG = "asst:auftrag";

const KEY = "assistent-chat";
const store = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: (v: string | null) => {
    try {
      if (v) sessionStorage.setItem(KEY, v);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* privates Fenster o. Ä. */
    }
  },
};

// ---- kleine Markdown-Darstellung (Absätze, Listen, fett, Code, Links) – ohne HTML aus der Antwort -------

function inline(text: string, onInternal: () => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/[^\s)]+|\/[^\s)]*)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={i++}>{tok.slice(1, -1)}</code>);
    else {
      const lm = /^\[([^\]]+)\]\((.+)\)$/.exec(tok)!;
      const href = lm[2];
      const internal = href.startsWith("/") || (typeof window !== "undefined" && href.startsWith(window.location.origin));
      const path = internal && !href.startsWith("/") ? href.slice(window.location.origin.length) || "/" : href;
      out.push(
        internal ? (
          <Link key={i++} href={path} onClick={onInternal}>{lm[1]}</Link>
        ) : (
          <a key={i++} href={href} target="_blank" rel="noreferrer noopener">{lm[1]}</a>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, onInternal = () => {} }: { text: string; onInternal?: () => void }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{para.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, onInternal)}</Fragment>)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, j) => <li key={j}>{inline(it, onInternal)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*•])\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    if (bullet || num) {
      flushPara();
      const ordered = Boolean(num);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
    } else if (head) {
      flushPara();
      flushList();
      blocks.push(<p key={blocks.length}><strong>{inline(head[1], onInternal)}</strong></p>);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <>{blocks}</>;
}

export function AssistantBar({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [grosseMenge, setGrosseMenge] = useState(false);
  const [mengeOk, setMengeOk] = useState(false);
  const [einzeln, setEinzeln] = useState<number[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [barQ, setBarQ] = useState("");
  const [history, setHistory] = useState<{ id: string; title: string | null; updatedAt: string }[] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Laufendes Gespräch nach dem Neuladen der Seite wiederherstellen (nur dieser Tab).
  const load = useCallback(async (id: string) => {
    const r = await fetch(`/api/assistent?chat=${id}`);
    if (!r.ok) {
      store.set(null);
      return;
    }
    const j = (await r.json()) as { id: string; messages: Msg[]; confirm: Confirm; grosseMenge?: boolean };
    setChatId(j.id);
    setMsgs(j.messages);
    setConfirm(j.confirm);
    setGrosseMenge(Boolean(j.grosseMenge));
    store.set(j.id);
  }, []);
  useEffect(() => {
    const id = store.get();
    if (id) void load(id);
  }, [load]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, status, confirm, err]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(body: { text?: string; confirm?: boolean; einzeln?: number[]; grosseMenge?: boolean }) {
    setBusy(true);
    setErr(null);
    setConfirm(null);
    setEinzeln([]);
    setMengeOk(false);
    setGrosseMenge(false);
    setStatus("Denke nach …");
    if (body.text) setMsgs((m) => [...m, { role: "user", text: body.text! }]);
    try {
      const res = await fetch("/api/assistent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, ...body }) });
      if (!res.ok || !res.body) throw new Error(res.status === 401 ? "Bitte neu anmelden." : `Fehler ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as Ev;
          if (ev.type === "chat") {
            setChatId(ev.id);
            store.set(ev.id);
          } else if (ev.type === "status") setStatus(ev.text);
          else if (ev.type === "text") setMsgs((m) => [...m, { role: "assistant", text: ev.text }]);
          else if (ev.type === "confirm") {
            setConfirm(ev.calls);
            setGrosseMenge(Boolean(ev.grosseMenge));
          }
          else if (ev.type === "error") setErr(ev.message);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Verbindung unterbrochen – bitte noch einmal.");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  function askText(raw: string, clear: () => void) {
    const text = raw.trim();
    if (!text || busy) return;
    clear();
    setOpen(true);
    void send({ text });
  }
  const ask = (e?: React.FormEvent) => {
    e?.preventDefault();
    askText(q, () => setQ(""));
  };
  const askFromBar = (e: React.FormEvent) => {
    e.preventDefault();
    askText(barQ, () => setBarQ(""));
  };

  function reset() {
    setChatId(null);
    setMsgs([]);
    setConfirm(null);
    setErr(null);
    setHistory(null);
    store.set(null);
    inputRef.current?.focus();
  }

  async function showHistory() {
    const r = await fetch("/api/assistent");
    if (r.ok) setHistory(((await r.json()) as { chats: { id: string; title: string | null; updatedAt: string }[] }).chats);
  }

  const closeOnPhone = () => {
    if (window.matchMedia("(max-width: 760px)").matches) setOpen(false);
  };

  // „Auftrag an Claude“ aus einer Liste: neues Gespräch mit diesem Auftrag (Vorschau → Bestätigen wie immer).
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const on = (e: Event) => {
      const text = String((e as CustomEvent<string>).detail ?? "").trim().slice(0, 4000);
      if (!text) return;
      setChatId(null);
      setMsgs([]);
      setHistory(null);
      store.set(null);
      setOpen(true);
      void sendRef.current({ text });
    };
    window.addEventListener(ASST_AUFTRAG, on);
    return () => window.removeEventListener(ASST_AUFTRAG, on);
  }, []);

  return (
    <>
      <form className="asst-bar" onSubmit={askFromBar} role="search" data-testid="asst-bar">
        <span aria-hidden="true">✨</span>
        <label className="sr-only" htmlFor="asst-q">Frage an das Seller-System</label>
        <input
          id="asst-q"
          className="asst-bar-input"
          value={barQ}
          onChange={(e) => setBarQ(e.target.value)}
          onFocus={() => msgs.length > 0 && setOpen(true)}
          placeholder="Frag das Seller-System …"
          autoComplete="off"
          data-testid="asst-input"
        />
        <button className="btn btn-small btn-primary" type="submit" disabled={busy} data-testid="asst-send">Fragen</button>
        {msgs.length > 0 && !open && <button className="btn btn-small" type="button" onClick={() => setOpen(true)}>Gespräch</button>}
      </form>

      {open && (
        <div className="asst-panel" role="dialog" aria-label="Assistent" data-testid="asst-panel">
          <div className="asst-head">
            <strong>✨ Assistent</strong>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-small" type="button" onClick={showHistory}>Verlauf</button>
              <Link className="btn btn-small" href="/assistent-verlauf" onClick={closeOnPhone} data-testid="asst-protokoll">Änderungen</Link>
              <button className="btn btn-small" type="button" onClick={reset} data-testid="asst-new">Neu</button>
              <button className="btn btn-small" type="button" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
            </span>
          </div>
          <div className="asst-body">
            {history && (
              <div className="asst-history">
                <div className="small muted">Letzte Gespräche</div>
                {history.length === 0 && <div className="small">Noch keine.</div>}
                {history.map((h) => (
                  <button key={h.id} type="button" className="btn-link small" onClick={() => { setHistory(null); void load(h.id); }}>
                    {h.title || "Gespräch"} · {new Date(h.updatedAt).toLocaleDateString("de-DE")}
                  </button>
                ))}
              </div>
            )}
            {msgs.length === 0 && !busy && (
              <div className="small muted">
                Hallo {name}! Frag einfach, z. B. „Welche Paletten kommen diese Woche?“, „Wie viele haben wir noch von SKU …?“, „Was ist heute fällig?“ oder „Leg mir eine Aufgabe für Freitag an“.
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`asst-msg asst-${m.role}`} data-testid={`asst-msg-${m.role}`}>
                {m.role === "assistant" ? <Markdown text={m.text} onInternal={closeOnPhone} /> : m.text}
              </div>
            ))}
            {status && <div className="asst-status small muted" data-testid="asst-status"><span className="asst-dot" />{status}</div>}
            {confirm && (
              <div className="asst-confirm" data-testid="asst-confirm">
                <div><strong>Soll ich das ändern?</strong></div>
                <ul>
                  {confirm.map((c, i) => (
                    <li key={i} data-testid="asst-confirm-call" data-stufe={c.stufe ?? "gruen"}>
                      {c.stufe === "gelb" && <span className="tag tag-warn" style={{ marginRight: 4 }}>einzeln bestätigen</span>}
                      {c.title}{c.summary ? `: ${c.summary}` : ""}
                      {c.vorschau && (
                        <div className="small" data-testid="asst-vorschau">
                          <strong>{c.vorschau.anzahl}</strong> {c.vorschau.anzahl === 1 ? "Datensatz" : "Datensätze"}
                          {c.vorschau.beispiele.length > 0 && <>: {c.vorschau.beispiele.slice(0, 5).join(" · ")}{c.vorschau.anzahl > 5 ? " …" : ""}</>}
                          {c.vorschau.ausgeschlossen && c.vorschau.ausgeschlossen.anzahl > 0 && (
                            <div className="muted" data-testid="asst-vorschau-aus">
                              {c.vorschau.ausgeschlossen.anzahl} nicht: {c.vorschau.ausgeschlossen.grund}{c.vorschau.ausgeschlossen.beispiele.length ? ` (${c.vorschau.ausgeschlossen.beispiele.slice(0, 3).join(", ")})` : ""}
                            </div>
                          )}
                        </div>
                      )}
                      {c.stufe === "gelb" && (
                        <label className="small" style={{ display: "flex", gap: 6, marginTop: 2 }}>
                          <input type="checkbox" checked={einzeln.includes(i)} onChange={(e) => setEinzeln((x) => (e.target.checked ? [...x, i] : x.filter((y) => y !== i)))} data-testid="asst-einzeln" /> Ja, genau das ausführen (wirkt nach außen)
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
                {grosseMenge && (
                  <label className="small" style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input type="checkbox" checked={mengeOk} onChange={(e) => setMengeOk(e.target.checked)} data-testid="asst-menge" /> Mehr als {GROSSE_MENGE} Datensätze – trotzdem ausführen
                  </label>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-small btn-primary" type="button" disabled={busy || (grosseMenge && !mengeOk)} onClick={() => void send({ confirm: true, einzeln, grosseMenge: mengeOk })} data-testid="asst-approve">Ausführen</button>
                  <button className="btn btn-small" type="button" disabled={busy} onClick={() => void send({ confirm: false })} data-testid="asst-deny">Ablehnen</button>
                </div>
              </div>
            )}
            {err && <div className="notice notice-warn" data-testid="asst-error">{err}</div>}
            <div ref={endRef} />
          </div>
          <form className="asst-foot" onSubmit={ask}>
            <label className="sr-only" htmlFor="asst-q2">Nachricht</label>
            <textarea
              id="asst-q2"
              ref={inputRef}
              className="input"
              rows={2}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask();
                }
              }}
              placeholder={confirm ? "Oder stattdessen etwas anderes schreiben …" : "Nachfragen …"}
              data-testid="asst-input2"
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !q.trim()}>Senden</button>
          </form>
        </div>
      )}
    </>
  );
}
