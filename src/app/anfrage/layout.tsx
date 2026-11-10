import { TestBanner } from "@/components/test-banner";

/** Öffentliche Anfrageseite (QR-Code im Brief): ohne Anmeldung, in der Testumgebung mit Hinweis. */
export default function AnfrageLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TestBanner />
      {children}
    </>
  );
}
