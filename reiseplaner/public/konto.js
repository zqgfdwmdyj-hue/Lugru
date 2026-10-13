// Anmelden, Einrichtung, Einladungen annehmen, eigenes Profil und Konten-Verwaltung.
import { zustand, $, esc, anfrage, aktionen, dialogOeffnen, dialog, lokalMerken, lokalHolen } from "./kern.js";

const startEl = () => $("#start");

function zeigeStart(html) {
  document.body.classList.add("abgemeldet");
  startEl().hidden = false;
  startEl().innerHTML = `<div class="startkarte"><div class="marke gross">⚓ Reiseplaner</div>${html}<p class="klein leise"><a href="/tagebuch">🌍 Unser öffentliches Reisetagebuch ansehen</a></p></div>`;
}

function versteckeStart() {
  document.body.classList.remove("abgemeldet");
  startEl().hidden = true;
  startEl().innerHTML = "";
}

function formular(id, felder, knopf, fusszeile = "") {
  return `<form id="${id}" class="formular">
    ${felder}
    <p class="warnung klein" id="${id}Fehler" role="alert"></p>
    <button class="knopf">${knopf}</button>
    ${fusszeile}
  </form>`;
}

const FELD_NAME = `<label>Dein Name<input name="name" autocomplete="name" required maxlength="80"></label>`;
const FELD_EMAIL = `<label>E-Mail<input name="email" type="email" autocomplete="email" required></label>`;
const FELD_PW_NEU = `<label>Passwort (mind. 8 Zeichen)<input name="passwort" type="password" autocomplete="new-password" minlength="8" required></label>`;

function absenden(id, fn) {
  const form = $(`#${id}`);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const knopf = form.querySelector("button");
    knopf.disabled = true;
    $(`#${id}Fehler`).textContent = "";
    try {
      await fn(Object.fromEntries(new FormData(form)));
    } catch (err) {
      $(`#${id}Fehler`).textContent = err.message;
    } finally {
      knopf.disabled = false;
    }
  });
}

/**
 * Prüft die Anmeldung. Gibt das Konto zurück oder zeigt Anmeldung/Einrichtung/Einladung
 * und ruft danach weiter() auf.
 */
export async function anmeldungPruefen(weiter) {
  let info;
  try {
    info = await anfrage("/api/ich");
    if (info.benutzer) lokalMerken("ich", info);
  } catch (e) {
    // Ohne Internet: mit der zuletzt bekannten Anmeldung weiter (Daten kommen dann vom Gerät)
    info = e.status === 0 ? lokalHolen("ich") : null;
    if (!info) throw e;
  }
  zustand.info = info;
  const einladung = /^\/einladung\/([A-Za-z0-9_-]{20,64})$/.exec(location.pathname)?.[1];
  if (einladung) return einladungZeigen(einladung, info, weiter);
  if (info.einrichtung) {
    zeigeStart(`<h2>Einrichten</h2><p class="leise">Lege das erste Konto an (Verwaltung). Den Einrichtungscode findest du im Server-Log (<code>docker compose logs reiseplaner</code>).</p>
      ${formular("einrichtung", `<label>Einrichtungscode<input name="code" required autocomplete="off"></label>${FELD_NAME}${FELD_EMAIL}${FELD_PW_NEU}`, "Konto anlegen")}`);
    absenden("einrichtung", async (d) => {
      const r = await anfrage("/api/einrichtung", { method: "POST", body: d });
      zustand.ich = r.benutzer;
      versteckeStart();
      weiter();
    });
    return null;
  }
  if (!info.benutzer) {
    anmeldenZeigen(weiter);
    return null;
  }
  zustand.ich = info.benutzer;
  versteckeStart();
  return info.benutzer;
}

export function anmeldenZeigen(weiter) {
  zustand.ich = null;
  zeigeStart(`<h2>Anmelden</h2>
    ${formular("anmelden", `${FELD_EMAIL}<label>Passwort<input name="passwort" type="password" autocomplete="current-password" required></label>`, "Anmelden", `<p class="leise klein">Noch kein Konto? Lass dir von der Person, die die Reise plant, einen Einladungslink schicken.</p>`)}`);
  absenden("anmelden", async (d) => {
    const r = await anfrage("/api/anmelden", { method: "POST", body: d });
    zustand.ich = r.benutzer;
    versteckeStart();
    weiter();
  });
}

async function einladungZeigen(t, info, weiter) {
  let e;
  try {
    e = await anfrage(`/api/einladung/${t}`);
  } catch (err) {
    zeigeStart(`<h2>Einladung</h2><p class="warnung">${esc(err.message)}</p><a class="knopf" href="/">Zur Anmeldung</a>`);
    return null;
  }
  const kopf = e.reise
    ? `<h2>Einladung zur Reise „${esc(e.reise)}“</h2><p class="leise">${esc(e.von)} lädt dich ein${e.person ? ` (als ${esc(e.person)})` : ""}.</p>`
    : `<h2>Einladung zum Reiseplaner</h2><p class="leise">${esc(e.von)} lädt dich ein, ein eigenes Konto anzulegen – mit eigenen Reisen, eigener Weltkarte und eigenem Tagebuch.</p>`;
  const fertig = (r) => {
    history.replaceState(null, "", "/");
    try {
      if (r.reiseId) localStorage.setItem("reiseplaner:letzte", r.reiseId);
    } catch {}
    zustand.ich = r.benutzer;
    versteckeStart();
    weiter();
  };
  if (info.benutzer && !e.reise) {
    zeigeStart(`${kopf}<p>Du bist schon angemeldet als <strong>${esc(info.benutzer.name)}</strong> – diese Einladung ist für ein neues Konto.</p><a class="knopf" href="/">Zum Reiseplaner</a>`);
    return null;
  }
  if (info.benutzer) {
    zeigeStart(`${kopf}${formular("annehmen", `<p>Angemeldet als <strong>${esc(info.benutzer.name)}</strong>.</p>`, "Einladung annehmen")}`);
    absenden("annehmen", async () => fertig(await anfrage(`/api/einladung/${t}`, { method: "POST", body: {} })));
    return null;
  }
  zeigeStart(`${kopf}
    ${formular("neuesKonto", `<input type="hidden" name="x">${FELD_NAME.replace('required', `required value="${esc(e.person)}"`)}${FELD_EMAIL}${FELD_PW_NEU}`, e.reise ? "Konto anlegen und beitreten" : "Konto anlegen",
      `<p class="leise klein">Schon ein Konto? <button type="button" class="link" id="lieberAnmelden">Erst anmelden</button>, dann den Link erneut öffnen.</p>`)}`);
  $("#lieberAnmelden").onclick = () => {
    anmeldenZeigen(() => location.reload());
  };
  absenden("neuesKonto", async (d) => fertig(await anfrage(`/api/einladung/${t}`, { method: "POST", body: d })));
  return null;
}

