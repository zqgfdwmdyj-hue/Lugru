import { privateSettings, requirePrivate } from "@/lib/private/service";
import { addSleepAction } from "../actions";
import { FairPage } from "../fair";
import { monthParam } from "../ui";

export default async function AusschlafenPage({ searchParams }: { searchParams: Promise<{ monat?: string; bearbeiten?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const month = monthParam(sp.monat);
  const s = await privateSettings(session.tenantId);
  return (
    <FairPage
      session={session}
      month={month}
      editId={sp.bearbeiten}
      cfg={{
        kind: "ausschlafen",
        tab: "ausschlafen",
        path: "/privat/ausschlafen",
        title: "Ausschlafen",
        heading: "Wer hat wie lange ausgeschlafen",
        who: "Wer hat ausgeschlafen?",
        nextText: (n) => `😴 Im Wechsel wäre als Nächstes ${n} dran`,
        unit: "länger geschlafen",
        shareText: "der erfassten Ausschlaf-Stunden",
        fromLabel: "sonst auf um",
        fromDefault: s.wakeTime,
        toLabel: "aufgestanden um",
        notePlaceholder: "z. B. nach schlechter Nacht",
        hint: "„Sonst auf um“ ist eure übliche Aufstehzeit (in den Einstellungen änderbar) – gezählt wird die Zeit bis „aufgestanden um“.",
        test: "sleep",
        action: addSleepAction,
      }}
    />
  );
}
