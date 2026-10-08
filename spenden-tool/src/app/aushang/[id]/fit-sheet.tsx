"use client";

import { useLayoutEffect, useRef } from "react";

/** Verkleinert die Schrift so lange, bis alles auf eine A4-Seite passt. */
export function FitSheet({ children, maxSize }: { children: React.ReactNode; maxSize: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = maxSize;
      el.style.setProperty("--fs", `${size}px`);
      while (size > 7 && el.scrollHeight > el.clientHeight + 1) {
        size -= 0.5;
        el.style.setProperty("--fs", `${size}px`);
      }
    };
    fit();
    // Nach dem Laden der Schriften erneut messen.
    document.fonts?.ready.then(fit);
  }, [maxSize, children]);
  return <div ref={ref} className="sheet">{children}</div>;
}
