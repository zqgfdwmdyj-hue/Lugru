/** Kostenlos selbst nachschauen: Preisvergleich mit dem Produktnamen öffnen (keine KI, keine Kosten). */
export function PriceLinks({ name, variant, small = true }: { name: string; variant?: string | null; small?: boolean }) {
  const q = encodeURIComponent([name, variant].filter(Boolean).join(" "));
  return (
    <span className={small ? "small" : ""} style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
      <a href={`https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${q}`} target="_blank" rel="noreferrer" title="Preisvergleich bei idealo öffnen – kostenlos">idealo</a>
      <a href={`https://www.google.com/search?tbm=shop&q=${q}`} target="_blank" rel="noreferrer" title="Google Shopping öffnen – kostenlos">Google</a>
    </span>
  );
}
