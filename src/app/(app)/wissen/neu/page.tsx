import { requireSession } from "@/lib/auth/session";
import { createEntry } from "@/lib/knowledge/actions";
import { EntryForm } from "@/components/entry-form";

export default async function NeuerEintragPage() {
  await requireSession();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Wissen</div>
          <h1>Neuer Eintrag</h1>
        </div>
      </div>
      <EntryForm action={createEntry} cancelHref="/wissen" />
    </>
  );
}
