import { defaultStatus, statusOf, type AppointmentEntry, type DateEntry, type EntryStatus, type IntimEntry, type KidsEntry, type PartnerKey, type PrivateSettings, type SleepEntry } from "@/lib/private/logic";
import type { PeriodEntry, RitualEntry, TouchEntry } from "@/lib/private/kalender";
import { saveEntryAction } from "./eintrag-actions";
import { OtherName, StatusField } from "./form-helpers";
import { StateForm } from "./state-form";
import { Choice, Rating } from "./ui";

// Ein Formular je Art – dasselbe zum Anlegen („Eintragen“) und zum Ändern (Detailseite). So gibt es jede
// Angabe nur einmal, und der Eintrag erscheint sofort im Kalender und auf seiner Detailseite.

export type Art = "termin" | "kinder" | "auszeit" | "ausschlafen" | "paarzeit" | "naehe" | "zuwendung" | "periode";
export const ART_LABEL: Record<Art, string> = {
  termin: "Termin",
  kinder: "Kinderzeit",
  auszeit: "Auszeit",
  ausschlafen: "Ausschlafen",
  paarzeit: "Paarzeit",
  naehe: "Nähe",
  zuwendung: "Streicheln / Massage",
  periode: "Periode",
};
/** Nur diese Arten mit Umfang „nur Familie“. */
export const FAMILY_ARTEN: Art[] = ["kinder", "auszeit", "ausschlafen"];
/** Arten, die man ausdrücklich (neutral als „Privater Termin“) in den verbundenen Kalender geben kann. Nie Periode, Nähe, Streicheln/Massage. */
export const EXTERN_ARTEN: Art[] = ["termin", "kinder", "auszeit", "ausschlafen", "paarzeit"];

type Ctx = {
  art: Art;
  today: string;
  day: string;
  settings: PrivateSettings;
  me: PartnerKey | null;
  /** Bestehender Eintrag (ändern). */
  id?: string;
  data?: Record<string, unknown>;
  /** Andere Konten mit Privat-Zugang (Periode freigeben). */
  members?: { userId: string; label: string }[];
  ritual?: RitualEntry | null;
  linkedName?: string | null;
};

const names = (s: PrivateSettings) => s.partners;

function Who({ ctx, label, name = "person" }: { ctx: Ctx; label: string; name?: string }) {
  const cur = (ctx.data?.[name] as PartnerKey | undefined) ?? ctx.me ?? undefined;
  return (
    <div className="field">
      <span className="label">{label}</span>
      <Choice name={name} value={cur} options={[{ value: "a", label: names(ctx.settings).a }, { value: "b", label: names(ctx.settings).b }]} />
    </div>
  );
}

function Day({ ctx, name = "day", label = "Tag", max }: { ctx: Ctx; name?: string; label?: string; max?: string }) {
  const v = (ctx.data?.[name] as string | undefined) ?? ctx.day;
  return (
    <div className="field">
      <label className="label" htmlFor={`f-${name}`}>{label}</label>
      <input className="input" id={`f-${name}`} type="date" name={name} defaultValue={v} max={max} required style={{ maxWidth: 190 }} />
    </div>
  );
}

function Times({ ctx, fromLabel = "von", toLabel = "bis", fromDefault }: { ctx: Ctx; fromLabel?: string; toLabel?: string; fromDefault?: string }) {
  const d = ctx.data ?? {};
  return (
    <div className="pk-form-grid">
      <div className="field"><label className="label small" htmlFor="f-from">{fromLabel}</label><input className="input" id="f-from" name="from" type="time" defaultValue={(d.from as string) ?? fromDefault} /></div>
      <div className="field"><label className="label small" htmlFor="f-to">{toLabel}</label><input className="input" id="f-to" name="to" type="time" defaultValue={d.to as string | undefined} /></div>
      <div className="field"><label className="label small" htmlFor="f-hours">oder Stunden</label><input className="input" id="f-hours" name="hours" inputMode="decimal" placeholder="z. B. 2,5" defaultValue={d.from && d.to ? undefined : (d.hours as number | undefined)?.toString().replace(".", ",")} /></div>
    </div>
  );
}

