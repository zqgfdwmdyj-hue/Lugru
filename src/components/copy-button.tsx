"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Kopieren" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={async () => {
        const ok = await navigator.clipboard?.writeText(text).then(() => true, () => false);
        if (!ok) {
          // Ohne https gibt es navigator.clipboard nicht.
          const t = document.createElement("textarea");
          t.value = text;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          t.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Kopiert ✓" : label}
    </button>
  );
}
