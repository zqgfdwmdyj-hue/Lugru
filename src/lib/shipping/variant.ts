// Variante aus dem Artikelnamen („…, Farbe:Weiß, Größe:L = 42-46“) – damit M und L nicht gleich aussehen, wenn
// lange Namen gekürzt werden. Reine Logik, testbar.

const PART = /\b(Größe|Groesse|Size|Farbe|Color|Colour|Variante)\s*:\s*([^,;|]+)/gi;

export type VariantTitle = { base: string; variant: string | null };

export function splitVariant(title: string): VariantTitle {
  const parts: string[] = [];
  const order = (k: string) => (/^(größe|groesse|size)$/i.test(k) ? 0 : /^(farbe|colou?r)$/i.test(k) ? 1 : 2);
  const found: { key: string; value: string }[] = [];
  for (const m of title.matchAll(PART)) found.push({ key: m[1], value: m[2].trim() });
  found.sort((a, b) => order(a.key) - order(b.key));
  for (const f of found) parts.push(/^(größe|groesse|size)$/i.test(f.key) ? `Größe ${f.value}` : f.value);
  const base = title.replace(PART, "").replace(/\s*,\s*(,\s*)*/g, ", ").replace(/[\s,]+$/, "").trim();
  return { base: base || title, variant: parts.length ? parts.join(" · ") : null };
}
