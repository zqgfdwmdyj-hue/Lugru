// Link ins eBay-Tool („Neues Angebot“) mit Vorbelegung: Suche (EAN oder Titel), EK je Einheit, VK, Quelle, Menge.

const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? undefined : n.toFixed(2).replace(".", ","));

export function ebayToolLink(p: { q: string; ek?: number | null; vk?: number | null; quelle?: string | null; menge?: number | null }): string {
  const q = new URLSearchParams({ q: p.q.trim().slice(0, 200) });
  const ek = num(p.ek);
  const vk = num(p.vk);
  if (ek) q.set("ek", ek);
  if (vk) q.set("vk", vk);
  if (p.quelle) q.set("quelle", p.quelle.slice(0, 120));
  if (p.menge && p.menge > 0) q.set("menge", String(Math.round(p.menge)));
  return `/ebay?${q}`;
}
