"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Verkleinert die Schrift so lange, bis alles auf eine A4-Seite passt. Auf schmalen Bildschirmen (Handy) wird die
 * ganze Seite zusätzlich zur Vorschau verkleinert – gedruckt wird immer in voller A4-Größe.
 */
export function FitSheet({ children, maxSize }: { children: React.ReactNode; maxSize: number }) {
  const frame = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = frame.current;
    if (!el || !box) return;
    const fit = () => {
      let size = maxSize;
      el.style.setProperty("--fs", `${size}px`);
      while (size > 7 && el.scrollHeight > el.clientHeight + 1) {
        size -= 0.5;
        el.style.setProperty("--fs", `${size}px`);
      }
    };
    // Vorschau aufs Handy-Display einpassen (transform ändert die Messung oben nicht).
    const scale = () => {
      const s = Math.min(1, (document.documentElement.clientWidth - 16) / el.offsetWidth);
      el.style.transform = s < 1 ? `scale(${s})` : "";
      el.style.transformOrigin = "top left";
      box.style.height = s < 1 ? `${el.offsetHeight * s + 16}px` : "";
      box.style.width = s < 1 ? `${el.offsetWidth * s}px` : "";
    };
    fit();
    scale();
    // Nach dem Laden der Schriften erneut messen.
    document.fonts?.ready.then(fit);
    window.addEventListener("resize", scale);
    return () => window.removeEventListener("resize", scale);
  }, [maxSize, children]);
  return (
    <div ref={frame} className="sheet-frame">
      <div ref={ref} className="sheet">{children}</div>
    </div>
  );
}
