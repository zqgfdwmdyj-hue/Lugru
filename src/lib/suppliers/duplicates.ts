// Mögliche doppelte Shops/Lieferanten (Kürzel aus den SKUs, z. B. „AMA“ und „AMAZO“): nur zur Prüfung
// vorschlagen – zusammengeführt wird ausschließlich von Hand.

export type SupplierLite = { id: string; code: string; name: string | null };
export type SupplierPair = { a: SupplierLite; b: SupplierLite; reason: string };

const normName = (s: string | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\b(gmbh|ag|kg|ug|ohg|se|inc|ltd|llc|co|e\.?k\.?|haftungsbeschränkt|&)\b/g, " ")
    .replace(/[^a-z0-9äöüß]/g, "");
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Paare, die vermutlich derselbe Shop sind – mit Begründung. Jedes Paar nur einmal. */
export function similarSuppliers(list: SupplierLite[]): SupplierPair[] {
  const out: SupplierPair[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      const ca = normCode(a.code);
      const cb = normCode(b.code);
      const na = normName(a.name);
      const nb = normName(b.name);
      let reason: string | null = null;
      if (na && na === nb) reason = `gleicher Name „${a.name}“`;
      else if (ca === cb) reason = "gleiches Kürzel (andere Schreibweise)";
      else if (Math.min(ca.length, cb.length) >= 3 && (ca.startsWith(cb) || cb.startsWith(ca)) && !/\d/.test(ca + cb)) reason = "ein Kürzel ist der Anfang des anderen";
      else if (Math.min(ca.length, cb.length) >= 4 && distance(ca, cb) === 1 && !/\d/.test(ca + cb)) reason = "Kürzel unterscheiden sich in einem Zeichen";
      if (reason) out.push({ a, b, reason });
    }
  }
  return out;
}
