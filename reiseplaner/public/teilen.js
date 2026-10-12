// Teilen: öffentlicher Link nur für diesen Beitrag, Social-Media-Knöpfe, Story-Bild und KI-Text.
import { zustand, $, esc, aktionen, dialogOeffnen, anfrage, fotoUrl, herunterladen, hafenVon } from "./kern.js";
import { oeffentlicheFotos } from "./rechnen.js";

// Nur Bewertungen, die geteilt werden dürfen (Story-Bild, Fotos an Apps)
const bewertungenZu = (art, id) => zustand.beitraege.bewertungen.filter((b) => b.zielArt === art && b.zielId === id && !b.privat);

function eckdaten(art, id) {
  const r = zustand.reise;
  if (art === "ausflug") {
    const a = r.ausfluege.find((x) => x.id === id);
    const h = hafenVon(a?.hafenId);
    const bew = bewertungenZu("ausflug", id);
    return { titel: a?.titel ?? "", unter: [h?.name, h?.land].filter(Boolean).join(", "), fotos: bew.flatMap(oeffentlicheFotos), sterne: bew.length ? bew.reduce((s, b) => s + b.sterne, 0) / bew.length : null };
  }
  if (art === "hotel") {
    const ho = r.hotels?.find((x) => x.id === id);
    const bew = bewertungenZu("hotel", id);
    return { titel: ho?.name ?? "", unter: ho?.ort ?? "", fotos: bew.flatMap(oeffentlicheFotos), sterne: bew.length ? bew.reduce((s, b) => s + b.sterne, 0) / bew.length : null };
  }
  if (art === "tauchgang") {
    const t = zustand.beitraege.tauchgaenge.find((x) => x.id === id);
    return { titel: t?.tauchplatz ?? "Tauchgang", unter: [t?.ort, t?.maxTiefe != null ? `${t.maxTiefe} m` : "", t?.tauchzeitMin ? `${t.tauchzeitMin} Min.` : ""].filter(Boolean).join(" · "), fotos: oeffentlicheFotos(t), sterne: t?.sterne ?? null };
  }
  return { titel: r.name, unter: r.schiff ?? "", fotos: [...zustand.beitraege.bewertungen.flatMap(oeffentlicheFotos), ...zustand.beitraege.tauchgaenge.flatMap(oeffentlicheFotos)], sterne: null };
}

aktionen["teilen"] = async (el) => {
  const art = el.dataset.art;
  const id = art === "bericht" ? zustand.reise.id : el.dataset.id;
  const e = eckdaten(art, id);
  const was = { ausflug: "die Bewertungen und Fotos dieses Ausflugs", hotel: "die Bewertungen und Fotos dieser Unterkunft", tauchgang: "diesen Tauchgang mit Fotos", bericht: "alle Bewertungen, Tauchgänge und Fotos dieser Reise (ohne Kosten und Planung)" }[art];
  dialogOeffnen(`<div class="formular" id="teilenBox" data-art="${art}" data-id="${esc(id)}">
    <h3>Teilen: ${esc(e.titel)}</h3>
    <p class="leise klein">Der Link zeigt nur ${was}. Die übrige Reise, Kosten und Mitreisende bleiben privat, als 🔒 privat markierte Bewertungen erscheinen nicht. Du kannst die Freigabe jederzeit beenden.</p>
    ${art === "ausflug" || art === "hotel" ? `<label class="haken"><input type="checkbox" id="mitPreis"> Preis und Link zum Angebot mit anzeigen</label>` : ""}
    <div class="zeile"><button class="knopf" data-aktion="link-erstellen">Link erstellen</button></div>
    <div id="teilenLink"></div>
    <fieldset><legend>Für Instagram, TikTok &amp; Co.</legend>
      <p class="klein leise">Story-Bild (1080 × 1920) aus dem ersten Foto mit Titel und Sternen – zum Posten oder als Story.</p>
      <div class="zeile">
        <button class="knopf leise" data-aktion="story-bild" ${e.fotos.length ? "" : "disabled"}>${e.fotos.length ? "Story-Bild erstellen" : "Erst ein Foto hinzufügen"}</button>
        ${navigator.canShare ? `<button class="knopf leise" data-aktion="fotos-teilen" ${e.fotos.length ? "" : "disabled"}>Fotos an App senden</button>` : ""}
      </div>
      <div id="storyVorschau"></div>
      ${zustand.info.ki ? `<div class="zeile">
        <label class="klein">Beitragstext für <select id="plattform"><optgroup label="Social Media"><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="facebook">Facebook</option><option value="youtube">YouTube</option><option value="x">X</option></optgroup><optgroup label="Bewertung für andere"><option value="tripadvisor">Tripadvisor</option><option value="holidaycheck">HolidayCheck</option><option value="google">Google</option></optgroup></select></label>
        <select id="sprache" aria-label="Sprache"><option value="de">Deutsch</option><option value="en">Englisch</option></select>
        <button class="knopf leise" data-aktion="ki-beitrag">✨ Text mit KI schreiben</button>
      </div><textarea id="beitragText" rows="7" hidden></textarea><div class="zeile"><button class="knopf leise" data-aktion="text-kopieren" id="textKopieren" hidden>Text kopieren</button></div>` : ""}
    </fieldset>
    <div class="zeile"><span class="platz"></span><button class="knopf leise" data-aktion="dialog-zu">Schließen</button></div>
  </div>`);
  // Vorhandene Freigabe direkt anzeigen
  try {
    const vorhanden = (await anfrage(`/api/reisen/${zustand.reise.id}/freigaben`)).find((f) => f.art === art && f.zielId === id);
    if (vorhanden) linkZeigen(vorhanden, e);
    if (vorhanden && $("#mitPreis")) $("#mitPreis").checked = vorhanden.mitPreis;
  } catch {}
};

