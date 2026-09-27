import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { updateEntry } from "@/lib/knowledge/actions";
import { EntryForm } from "@/components/entry-form";

export default async function BearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const K = schema.knowledgeEntries;
  const [entry] = await db.select().from(K).where(and(eq(K.id, id), eq(K.tenantId, session.tenantId)));
  if (!entry) notFound();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Wissen › Bearbeiten</div>
          <h1>{entry.title}</h1>
        </div>
      </div>
      <EntryForm action={updateEntry} entry={entry} cancelHref={`/wissen/${entry.id}`} />
    </>
  );
}
