import { requireSession } from "@/lib/auth/session";

export default async function KeinZugriff() {
  const session = await requireSession();
  return (
    <div className="card card-pad stack" style={{ maxWidth: 560 }}>
      <h1>Kein Bereich freigegeben</h1>
      <p className="muted" style={{ margin: 0 }}>
        Hallo {session.name ?? session.email} – für dein Konto ist noch kein Bereich freigegeben. Bitte den Inhaber, dir unter Einstellungen → Benutzer die passenden Bereiche freizuschalten.
      </p>
    </div>
  );
}
