import { headers } from "next/headers";
import { addressCheck } from "@/lib/public-url";

/** Adressen-Check: Stimmen APP_URL/PUBLIC_URL? Zeigt die Links, die das System damit baut. Bei Problemen aufgeklappt. */
export async function AddressCheck() {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  const r = addressCheck(process.env, host ? `${proto}://${host}` : null);
  const bad = r.findings.filter((f) => !f.ok).length;
  return (
    <details className="card card-pad" open={bad > 0} data-testid="address-check" data-problems={bad}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Adressen & Sicherheit {bad > 0 ? <span className="tag tag-danger">{bad} offen</span> : <span className="tag tag-ok">in Ordnung</span>}
      </summary>
      <ul className="small" style={{ margin: "10px 0 0", paddingLeft: 0, listStyle: "none", display: "grid", gap: 4 }}>
        {r.findings.map((f) => (
          <li key={f.text} data-ok={f.ok}>{f.ok ? "✔" : "✘"} {f.text}</li>
        ))}
      </ul>
      <div className="small muted" style={{ marginTop: 10 }}>So sehen Links aus, die das System baut:</div>
      <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 2 }} data-testid="address-links">
        {r.links.map((l) => (
          <li key={l.label}>{l.label}: <code style={{ wordBreak: "break-all" }}>{l.url}</code></li>
        ))}
      </ul>
      {bad > 0 && (
        <div className="small muted" style={{ marginTop: 10 }}>
          Beheben auf dem Server: <code style={{ wordBreak: "break-all" }}>sudo bash /opt/seller-system/deploy/absichern.sh</code> (prüft nur) – danach den angezeigten Befehl „anwenden https://…“.
        </div>
      )}
    </details>
  );
}
