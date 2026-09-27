export interface TabItem {
  id: string;
  label: string;
  /** Zeigt einen Punkt am Beschriftungstext — für Reiter mit offenen Punkten. */
  flag?: boolean;
}

export function Tabs({ tabs, active, onChange }: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === active}
          id={`tab-${t.id}`}
          aria-controls={`panel-${t.id}`}
          className={'tab' + (t.id === active ? ' active' : '')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.flag && <span className="tab-dot" title="Hier fehlt noch etwas" />}
        </button>
      ))}
    </div>
  );
}