function Status({ ctx }: { ctx: Ctx }) {
  const initial: EntryStatus = ctx.data ? statusOf(ctx.data as { status?: string }) : defaultStatus(ctx.day, ctx.today);
  return <StatusField today={ctx.today} initial={initial} />;
}

function Extern({ ctx }: { ctx: Ctx }) {
  if (!EXTERN_ARTEN.includes(ctx.art)) return null;
  return (
    <label className="check small" data-testid="extern-optin">
      <input type="checkbox" name="extern" defaultChecked={ctx.data?.extern === true} /> Zusätzlich in den eigenen Export-Kalender „{ctx.settings.externSync.calendar}“ – nur als neutraler „Privater Termin“ (ganztägig, ohne Inhalt). Standard: aus.
      {!ctx.settings.externSync.enabled && <span className="muted"> Wirkt erst, wenn der Export unter Einstellungen eingeschaltet ist.</span>}
    </label>
  );
}

function Text({ name, label, ctx, placeholder, max = 200 }: { name: string; label: string; ctx: Ctx; placeholder?: string; max?: number }) {
  return (
    <div className="field">
      <label className="label small" htmlFor={`f-${name}`}>{label}</label>
      <input className="input" id={`f-${name}`} name={name} defaultValue={(ctx.data?.[name] as string | undefined) ?? ""} placeholder={placeholder} maxLength={max} autoComplete="off" />
    </div>
  );
}

function TerminFields({ ctx }: { ctx: Ctx }) {
  const d = (ctx.data ?? {}) as Partial<AppointmentEntry>;
  const t = ctx.settings.therapists;
  return (
    <>
      <Text name="title" label="Titel" ctx={ctx} placeholder="z. B. Elternabend, Geburtstag Oma" max={120} />
      <div className="field">
        <span className="label">Art</span>
        <Choice name="with" value={d.with ?? "privat"} options={[{ value: "privat", label: "Privat" }, { value: "familie", label: "Familie" }, { value: "arzt", label: "Arzt" }, { value: "ads", label: t.ads }, { value: "paar", label: t.paar }, { value: "sonst", label: "Sonstiges" }]} />
      </div>
      <div className="field">
        <span className="label">Für wen</span>
        <Choice name="person" value={d.person ?? "beide"} options={[{ value: "beide", label: "beide / Familie" }, { value: "a", label: ctx.settings.partners.a }, { value: "b", label: ctx.settings.partners.b }]} />
      </div>
      <Day ctx={ctx} />
      <div className="pk-form-grid">
        <div className="field"><label className="label small" htmlFor="f-time">Beginn (optional)</label><input className="input" id="f-time" name="time" type="time" defaultValue={d.time} /></div>
        <div className="field"><label className="label small" htmlFor="f-to">Ende (optional)</label><input className="input" id="f-to" name="to" type="time" defaultValue={d.to} /></div>
      </div>
      <Status ctx={ctx} />
      <div className="field">
        <label className="label small" htmlFor="f-notes">Notizen</label>
        <textarea className="input" id="f-notes" name="notes" rows={3} defaultValue={d.notes ?? ""} />
      </div>
    </>
  );
}

