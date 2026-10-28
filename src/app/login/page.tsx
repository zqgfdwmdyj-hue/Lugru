import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/next-path";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ weiter?: string }> }) {
  const next = safeNext((await searchParams).weiter);
  if (await getSession()) redirect(next ?? "/");
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card card-pad" style={{ width: 380, padding: 28 }}>
        <div className="brand" style={{ padding: "0 0 18px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/icons/mark.svg" alt="" width={28} height={28} />
          Seller-System
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 18 }}>Anmelden</h1>
        {next && <div className="notice notice-info" style={{ marginBottom: 12 }}>Anmelden, um Claude den Zugriff auf das Seller-System zu erlauben.</div>}
        <LoginForm next={next} />
      </div>
    </main>
  );
}
