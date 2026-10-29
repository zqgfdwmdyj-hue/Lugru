import { requireSession } from "@/lib/auth/session";
import { createEntry } from "@/lib/knowledge/actions";
import { EntryForm } from "@/components/entry-form";

export default async function NeuerEintragPage({ searchParams }: { searchParams: Promise<{ art?: string }> }) {
  await requireSession();
  const { art } = await searchParams;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Wissen</div>
          <h1>{art === "anleitung" ? "Neue Anleitung" : "Neuer Eintrag"}</h1>
        </div>
      </div>
      <EntryForm action={createEntry} cancelHref="/wissen" alsAnleitung={art === "anleitung"} />
    </>
  );
}
