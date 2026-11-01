import { requireSession } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";

// Geschäftsbereich: gemeinsamer Rahmen (Seitenleiste links, Suche/Glocke/Benutzer oben, Tab-Leiste am Handy).

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <AppShell session={session} bereich="geschaeft">
      {children}
    </AppShell>
  );
}
