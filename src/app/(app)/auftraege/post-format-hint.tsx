import Link from "next/link";

/**
 * Vor dem Kauf einer Warensendung: auf welchem Format das Label kommt. Das Format steht im PDF fest, sobald gekauft –
 * „Verwerfen“ erstattet das Porto nicht automatisch. Darum vorher deutlich zeigen und direkt zur Einstellung führen.
 */
export function PostFormatHint({ name, labelPrinter, compact = false }: { name: string; labelPrinter: boolean; compact?: boolean }) {
  if (labelPrinter)
    return (
      <div className="small muted" data-testid="post-format" data-label-printer="1">
        Warensendung druckt auf: <strong>{name}</strong> · <Link href="/einstellungen#warensendung">ändern</Link>
      </div>
    );
  return (
    <div className={`notice notice-warn small`} data-testid="post-format" data-label-printer="0" style={compact ? { padding: "6px 10px" } : undefined}>
      Warensendung druckt auf: <strong>{name}</strong>. Für den Etikettendrucker (z. B. Brother QL-800) <strong>vor dem Erstellen</strong> unter{" "}
      <Link href="/einstellungen#warensendung">Einstellungen → Warensendung</Link> das Brother-Format wählen – ein schon gekauftes Label behält sein Format.
    </div>
  );
}
