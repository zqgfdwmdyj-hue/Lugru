import { TestBanner } from "@/components/test-banner";

/** Öffentliche Kunden-Links: in der Testumgebung mit Hinweis, sonst unverändert. */
export default function SendungLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TestBanner />
      {children}
    </>
  );
}
