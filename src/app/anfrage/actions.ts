"use server";

import { redirect } from "next/navigation";
import { anfrageAnlegen } from "@/lib/abverkauf/kampagnen";

// B34.3b Anfrage über den QR-Code im Brief: öffentlich, ohne Anmeldung. Gespeichert wird nur mit Firma, Kontakt,
// gültigem USt-ID-Format und Zustimmung; daraus wird eine Aufgabe im Posteingang.
export async function anfrageSendenAction(fd: FormData) {
  const code = String(fd.get("code") ?? "").slice(0, 12);
  const t = (k: string, n = 200) => String(fd.get(k) ?? "").slice(0, n);
  const r = await anfrageAnlegen({ code, anschreiben: t("b", 20) || null, firma: t("firma"), ustId: t("ust", 20), name: t("name"), email: t("email"), telefon: t("telefon", 40), wunsch: fd.getAll("wunsch").map(String).slice(0, 100), freitext: t("freitext", 1000), menge: t("menge"), einwilligung: fd.get("einwilligung") === "on", falle: t("website") });
  const b = t("b", 20);
  if (!r.ok) redirect(`/anfrage/${encodeURIComponent(code)}?fehler=${encodeURIComponent(r.fehler)}${b ? `&b=${encodeURIComponent(b)}` : ""}`);
  redirect(`/anfrage/${encodeURIComponent(code)}?danke=1`);
}
