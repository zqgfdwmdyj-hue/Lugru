/** Sofort sichtbar beim Seitenwechsel, während der Server die Seite rechnet (Seitenleiste bleibt bedienbar). */
export default function Loading() {
  return (
    <div className="skel-page" aria-busy="true" aria-live="polite" data-testid="page-loading">
      <span className="sr-only">Lädt …</span>
      <div className="skel skel-title" />
      <div className="skel-row">
        <div className="skel skel-card" />
        <div className="skel skel-card" />
        <div className="skel skel-card" />
      </div>
      <div className="skel skel-block" />
    </div>
  );
}
