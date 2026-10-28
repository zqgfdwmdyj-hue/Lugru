// Aufträge nach Name, Bestellnummer, Ort/PLZ oder Artikel finden – reine Logik, testbar. Namen und Anschriften
// sind verschlüsselt gespeichert; gesucht wird deshalb in den entschlüsselten Feldern, nicht per SQL.

// Umlaute gleich behandeln, egal wie geschrieben: „Müller“, „Muller“ und „Mueller“ werden zu „muller“.
const norm = (s: string) => s.toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/([aou])e/g, "$1").replace(/\s+/g, " ").trim();

export type OrderHaystack = { externalId: string; name1?: string | null; name2?: string | null; buyerName?: string | null; street?: string | null; zip?: string | null; city?: string | null; items?: string | null };

/** Alle Suchwörter müssen irgendwo vorkommen („max muster“ findet „Max Mustermann“). */
export function orderMatches(o: OrderHaystack, q: string): boolean {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return false;
  const hay = norm([o.externalId, o.name1, o.name2, o.buyerName, o.street, o.zip, o.city, o.items].filter(Boolean).join(" | "));
  return words.every((w) => hay.includes(w));
}
