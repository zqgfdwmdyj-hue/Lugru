import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/session";
import { fallMitVerlauf } from "@/lib/recht/service";
import { getSettings } from "@/lib/settings";
import { FallDetail } from "../ansicht";

export default async function RechtsfallPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireOwner();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const r = /^[0-9a-f-]{36}$/.test(id) ? await fallMitVerlauf(session.tenantId, id) : null;
  // Private Fälle nur im Privatbereich.
  if (!r || r.fall.bereich !== "geschaeft") notFound();
  const anwalt = (await getSettings(session.tenantId)).rechtsfaelle.anwaltAdresse || null;
  return (
    <>
      <div className="page-head"><div><div className="crumb"><Link href="/rechtsfaelle">Rechtsfälle</Link></div><h1>{r.fall.titel}</h1></div></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      <FallDetail fall={r.fall} verlauf={r.verlauf} anwalt={anwalt} privat={false} inhaber />
    </>
  );
}
