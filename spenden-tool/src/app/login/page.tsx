import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await isLoggedIn()) redirect("/");
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="card card-pad" style={{ width: 380, maxWidth: "100%", padding: 28 }}>
        <div className="brand" style={{ padding: "0 0 18px" }}>
          <span className="brand-mark">♥</span>
          Spenden-Tool
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 18 }}>Anmelden</h1>
        <LoginForm />
      </div>
    </main>
  );
}
