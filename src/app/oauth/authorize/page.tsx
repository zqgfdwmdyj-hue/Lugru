import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { scopeText, withParams } from "@/lib/assistant/oauth-logic";
import { checkAuthRequest } from "@/lib/assistant/oauth-service";
import { ConsentForm } from "./consent-form";

export const metadata = { title: "Claude verbinden", robots: { index: false, follow: false } };

const FIELDS = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource", "response_type"] as const;

/** Freigabe-Seite: Claude (claude.ai) möchte auf das Seller-System zugreifen. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p = Object.fromEntries(FIELDS.map((k) => [k, typeof sp[k] === "string" ? (sp[k] as string) : undefined]));
  const session = await getSession();
  if (!session) {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
    redirect(`/login?weiter=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }
  const check = await checkAuthRequest(p);
  if ("redirectError" in check) redirect(withParams(check.redirectUri, { error: check.redirectError, error_description: check.description, state: check.state }));
  const box = (children: React.ReactNode) => (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card card-pad stack" style={{ width: 460, maxWidth: "100%", padding: 24, gap: 14 }}>{children}</div>
    </main>
  );
  if ("fatal" in check) return box(<><h1 style={{ fontSize: 20, margin: 0 }}>Claude verbinden</h1><div className="notice notice-error" data-testid="consent-fatal">{check.fatal}</div></>);
  const req = check.ok;
  const host = new URL(req.redirectUri).host;
  return box(
    <>
      <h1 style={{ fontSize: 20, margin: 0 }} data-testid="consent-title">Claude mit Seller-System verbinden</h1>
      <div className="small">
        <strong>{req.clientName || "Claude"}</strong> möchte im Namen von <strong>{session.name || session.email}</strong> ({session.tenantName}) auf das Seller-System zugreifen.
        <div className="muted">Zurück zu: {host} · gewünscht: {scopeText(req.scope.join(" "))}</div>
      </div>
      {session.role !== "owner" ? (
        <div className="notice notice-warn">Claude verbinden kann nur der Inhaber. Mitarbeiter nutzen das Fragefeld oben im Seller-System.</div>
      ) : (
        <div className="small muted">Claude sieht nur, was du im Seller-System auch siehst. Trennen kannst du die Verbindung jederzeit unter Einstellungen → Claude.</div>
      )}
      <ConsentForm
        hidden={Object.fromEntries(Object.entries({ ...p, redirect_uri: req.redirectUri }).filter(([, v]) => v)) as Record<string, string>}
        canPrivate={session.role === "owner" && session.privateAccess}
        needsPin={session.privatePin}
        wantsPrivate
      />
    </>,
  );
}
