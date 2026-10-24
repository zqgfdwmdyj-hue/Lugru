import { todayIso } from "@/lib/dates";
import { privateSettings, requirePrivate } from "@/lib/private/service";
import { addSleepAction } from "../actions";
import { FairPage } from "../fair";

export default async function AusschlafenPage({ searchParams }: { searchParams: Promise<{ monat?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const month = sp.monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.monat) ? sp.monat : todayIso().slice(0, 7);
  const s = await privateSettings(session.tenantId);
  return (
    <FairPage
      session={session}
      month={month}
      cfg={{
        kind: "ausschlafen",
        tab: "ausschlafen",
        path: "/privat/ausschlafen",
        title: "Ausschlafen",
        heading: "Wer hat wie lange ausgeschlafen",
        who: "Wer hat ausgeschlafen?",
        nextText: (n) => `😴 Als Nächstes darf ${n} ausschlafen`,
        unit: "länger geschlafen",
        shareText: "der Ausschlaf-Stunden",
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
