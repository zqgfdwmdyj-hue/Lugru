// Anmeldung per „Link einfügen“: Rückkehradresse zerlegen (ohne Server-Abhängigkeiten).

/** Liest code und state aus der eingefügten Adresse (oder nur dem Code). */
export function parsePastedRedirect(input: string): { code: string | null; state: string | null; error: string | null } {
  const s = input.trim();
  try {
    const u = new URL(s);
    const p = new URLSearchParams(u.search || u.hash.replace(/^#/, "?"));
    return { code: p.get("code"), state: p.get("state"), error: p.get("error_description") ?? p.get("error") };
  } catch {
    return { code: s || null, state: null, error: null };
  }
}
