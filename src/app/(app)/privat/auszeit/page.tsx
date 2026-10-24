import { requirePrivate } from "@/lib/private/service";
import { addTimeoutAction } from "../actions";
import { FairPage } from "../fair";
import { monthParam } from "../ui";

export default async function AuszeitPage({ searchParams }: { searchParams: Promise<{ monat?: string; bearbeiten?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const month = monthParam(sp.monat);
  return (
    <FairPage
      session={session}
      month={month}
      editId={sp.bearbeiten}
      cfg={{
        kind: "auszeit",
        tab: "auszeit",
        path: "/privat/auszeit",
        title: "Auszeit",
        heading: "Zeit nur für sich",
        intro: "Sport, Freunde, Hobby, einfach mal raus – während der andere sich um Kinder und Haushalt kümmert.",
        who: "Wer hatte Auszeit?",
        nextText: (n) => `🌿 Im Wechsel wäre als Nächstes ${n} dran`,
        unit: "für sich",
        shareText: "der erfassten Auszeit-Stunden",
        fromLabel: "von",
        toLabel: "bis",
        notePlaceholder: "z. B. Fußball, Freundinnen, Sauna",
        test: "timeout",
        action: addTimeoutAction,
      }}
    />
  );
}
