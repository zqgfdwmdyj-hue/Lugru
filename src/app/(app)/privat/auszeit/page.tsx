import { todayIso } from "@/lib/dates";
import { requirePrivate } from "@/lib/private/service";
import { addTimeoutAction } from "../actions";
import { FairPage } from "../fair";

export default async function AuszeitPage({ searchParams }: { searchParams: Promise<{ monat?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const month = sp.monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.monat) ? sp.monat : todayIso().slice(0, 7);
  return (
    <FairPage
      session={session}
      month={month}
      cfg={{
        kind: "auszeit",
        tab: "auszeit",
        path: "/privat/auszeit",
        title: "Auszeit",
        heading: "Zeit nur für sich",
        intro: "Sport, Freunde, Hobby, einfach mal raus – während der andere sich um Kinder und Haushalt kümmert.",
        who: "Wer hatte Auszeit?",
        nextText: (n) => `🌿 Als Nächstes ist ${n} mit Auszeit dran`,
        unit: "für sich",
        shareText: "der Auszeit-Stunden",
        fromLabel: "von",
        toLabel: "bis",
        notePlaceholder: "z. B. Fußball, Freundinnen, Sauna",
        test: "timeout",
        action: addTimeoutAction,
      }}
    />
  );
}