function KinderFields({ ctx }: { ctx: Ctx }) {
  const d = (ctx.data ?? {}) as Partial<KidsEntry>;
  return (
    <>
      <Who ctx={ctx} label="Wer ist mit den Kindern?" />
      <Day ctx={ctx} />
      <Times ctx={ctx} />
      <Status ctx={ctx} />
      <Text name="what" label="Was (optional)" ctx={ctx} placeholder="z. B. Spielplatz, Schwimmbad" />
      {ctx.settings.kids.length > 0 && (
        <div className="field">
          <span className="label small">Welche Kinder (optional)</span>
          <div className="pick-chips">
            {ctx.settings.kids.map((k) => (
              <label key={k}><input type="checkbox" name="kids" value={k} defaultChecked={d.kids?.includes(k)} /><span>{k}</span></label>
            ))}
          </div>
        </div>
      )}
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label small">Hatte <OtherName names={ctx.settings.partners} initial={d.person ?? ctx.me} /> währenddessen Auszeit?</legend>
        <input type="hidden" name="linkQuestion" value="1" />
        <label className="check small"><input type="checkbox" name="linkAuszeit" defaultChecked={Boolean(d.linkId)} /> Ja – als Auszeit mit eintragen (ein Vorgang, Datum und Zeit gelten für beide, jede Zeit zählt nur einmal)</label>
        {d.linkId && ctx.linkedName && <span className="small muted">Verknüpft mit: {ctx.linkedName}. Haken entfernen löst nur die Verknüpfung, der andere Eintrag bleibt.</span>}
      </fieldset>
    </>
  );
}

function AuszeitFields({ ctx }: { ctx: Ctx }) {
  const d = (ctx.data ?? {}) as Partial<SleepEntry>;
  const by = d.linkId ? "partner" : d.kidsBy ? "andere" : "";
  return (
    <>
      <Who ctx={ctx} label="Wer hat Auszeit?" />
      <Day ctx={ctx} />
      <Times ctx={ctx} />
      <Status ctx={ctx} />
      <Text name="note" label="Was (optional)" ctx={ctx} placeholder="z. B. Sport, Freunde" />
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} data-testid="kids-question">
        <legend className="label small">Wer übernimmt in dieser Zeit die Kinder? (optional)</legend>
        <input type="hidden" name="linkQuestion" value="1" />
        <div className="pick-chips" role="radiogroup">
          <label><input type="radio" name="kidsBy" value="" defaultChecked={by === ""} /><span>keine Angabe</span></label>
          <label><input type="radio" name="kidsBy" value="partner" defaultChecked={by === "partner"} /><span><OtherName names={ctx.settings.partners} initial={d.person ?? ctx.me} /></span></label>
          <label><input type="radio" name="kidsBy" value="andere" defaultChecked={by === "andere"} /><span>jemand anderes</span></label>
        </div>
        <input className="input" name="kidsByName" placeholder="bei „jemand anderes“: wer? (optional)" defaultValue={d.kidsBy && d.kidsBy !== "jemand anderes" ? d.kidsBy : ""} maxLength={60} />
        <span className="small muted">Bei der anderen Person entsteht ein verknüpfter Kinderzeit-Eintrag – nie automatisch, nur mit dieser Auswahl.{d.linkId && ctx.linkedName ? ` Verknüpft mit: ${ctx.linkedName}.` : ""}</span>
      </fieldset>
    </>
  );
}

function AusschlafenFields({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <Who ctx={ctx} label="Wer schläft aus?" />
      <Day ctx={ctx} />
      <Times ctx={ctx} fromLabel="sonst auf um" toLabel="aufgestanden um" fromDefault={ctx.data ? undefined : ctx.settings.wakeTime} />
      <Status ctx={ctx} />
      <Text name="note" label="Notiz (optional)" ctx={ctx} />
    </>
  );
}

function PaarzeitFields({ ctx }: { ctx: Ctx }) {
  const d = (ctx.data ?? {}) as Partial<DateEntry>;
  return (
    <>
      <Day ctx={ctx} />
      <Times ctx={ctx} />
      <Status ctx={ctx} />
      <Text name="what" label="Was (optional)" ctx={ctx} placeholder="z. B. Essen gehen, Kino" />
      <Text name="sitter" label="Wer passt auf die Kinder auf? (optional)" ctx={ctx} max={60} />
      <details>
        <summary className="small" style={{ cursor: "pointer" }}>Kosten, Bewertung, Notiz</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="field"><label className="label small" htmlFor="f-cost">Kosten in € (optional)</label><input className="input" id="f-cost" name="costEur" inputMode="decimal" defaultValue={d.costEur?.toString().replace(".", ",")} style={{ maxWidth: 160 }} /></div>
          <Rating name="rating" label="Wie war es? (nach dem Date)" low="naja" high="wunderbar" value={d.rating} />
          <Text name="note" label="Notiz" ctx={ctx} max={500} />
        </div>
      </details>
    </>
  );
}

