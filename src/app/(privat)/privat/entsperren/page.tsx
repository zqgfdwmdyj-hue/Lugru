import { redirect } from "next/navigation";
import { requirePrivate } from "@/lib/private/service";
import { unlockAction } from "../actions";
import { StateForm } from "../state-form";

export default async function EntsperrenPage({ searchParams }: { searchParams: Promise<{ zurueck?: string }> }) {
  const session = await requirePrivate({ allowLocked: true });
  if (!session.privatePin || (session.privateUnlockedUntil?.getTime() ?? 0) > Date.now()) redirect("/privat");
  const sp = await searchParams;
  return (
    <div style={{ maxWidth: 360, margin: "40px auto" }} className="card card-pad stack">
      <div style={{ fontSize: 34, textAlign: "center" }}>🔒</div>
      <h1 style={{ textAlign: "center", fontSize: 22 }}>Privat ist gesperrt</h1>
      <p className="small muted" style={{ textAlign: "center", margin: 0 }}>PIN eingeben – danach bleibt der Bereich 30 Minuten offen.</p>
      <StateForm action={unlockAction} submit="Entsperren" testid="unlock">
        <input type="hidden" name="back" value={sp.zurueck ?? "/privat"} />
        <input className="input" name="pin" type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,8}" required autoFocus aria-label="PIN" style={{ fontSize: 24, textAlign: "center", letterSpacing: 6 }} />
      </StateForm>
    </div>
  );
}
