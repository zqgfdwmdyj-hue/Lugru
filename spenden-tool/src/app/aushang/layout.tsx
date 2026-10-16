import { requireLogin } from "@/lib/auth";

export default async function AushangLayout({ children }: { children: React.ReactNode }) {
  await requireLogin();
  return <div style={{ background: "#e9e7e1", minHeight: "100vh" }}>{children}</div>;
}