function NaeheFields({ ctx }: { ctx: Ctx }) {
  const d = (ctx.data ?? {}) as Partial<IntimEntry>;
  return (
    <>
      <Day ctx={ctx} max={ctx.today} />
      <div className="field" style={{ maxWidth: 190 }}><label className="label small" htmlFor="f-ntime">Uhrzeit (optional)</label><input className="input" id="f-ntime" name="time" type="time" defaultValue={d.time} /></div>
      <div className="field">
        <span className="label small">Initiative (optional)</span>
        <Choice name="initiative" value={d.initiative} options={[{ value: "a", label: ctx.settings.partners.a }, { value: "b", label: ctx.settings.partners.b }, { value: "beide", label: "beide" }]} />
      </div>
      <Rating name="closeness" label="Wie nah habt ihr euch gefühlt? (optional)" low="wenig" high="sehr" value={d.closeness} />
      <Text name="note" label="Notiz (optional)" ctx={ctx} max={500} />
      <span className="small muted">Nähe wird nur nachträglich erfasst – sie zählt immer als stattgefunden.</span>
    </>
  );
}

function ZuwendungFields({ ctx }: { ctx: Ctx }) {
  const n = ctx.settings.partners;
  if (ctx.id) {
    const d = (ctx.data ?? {}) as Partial<TouchEntry>;
    return (
      <>
        {d.occurrence && <div className="notice notice-info small">Aus dem Abendritual (ursprünglich {d.occurrence.split("|")[1]?.split("-").reverse().join(".")}). Ein anderer Tag verschiebt nur diesen Termin – die Serie bleibt.</div>}
        <div className="field"><span className="label">Was</span><Choice name="kind" value={d.kind} options={[{ value: "streicheln", label: "Streicheln" }, { value: "massage", label: "Massage" }]} /></div>
        <div className="field"><span className="label">Wer gibt?</span><Choice name="giver" value={d.giver} options={[{ value: "a", label: `${n.a} → ${n.b}` }, { value: "b", label: `${n.b} → ${n.a}` }]} /></div>
        <Day ctx={ctx} />
        <div className="pk-form-grid">
          <div className="field"><label className="label small" htmlFor="f-ttime">Uhrzeit (optional)</label><input className="input" id="f-ttime" name="time" type="time" defaultValue={d.time} /></div>
          <div className="field"><label className="label small" htmlFor="f-min">Dauer in Minuten (optional)</label><input className="input" id="f-min" name="minutes" inputMode="numeric" defaultValue={d.minutes} /></div>
        </div>
        <Status ctx={ctx} />
        <Text name="note" label="Notiz (optional)" ctx={ctx} max={300} />
      </>
    );
  }
  // Neu: Streicheln und/oder Massage am selben Abend – je ein eigener Eintrag, getrennt bestätigbar.
  const slotOf = (k: "streicheln" | "massage") => ctx.ritual?.slots.find((s) => s.kind === k);
  const def = { streicheln: slotOf("streicheln")?.giver ?? "a", massage: slotOf("massage")?.giver ?? "b" } as const;
  return (
    <>
      <Day ctx={ctx} />
      {(["streicheln", "massage"] as const).map((k) => (
        <fieldset key={k} className="card card-pad stack" style={{ gap: 8, margin: 0 }} data-testid={`touch-${k}`}>
          <label className="check" style={{ fontWeight: 700 }}><input type="checkbox" name={`do-${k}`} defaultChecked={k === "streicheln"} /> {k === "streicheln" ? "Streicheln" : "Massage"}</label>
          <Choice name={`${k}-giver`} value={def[k]} options={[{ value: "a", label: `${n.a} ${k === "massage" ? "massiert" : "streichelt"} ${n.b}` }, { value: "b", label: `${n.b} ${k === "massage" ? "massiert" : "streichelt"} ${n.a}` }]} />
          <div className="field" style={{ maxWidth: 190 }}><label className="label small" htmlFor={`f-${k}-time`}>Uhrzeit (optional)</label><input className="input" id={`f-${k}-time`} name={`${k}-time`} type="time" /></div>
        </fieldset>
      ))}
      <Status ctx={ctx} />
      <div className="field" style={{ maxWidth: 220 }}><label className="label small" htmlFor="f-min">Dauer in Minuten (optional)</label><input className="input" id="f-min" name="minutes" inputMode="numeric" /></div>
      <span className="small muted">Beides angehakt = zwei Einträge am selben Tag, jeder lässt sich einzeln bestätigen.</span>
    </>
  );
}