// ---------- Profil ----------

aktionen["profil"] = () => {
  const ich = zustand.ich;
  dialogOeffnen(`<form class="formular" id="profilForm">
    <h3>Mein Konto</h3>
    <p class="leise klein">${esc(ich.email)}${ich.admin ? " · Verwaltung" : ""}</p>
    <label>Name<input name="name" value="${esc(ich.name)}" required maxlength="80"></label>
    <div class="formular zwei">
      <label>Tauchgänge vor dieser App<input name="tauchVorher" type="number" min="0" value="${esc(ich.tauchVorher ?? 0)}"><span class="klein">für die fortlaufende Nummer im Logbuch</span></label>
      <label>Creator-Name (Social Media)<input name="creatorName" value="${esc(ich.creatorName ?? "")}" placeholder="@unsere.reisen"></label>
    </div>
    <details><summary>Passwort ändern</summary>
      <div class="formular zwei">
        <label>Bisheriges Passwort<input name="altesPasswort" type="password" autocomplete="current-password"></label>
        <label>Neues Passwort<input name="passwort" type="password" autocomplete="new-password" minlength="8"></label>
      </div>
    </details>
    <p class="warnung klein" id="profilFehler"></p>
    <div class="zeile">
      <button type="button" class="knopf leise" data-aktion="abmelden">Abmelden</button>
      ${ich.admin ? `<button type="button" class="knopf leise" data-aktion="konten">Alle Konten</button>` : ""}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Schließen</button>
      <button class="knopf">Speichern</button>
    </div>
  </form>`);
  $("#profilForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (!d.passwort) delete d.passwort;
    try {
      zustand.ich = (await anfrage("/api/ich", { method: "PUT", body: d })).benutzer;
      dialog().close();
      $("#ichKnopf").textContent = zustand.ich.name;
    } catch (err) {
      $("#profilFehler").textContent = err.message;
    }
  });
};

aktionen["abmelden"] = async () => {
  await anfrage("/api/abmelden", { method: "POST" }).catch(() => {});
  // Lokale Kopien der Reisen und KI-Merker vom Gerät entfernen (z. B. geliehenes Handy)
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("reiseplaner:")) localStorage.removeItem(k);
  } catch {}
  location.href = "/";
};

aktionen["konten"] = async () => {
  const liste = await anfrage("/api/benutzer");
  dialogOeffnen(`<div class="formular">
    <h3>Alle Konten</h3>
    <p class="leise klein">Neue Konten entstehen über Einladungslinks: zu einer Reise (Reise → Reisende → Einladen) oder hier als eigenes Konto ohne Reise – die Person plant dann eigene Reisen mit eigener Weltkarte und eigenem Tagebuch.</p>
    <div class="zeile"><button class="knopf" data-aktion="konto-einladung">+ Einladung für ein eigenes Konto</button></div><div id="kontoEinladung"></div>
    <div class="tabelle"><table><thead><tr><th>Name</th><th>E-Mail</th><th></th></tr></thead><tbody>
      ${liste.map((b) => `<tr><td>${esc(b.name)}${b.admin ? ' <span class="abzeichen">Verwaltung</span>' : ""}</td><td>${esc(b.email)}</td><td>${b.id === zustand.ich.id ? "" : `<button class="link rot" data-aktion="konto-loeschen" data-id="${esc(b.id)}">Löschen</button>`}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="zeile"><span class="platz"></span><button class="knopf leise" data-aktion="dialog-zu">Schließen</button></div>
  </div>`);
};

aktionen["konto-einladung"] = async (el) => {
  el.disabled = true;
  try {
    const { link } = await anfrage("/api/konto-einladung", { method: "POST" });
    $("#kontoEinladung").innerHTML = `<p class="klein">Gilt einmal und 14 Tage – z. B. per WhatsApp schicken:</p><div class="linkfeld"><input readonly value="${esc(link)}" onclick="this.select()"><button class="knopf leise" data-aktion="link-kopieren" data-url="${esc(link)}">Kopieren</button></div>`;
  } catch (e) {
    alert(e.message);
  } finally {
    el.disabled = false;
  }
};

aktionen["konto-loeschen"] = async (el) => {
  if (!confirm("Konto löschen? Die Person kann sich danach nicht mehr anmelden. Ihre Bewertungen bleiben erhalten.")) return;
  await anfrage(`/api/benutzer/${el.dataset.id}`, { method: "DELETE" });
  aktionen["konten"]();
};
