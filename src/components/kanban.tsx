"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

export type KanbanCard = { id: string; content: ReactNode };
export type KanbanColumn = { key: string; title: string; hint?: string; cards: KanbanCard[]; top?: ReactNode; more?: number };

/**
 * Board wie bei Trello: Karten per Ziehen in eine andere Spalte legen. Auf dem Handy (kein
 * Ziehen) über die Auswahl „verschieben nach …“ an jeder Karte.
 */
export function Kanban({ columns, move, testid }: { columns: KanbanColumn[]; move: (id: string, to: string) => Promise<void>; testid?: string }) {
  const router = useRouter();
  const [cols, setCols] = useState(columns);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => setCols(columns), [columns]);

  const doMove = (id: string, to: string) => {
    let from: string | null = null;
    setCols((prev) => {
      const card = prev.flatMap((c) => c.cards).find((c) => c.id === id);
      from = prev.find((c) => c.cards.some((x) => x.id === id))?.key ?? null;
      if (!card || from === to) return prev;
      return prev.map((c) => (c.key === to ? { ...c, cards: [card, ...c.cards] } : { ...c, cards: c.cards.filter((x) => x.id !== id) }));
    });
    start(async () => {
      await move(id, to);
      router.refresh();
    });
  };

  return (
    <div className="kanban" data-testid={testid}>
      {cols.map((c) => (
        <section
          key={c.key}
          className={`kanban-col${over === c.key ? " over" : ""}`}
          data-col={c.key}
          onDragOver={(e) => {
            e.preventDefault();
            if (over !== c.key) setOver(c.key);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain") || dragId;
            setOver(null);
            setDragId(null);
            if (id) doMove(id, c.key);
          }}
        >
          <header>
            <strong>{c.title}</strong>
            <span className="count">{c.cards.length + (c.more ?? 0)}</span>
          </header>
          {c.hint && <div className="kanban-empty" style={{ padding: "0 4px" }}>{c.hint}</div>}
          {c.top}
          {c.cards.length === 0 && <div className="kanban-empty">Hierher ziehen</div>}
          {c.cards.map((card) => (
            <article
              key={card.id}
              className={`kanban-card${dragId === card.id ? " dragging" : ""}`}
              draggable
              data-card={card.id}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", card.id);
                e.dataTransfer.effectAllowed = "move";
                setDragId(card.id);
              }}
              onDragEnd={() => setDragId(null)}
            >
              {card.content}
              <select aria-label="Verschieben nach" value={c.key} onChange={(e) => doMove(card.id, e.target.value)}>
                {cols.map((o) => <option key={o.key} value={o.key}>{o.key === c.key ? `↔ ${o.title}` : `→ ${o.title}`}</option>)}
              </select>
            </article>
          ))}
          {c.more ? <div className="kanban-empty">+{c.more} weitere</div> : null}
        </section>
      ))}
    </div>
  );
}
