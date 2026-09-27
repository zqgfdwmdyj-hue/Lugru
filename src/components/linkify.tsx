import { Fragment } from "react";

const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/g;

/** Text mit anklickbaren Links; lange Adressen werden kurz angezeigt (Domain). */
export function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>;
        let label = p;
        try {
          const u = new URL(p);
          const host = u.hostname.replace(/^www\./, "");
          label = host === "news.google.com" ? "Artikel öffnen ↗" : p.length > 70 ? `${host}${u.pathname.slice(0, 40)}… ↗` : `${p} ↗`;
        } catch {
          // ungültige Adresse: als Text zeigen
        }
        return (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        );
      })}
    </>
  );
}
