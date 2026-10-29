import { z } from "zod";

// Eingaben für Deals – gemeinsam für die Seite und die Claude-Werkzeuge (deal_anlegen, deal_preis_setzen).

const geld = z.number().finite().nonnegative().max(1_000_000);
const ganz = (min: number) => z.number().int().min(min).max(1_000_000);
const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");

export const DealEingabe = z.object({
  asin: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{10}$/, "ASIN hat 10 Zeichen")),
  ean: z.string().trim().regex(/^\d{8,14}$/, "EAN nur Ziffern").nullish(),
  titel: z.string().trim().max(300).nullish(),
  bildUrl: z.string().trim().url().max(1000).nullish(),
  marke: z.string().trim().max(120).nullish(),
  kategorie: z.string().trim().max(120).nullish(),
  supplierId: z.string().uuid().nullish(),
  angebotId: z.string().uuid().nullish(),
  ekNetto: geld.positive("EK netto fehlt"),
  staffel: z.array(z.object({ ab: ganz(1), preis: geld })).max(10).default([]),
  moqLieferant: ganz(1).default(1),
  lieferzeitTage: ganz(0).nullish(),
  angebotGueltigBis: datum.nullish(),
  frist: datum.nullish(),
  kundenpreisNetto: geld.nullish(),
  mindestmengeKunde: ganz(1).default(1),
  maxGesamt: ganz(1).nullish(),
  maxProKunde: ganz(1).nullish(),
  maxKunden: ganz(1).nullish(),
  nurRestmenge: z.boolean().default(false),
  versandAnteil: geld.nullish(),
  prepGebuehr: geld.nullish(),
  hinweis: z.string().trim().max(2000).nullish(),
});
export type DealEingabe = z.infer<typeof DealEingabe>;

/** „ab 50: 4,20; ab 100: 3,90“ oder „50=4,20 100=3,90“ → Staffel. */
export function leseStaffel(roh: string | null | undefined): { ab: number; preis: number }[] {
  const out: { ab: number; preis: number }[] = [];
  for (const m of (roh ?? "").matchAll(/(?:ab\s*)?(\d+)\s*(?:stk\.?|stück)?\s*[:=]\s*(\d+(?:[.,]\d{1,4})?)/gi)) out.push({ ab: Number(m[1]), preis: Number(m[2].replace(",", ".")) });
  return out.sort((a, b) => a.ab - b.ab).slice(0, 10);
}
export const staffelText = (s: { ab: number; preis: number }[]) => s.map((x) => `ab ${x.ab}: ${x.preis.toFixed(2).replace(".", ",")}`).join("; ");

/** EK je Stück für eine Bestellmenge laut Staffel (sonst Grund-EK). */
export function ekFuerMenge(ek: number, staffel: { ab: number; preis: number }[], menge: number): number {
  let p = ek;
  for (const s of [...staffel].sort((a, b) => a.ab - b.ab)) if (menge >= s.ab) p = s.preis;
  return p;
}
