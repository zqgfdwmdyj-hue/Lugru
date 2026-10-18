// Gemeinsame Hilfen für den Kinder-Bereich (welches Kind ist gewählt, Zustand je Kind, Speichern).
import { zustand, anfrage, stationsArt } from "./kern.js";
import { istKind } from "./rechnen.js";

export const kinder = () => {
  const ps = zustand.reise?.personen ?? [];
  return ps.filter(istKind).length ? ps.filter(istKind) : ps;
};
export const kind = () => kinder().find((p) => p.id === zustand.kind) ?? kinder()[0] ?? null;
export const vorname = (p) => String(p?.name ?? "").split(" ")[0];
export const zustandKind = (p = kind()) => {
  const k = zustand.extras.kinder?.[p?.id] ?? {};
  return { abzeichen: {}, quiz: {}, tagebuch: {}, kasse: { start: null, ausgaben: [] }, kidsclub: {}, funde: [], ranking: {}, ...k };
};
export const istSeetag = (h) => stationsArt(h) === "seetag";

export async function kinderSetzen(bereich, schluessel, wert, p = kind()) {
  const k = await anfrage(`/api/reisen/${zustand.reise.id}/kinder/${p.id}`, { method: "PUT", body: { bereich, schluessel, wert } });
  zustand.extras.kinder ??= {};
  zustand.extras.kinder[p.id] = k;
  return k;
}