function linkZeigen(f, e) {
  const u = encodeURIComponent(f.url);
  const t = encodeURIComponent(`${e.titel}${e.unter ? ` – ${e.unter}` : ""}`);
  $("#teilenLink").innerHTML = `
    <div class="linkfeld"><input readonly value="${esc(f.url)}" onclick="this.select()"><button class="knopf leise" data-aktion="link-kopieren" data-url="${esc(f.url)}">Kopieren</button></div>
    <div class="links">
      ${navigator.share ? `<button class="linkchip" data-aktion="nativ-teilen" data-url="${esc(f.url)}" data-titel="${esc(e.titel)}">📤 Teilen …</button>` : ""}
      <a class="linkchip" style="--farbe:#25d366" href="https://wa.me/?text=${t}%20${u}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="linkchip" style="--farbe:#1877f2" href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener">Facebook</a>
      <a class="linkchip" style="--farbe:#000" href="https://twitter.com/intent/tweet?text=${t}&url=${u}" target="_blank" rel="noopener">X</a>
      <a class="linkchip" style="--farbe:#e60023" href="https://pinterest.com/pin/create/button/?url=${u}&description=${t}" target="_blank" rel="noopener">Pinterest</a>
      <a class="linkchip" style="--farbe:#229ed9" href="https://t.me/share/url?url=${u}&text=${t}" target="_blank" rel="noopener">Telegram</a>
      <a class="linkchip" style="--farbe:#555" href="mailto:?subject=${t}&body=${u}">E-Mail</a>
      <a class="linkchip" style="--farbe:#555" href="${esc(f.url)}" target="_blank" rel="noopener">Ansehen ↗</a>
    </div>
    <p class="klein leise">${f.aufrufe ? `${f.aufrufe}× aufgerufen · ` : ""}<button class="link rot" data-aktion="freigabe-beenden" data-token="${esc(f.token)}">Freigabe beenden</button></p>`;
  $("[data-aktion=link-erstellen]").textContent = "Link aktualisieren";
}

aktionen["link-erstellen"] = async () => {
  const box = $("#teilenBox");
  const f = await anfrage(`/api/reisen/${zustand.reise.id}/freigaben`, { method: "POST", body: { art: box.dataset.art, zielId: box.dataset.id, mitPreis: $("#mitPreis")?.checked ?? false } });
  linkZeigen(f, eckdaten(box.dataset.art, box.dataset.id));
};

aktionen["freigabe-beenden"] = async (el) => {
  if (!confirm("Freigabe beenden? Der Link funktioniert danach nicht mehr.")) return;
  await anfrage(`/api/freigaben/${el.dataset.token}`, { method: "DELETE" });
  $("#teilenLink").innerHTML = `<p class="klein leise">Freigabe beendet.</p>`;
  $("[data-aktion=link-erstellen]").textContent = "Neuen Link erstellen";
};

aktionen["link-kopieren"] = async (el) => {
  try {
    await navigator.clipboard.writeText(el.dataset.url);
    el.textContent = "Kopiert ✓";
  } catch {
    prompt("Link:", el.dataset.url);
  }
};

aktionen["nativ-teilen"] = (el) => navigator.share({ title: el.dataset.titel, url: el.dataset.url }).catch(() => {});

aktionen["text-kopieren"] = async () => {
  try {
    await navigator.clipboard.writeText($("#beitragText").value);
    $("#textKopieren").textContent = "Kopiert ✓";
  } catch {}
};

