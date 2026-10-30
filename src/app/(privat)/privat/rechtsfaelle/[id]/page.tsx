import { notFound } from "next/navigation";
import { requirePrivate } from "@/lib/private/service";
import { fallMitVerlauf } from "@/lib/recht/service";
import { getSettings } from "@/lib/settings";
import { FallDetail } from "@/app/(app)/rechtsfaelle/ansicht";
import { PrivatHead } from "../../ui";

export default async function PrivatRechtsfallPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requirePrivate({ full: true });
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const r = /^[0-9a-f-]{36}$/.test(id) ? await fallMitVerlauf(session.tenantId, id) : null;
  if (!r || r.fall.bereich !== "privat") notFound();
  const anwalt = (await getSettings(session.tenantId)).rechtsfaelle.anwaltAdresse || null;
  return (
    <>
      <PrivatHead active="rechtsfaelle" title={r.fall.titel} />
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      <FallDetail fall={r.fall} verlauf={r.verlauf} anwalt={anwalt} privat inhaber={session.role === "owner"} />
    </>
  );
}
