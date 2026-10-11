// Kinder-Ansicht: großer Countdown, heutiger Ort, was heute passiert, Tiere-Bingo.
import { zustand, esc, datumText, haefen, ausfluegeIn, stationsArt, aktionen, neuZeichnen, anfrage, heute } from "./kern.js";
import { countdown } from "./unterwegs-logik.js";
import { tiereFuer, tiereDerReise, regionFuer } from "./tiere.js";
import { tierBild } from "./tierbilder.js";
import { zeitZuMin, festeZeit, zimmerVon } from "./rechnen.js";
import { unterkunftAm } from "./unterwegs.js";

const BILD = { tauchen: "🤿", schnorcheln: "🐠", strand: "🏖️", boot: "⛵", natur: "🥾", sport: "🏄", stadt: "🏛️", tiere: "🐒", kultur: "🎭", essen: "🍽️", bord: "🛳️", ausflug: "🗺️", tickets: "🎟️", park: "🎢", ski: "⛷️" };

export function kinderAnsicht() {
  const r = zustand.reise;
  const c = countdown(r, heute());
  const tage = haefen();
  const heuteTag = tage.find((h) => h.datum === heute());
  const naechster = tage.find((h) => h.datum >= heute());
  const tag = heuteTag ?? (c.phase === "vorher" ? tage[0] : naechster) ?? null;
  const tiere = tiereDerReise(r);
  const gesehen = zustand.extras.tiere ?? {};
  const heuteTiere = new Set(tiereFuer(tag).map((t) => t.name));
  const anzahlGesehen = tiere.filter((t) => gesehen[t.name]).length;
  const geplant = tag ? ausfluegeIn(tag.id).filter((a) => a.status === "gebucht").sort((a, b) => (zeitZuMin(a.beginn) ?? 9999) - (zeitZuMin(b.beginn) ?? 9999)) : [];

  let gross = "";
  if (c.phase === "leer") gross = `<div class="kind-gross">🗺️</div><p>Noch keine Reisetage eingetragen.</p>`;
  else if (c.phase === "vorher") gross = `<div class="kind-gross">${c.tage}</div><p class="kind-text">${c.tage === 1 ? "Nur noch <strong>einmal</strong> schlafen!" : `Noch <strong>${c.tage}</strong> Mal schlafen bis zur Reise!`}</p>`;
  else if (c.phase === "unterwegs") gross = `<div class="kind-gross">Tag ${c.tagNr}</div><p class="kind-text">von ${c.tageGesamt} Tagen – noch ${c.tage} ${c.tage === 1 ? "Tag" : "Tage"} Urlaub!</p>`;
  else gross = `<div class="kind-gross">🏠</div><p class="kind-text">Die Reise ist vorbei – schau dir die Tiere an, die ihr gesehen habt!</p>`;

  const ortText = (h) => (stationsArt(h) === "seetag" ? "🌊 Wir sind auf dem Meer!" : `${stationsArt(h) === "hafen" ? "⚓" : "📍"} ${esc(h.name)}${h.land ? `, ${esc(h.land)}` : ""}`);
  return `
    <div class="kinder">
      <div class="karte-box kind-countdown">${gross}</div>
      ${tag ? `<div class="karte-box kind-heute">
        <h2>${heuteTag ? "Heute" : c.phase === "vorher" ? "Der erste Tag" : "Als Nächstes"}: ${ortText(tag)}</h2>
        <p class="leise">${esc(datumText(tag.datum, { weekday: "long", day: "numeric", month: "long" }))}${regionFuer(tag) ? ` · ${esc(regionFuer(tag).name)}` : ""}</p>
        ${geplant.length ? `<div class="kind-plan">${geplant.map((a) => `<div class="kind-punkt"><span class="kind-bild">${BILD[a.kategorie] ?? "🗺️"}</span><div><strong>${esc(a.beginn || "")}</strong> ${esc(a.titel)}</div></div>`).join("")}</div>` : stationsArt(tag) === "seetag" ? `<p class="kind-text">Pool, Kinderclub, Eis essen und nach Delfinen Ausschau halten! 🐬</p>` : ""}
        ${stationsArt(tag) === "hafen" && tag.allesAnBord ? `<p class="kind-text">⏰ Um <strong>${esc(tag.allesAnBord)}</strong> müssen alle wieder auf dem Schiff sein!</p>` : festeZeit(tag, r) ? `<p class="kind-text">⏰ Um <strong>${esc(festeZeit(tag, r).zeit)}</strong>: ${esc(festeZeit(tag, r).kurz)}</p>` : ""}
        ${(() => {
          const u = unterkunftAm(tag.datum);
          const z = u ? zimmerVon(r, u.id) : [];
          const name = (id) => r.personen?.find((p) => p.id === id)?.name.split(" ")[0] ?? "";
          const einzahl = z.length === 1;
          return z.length ? `<p class="kind-text">🛏️ ${u.id === "schiff" ? (einzahl ? "Unsere Kabine" : "Unsere Kabinen") : `${einzahl ? "Unser Zimmer" : "Unsere Zimmer"} – ${esc(u.name)}`}: ${z.map((x) => `<strong>${esc(x.nummer || "?")}</strong>${x.deck ? ` (${u.id === "schiff" ? "Deck" : "Etage"} ${esc(x.deck)})` : ""}${!einzahl && x.personen?.length ? ` <span class="klein">${esc(x.personen.map(name).join(", "))}</span>` : ""}`).join(" · ")}</p>` : "";
        })()}
      </div>` : ""}
      ${tiere.length ? `<div class="karte-box">
        <div class="zeile"><h2>🔍 Tiere-Bingo</h2><span class="platz"></span><strong>${anzahlGesehen} / ${tiere.length}</strong></div>
        <p class="leise">Tippe auf ein Tier, wenn ihr es gesehen habt!${heuteTag ? " ⭐ = kann man heute sehen" : ""}</p>
        <div class="bingo">${tiere.map((t) => `<button class="bingo-feld ${gesehen[t.name] ? "gesehen" : ""} ${heuteTag && heuteTiere.has(t.name) ? "heute" : ""}" data-aktion="tier" data-name="${esc(t.name)}" title="${esc(t.satz)}">
          <span class="bingo-emoji">${tierBild(t)}</span><span class="bingo-name">${esc(t.name)}</span>${gesehen[t.name] ? `<span class="bingo-haken">✓</span>` : ""}</button>`).join("")}</div>
        ${zustand.kindTier ? `<p class="kind-fakt"><span class="fakt-bild">${tierBild(tiere.find((t) => t.name === zustand.kindTier))}</span> <strong>${esc(zustand.kindTier)}:</strong> ${esc(tiere.find((t) => t.name === zustand.kindTier)?.satz ?? "")}</p>` : ""}
      </div>` : ""}
      <div class="karte-box">
        <h2>🗺️ Unsere Reise</h2>
        <div class="kind-route">${tage.map((h, i) => `<span class="kind-station ${h.datum < heute() ? "vorbei" : ""} ${h.datum === heute() ? "jetzt" : ""}">${stationsArt(h) === "seetag" ? "🌊" : stationsArt(h) === "hafen" ? "⚓" : "📍"} ${esc(stationsArt(h) === "seetag" ? "Meer" : h.name)}</span>${i < tage.length - 1 ? "<span class=\"kind-pfeil\">→</span>" : ""}`).join("")}</div>
      </div>
    </div>`;
}

aktionen["tier"] = async (el) => {
  const name = el.dataset.name;
  const gesehen = !zustand.extras.tiere?.[name];
  zustand.kindTier = name;
  try {
    zustand.extras.tiere = await anfrage(`/api/reisen/${zustand.reise.id}/tiere`, { method: "PUT", body: { tier: name, gesehen } });
  } catch (e) {
    alert(e.message);
  }
  neuZeichnen();
};
