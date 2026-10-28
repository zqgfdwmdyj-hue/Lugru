// Einheitliche Oberfläche auf allen Seiten der Navigation – Handy und Desktop:
// - Status (Kennzeichen) nie nur über Farbe: immer Text, kein eigenes Farbschema je Seite, jede Statusart überall gleich
//   und die Arten untereinander unterscheidbar;
// - aktive Auswahl (Reiter, Filter, Menü) für Screenreader markiert (aria-current/aria-pressed) und sichtbar mit ✓ bzw. gefüllt;
// - deaktivierte Knöpfe sichtbar anders (gestrichelt), Warnungen/Fehler/Hinweise unterscheidbar;
// - Kontrast von Text auf Status, Knöpfen, Auswahl und Hinweisen mindestens 4,5 : 1;
// - am Handy kein seitliches Verschieben der ganzen Seite.
import { NAV, SUBPAGES } from "../src/lib/nav";
import { anmelden, expect, keinWaagrechtesScrollen, test } from "./helfer";

const SEITEN = [
  ...new Set([
    ...NAV.flatMap((s) => s.items.map((i) => i.href)),
    ...Object.values(SUBPAGES).flatMap((l) => l.map((i) => i.href)),
    "/privat/kalender",
    "/privat/kalender?ansicht=monat",
    "/privat/eintragen?art=kinder",
    "/privat/ritual",
    "/einstellungen/testumgebung",
    "/auftraege?ansicht=fehler",
    "/marken/uhren/deals?filter=uebung",
  ]),
].filter((h) => !h.includes("#"));

type Befund = { issues: string[]; palette: Record<string, string> };

/** Läuft im Browser: prüft die sichtbare Seite und gibt Befunde + Farben je Statusart zurück. */
function pruefeSeite(): Befund {
  const issues: string[] = [];
  const palette: Record<string, string> = {};
  const parse = (c: string): number[] | null => {
    let m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    }
    m = c.match(/color\(srgb ([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
    }
    return null;
  };
  const lum = (c: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const bgOf = (el: Element) => {
    const layers: number[][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let base = [255, 255, 255];
    for (const c of layers.reverse()) base = base.map((v, i) => v * (1 - c[3]) + c[i] * c[3]);
    return base;
  };
  const ratio = (el: Element) => {
    const bg = bgOf(el);
    const fg0 = parse(getComputedStyle(el).color) ?? [0, 0, 0, 1];
    const fg = bg.map((v, i) => v * (1 - fg0[3]) + fg0[i] * fg0[3]);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };
  const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).opacity !== "0";
  const label = (el: Element) => `${typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : el.tagName} „${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}“`;
  const kontrast = (el: Element, was: string) => {
    const r = ratio(el);
    if (r < 4.5) issues.push(`${was}: Kontrast ${r.toFixed(2)} : 1 < 4,5 – ${label(el)}`);
  };

  for (const el of document.querySelectorAll(".tag")) {
    if (!visible(el)) continue;
    if (!(el.textContent ?? "").trim()) issues.push(`Status ohne Text: ${label(el)}`);
    if (/(^|;)\s*(color|background)/.test(el.getAttribute("style") ?? "")) issues.push(`Status mit eigener Farbe: ${label(el)}`);
    kontrast(el, "Status");
    const cls = [...el.classList].find((c) => /^tag-/.test(c));
    if (cls) {
      const s = getComputedStyle(el);
      palette[cls] = `${s.backgroundColor} / ${s.color}`;
    }
  }
  for (const el of document.querySelectorAll(".notice-ok, .notice-warn, .notice-error, .notice-info")) {
    if (!visible(el)) continue;
    if (!(el.textContent ?? "").trim()) issues.push(`Hinweis ohne Text: ${label(el)}`);
    kontrast(el, "Hinweis");
    const cls = [...el.classList].find((c) => /^notice-/.test(c))!;
    palette[cls] = `${getComputedStyle(el).backgroundColor} / ${getComputedStyle(el).borderLeftColor}`;
  }
  const AKTIV = ".chip.active, .area-tab.active, .pk-seg a.active, .kind-chip.active, .nav-link.active, .nav-section-link.active, .pnav-item.active, .kb-cat.active, .pal-action.active";
  for (const el of document.querySelectorAll(AKTIV)) {
    if (!visible(el)) continue;
    const aria = el.getAttribute("aria-current") || el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true";
    if (!aria) issues.push(`Aktive Auswahl ohne aria-current/aria-pressed: ${label(el)}`);
    kontrast(el, "Aktive Auswahl");
  }
  for (const el of document.querySelectorAll(".pick-chips input:checked + span, .rate-row input:checked + span")) if (visible(el)) kontrast(el, "Gewählte Option");
  for (const el of document.querySelectorAll(".btn, .chip, .area-tab, .pk-seg a")) {
    if (!visible(el)) continue;
    const disabled = (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
    if (disabled) {
      if (getComputedStyle(el).borderTopStyle !== "dashed") issues.push(`Deaktivierter Knopf nicht erkennbar (Rahmen nicht gestrichelt): ${label(el)}`);
      continue;
    }
    kontrast(el, "Knopf/Filter");
  }
  for (const el of document.querySelectorAll(".kpi-label, .kpi-meta")) if (visible(el)) kontrast(el, "Kennzahl");
  return { issues, palette };
}

for (const projekt of ["desktop", "handy"] as const) {
  test(`Alle Seiten: Status, Auswahl, deaktiviert, Kontrast${projekt === "handy" ? ", kein Querscrollen @nur-handy" : ""}`, async ({ page }, info) => {
    test.skip(info.project.name !== projekt, "läuft je Gerät einmal");
    test.setTimeout(SEITEN.length * 15_000);
    await anmelden(page, "inhaber");
    const befunde: string[] = [];
    const farben: Record<string, Set<string>> = {};
    for (const s of SEITEN) {
      const res = await page.goto(s);
      if (!res || res.status() >= 400) {
        befunde.push(`${s}: Seite antwortet mit ${res?.status()}`);
        continue;
      }
      const b = await page.evaluate(pruefeSeite);
      for (const i of b.issues) befunde.push(`${s}: ${i}`);
      for (const [k, v] of Object.entries(b.palette)) (farben[k] ??= new Set()).add(v);
      if (projekt === "handy" && !(await keinWaagrechtesScrollen(page))) befunde.push(`${s}: Seite lässt sich am Handy seitlich verschieben`);
    }
    // Jede Statusart überall gleich – und die Arten untereinander verschieden.
    for (const [k, v] of Object.entries(farben)) if (v.size > 1) befunde.push(`${k} hat ${v.size} verschiedene Farben: ${[...v].join(" | ")}`);
    const eins = (k: string) => [...(farben[k] ?? [])][0];
    for (const gruppe of [["tag-ok", "tag-warn", "tag-danger", "tag-info"], ["notice-ok", "notice-warn", "notice-error", "notice-info"]]) {
      const vorhanden = gruppe.filter((k) => eins(k));
      if (new Set(vorhanden.map(eins)).size !== vorhanden.length) befunde.push(`${gruppe.join("/")} nicht unterscheidbar`);
    }
    await info.attach("geprüfte Seiten", { body: SEITEN.join("\n"), contentType: "text/plain" });
    expect([...new Set(befunde)], `Befunde (${SEITEN.length} Seiten)`).toEqual([]);
  });
}