function PeriodeFields({ ctx }: { ctx: Ctx }) {
  const d = (ctx.data ?? {}) as Partial<PeriodEntry>;
  return (
    <>
      <Who ctx={ctx} label="Wessen Periode?" />
      <div className="pk-form-grid">
        <div className="field"><label className="label small" htmlFor="f-start">Erster Tag</label><input className="input" id="f-start" type="date" name="start" defaultValue={d.start ?? ctx.day} max={ctx.today} required /></div>
        <div className="field"><label className="label small" htmlFor="f-end">Letzter Tag (später nachtragen)</label><input className="input" id="f-end" type="date" name="end" defaultValue={d.end} max={ctx.today} /></div>
      </div>
      <Text name="note" label="Notiz (optional)" ctx={ctx} max={300} />
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} data-testid="period-share">
        <legend className="label small">Wer darf sie sehen?</legend>
        <span className="small muted">Nur du – außer du gibst sie hier ausdrücklich frei.</span>
        {(ctx.members ?? []).length === 0 ? <span className="small muted">Keine weiteren Konten mit Privat-Zugang.</span> : (
          <div className="pick-chips">
            {(ctx.members ?? []).map((m) => (
              <label key={m.userId}><input type="checkbox" name="shareWith" value={m.userId} defaultChecked={d.shareWith?.includes(m.userId)} /><span>{m.label}</span></label>
            ))}
          </div>
        )}
      </fieldset>
      <span className="small muted">Nur tatsächliche Tage – eine spätere Vorhersage wäre getrennt und als Schätzung gekennzeichnet. Nie im geschäftlichen oder geteilten Kalender.</span>
    </>
  );
}

const SUBMIT: Record<Art, string> = { termin: "Termin speichern", kinder: "Kinderzeit speichern", auszeit: "Auszeit speichern", ausschlafen: "Ausschlafen speichern", paarzeit: "Paarzeit speichern", naehe: "Nähe speichern", zuwendung: "Speichern", periode: "Periode speichern" };

export function EntryForm(ctx: Ctx) {
  const F = { termin: TerminFields, kinder: KinderFields, auszeit: AuszeitFields, ausschlafen: AusschlafenFields, paarzeit: PaarzeitFields, naehe: NaeheFields, zuwendung: ZuwendungFields, periode: PeriodeFields }[ctx.art];
  return (
    <StateForm action={saveEntryAction} submit={ctx.id ? "Änderung speichern" : SUBMIT[ctx.art]} testid="entry-form" keep>
      <input type="hidden" name="art" value={ctx.art} />
      {ctx.id && <input type="hidden" name="id" value={ctx.id} />}
      <F ctx={ctx} />
      <Extern ctx={ctx} />
    </StateForm>
  );
}