aktionen["ki-beitrag"] = async (el) => {
  const box = $("#teilenBox");
  el.disabled = true;
  el.textContent = "Schreibe …";
  try {
    const { text } = await anfrage(`/api/reisen/${zustand.reise.id}/beitragstext`, { method: "POST", body: { art: box.dataset.art, zielId: box.dataset.id, plattform: $("#plattform").value, sprache: $("#sprache").value } });
    $("#beitragText").hidden = false;
    $("#beitragText").value = text;
    $("#textKopieren").hidden = false;
  } catch (e) {
    alert(e.message);
  } finally {
    el.disabled = false;
    el.textContent = "✨ Text mit KI schreiben";
  }
};

async function bildLaden(url) {
  const blob = await fetch(url).then((r) => r.blob());
  return createImageBitmap(blob);
}

/** Story-Bild: Foto füllt das Hochformat, darunter Verlauf mit Titel, Ort, Sternen und Creator-Name. */
async function storyBild(art, id) {
  const e = eckdaten(art, id);
  const bild = await bildLaden(fotoUrl(e.fotos[0]));
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1920;
  const g = c.getContext("2d");
  const f = Math.max(c.width / bild.width, c.height / bild.height);
  g.drawImage(bild, (c.width - bild.width * f) / 2, (c.height - bild.height * f) / 2, bild.width * f, bild.height * f);
  const verlauf = g.createLinearGradient(0, c.height * 0.55, 0, c.height);
  verlauf.addColorStop(0, "rgba(0,0,0,0)");
  verlauf.addColorStop(1, "rgba(0,0,0,0.78)");
  g.fillStyle = verlauf;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#fff";
  g.textBaseline = "alphabetic";
  const zeilen = (text, max) => {
    const woerter = text.split(/\s+/);
    const out = [];
    let z = "";
    for (const w of woerter) {
      const probe = z ? `${z} ${w}` : w;
      if (g.measureText(probe).width > max && z) {
        out.push(z);
        z = w;
      } else z = probe;
    }
    if (z) out.push(z);
    return out.slice(0, 3);
  };
  let y = c.height - 150;
  const creator = zustand.ich?.creatorName;
  if (creator) {
    g.font = "600 40px system-ui, sans-serif";
    g.globalAlpha = 0.9;
    g.fillText(creator, 80, y);
    g.globalAlpha = 1;
    y -= 80;
  }
  if (e.sterne != null) {
    g.font = "64px system-ui, sans-serif";
    g.fillStyle = "#ffc93c";
    g.fillText("★".repeat(Math.round(e.sterne)) + "☆".repeat(5 - Math.round(e.sterne)), 80, y);
    g.fillStyle = "#fff";
    y -= 90;
  }
  if (e.unter) {
    g.font = "44px system-ui, sans-serif";
    g.fillText(`📍 ${e.unter}`.slice(0, 60), 80, y);
    y -= 80;
  }
  g.font = "700 84px system-ui, sans-serif";
  const titel = zeilen(e.titel, c.width - 160);
  for (let i = titel.length - 1; i >= 0; i--) {
    g.fillText(titel[i], 80, y);
    y -= 100;
  }
  return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
}

aktionen["story-bild"] = async (el) => {
  const box = $("#teilenBox");
  el.disabled = true;
  try {
    const blob = await storyBild(box.dataset.art, box.dataset.id);
    const datei = new File([blob], "story.jpg", { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    $("#storyVorschau").innerHTML = `<img src="${url}" alt="Story-Bild" class="storybild">
      <div class="zeile">${navigator.canShare?.({ files: [datei] }) ? `<button class="knopf" data-aktion="story-senden">An Instagram/TikTok … senden</button>` : ""}<button class="knopf leise" data-aktion="story-laden">Herunterladen</button></div>`;
    $("#storyVorschau").datei = datei;
  } catch (e) {
    alert(`Story-Bild ging nicht: ${e.message}`);
  } finally {
    el.disabled = false;
  }
};
aktionen["story-senden"] = () => navigator.share({ files: [$("#storyVorschau").datei] }).catch(() => {});
aktionen["story-laden"] = () => herunterladen("story.jpg", $("#storyVorschau").datei);

aktionen["fotos-teilen"] = async () => {
  const box = $("#teilenBox");
  const e = eckdaten(box.dataset.art, box.dataset.id);
  const dateien = await Promise.all(e.fotos.slice(0, 10).map(async (id, i) => new File([await fetch(fotoUrl(id)).then((r) => r.blob())], `foto-${i + 1}.jpg`, { type: "image/jpeg" })));
  if (navigator.canShare?.({ files: dateien })) navigator.share({ files: dateien, title: e.titel }).catch(() => {});
  else alert("Dein Browser kann keine Fotos an Apps weitergeben – bitte am Handy versuchen.");
};
