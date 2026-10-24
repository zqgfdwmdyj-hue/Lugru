// Weihnachts-Aktion: nur vom 15. Oktober bis 26. Dezember sichtbar (Vorschau: ?weihnachten=1).
(() => {
  "use strict";
  const sec = document.getElementById("weihnachten");
  if (!sec) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  const preview = new URLSearchParams(location.search).has("weihnachten");
  const start = new Date(y, 9, 15), end = new Date(y, 11, 26);
  if (!preview && (today < start || today > end)) return;

  sec.hidden = false;

  // Hero-Hinweis passend zur Saison
  const pill = document.querySelector(".hero .pill");
  if (pill) pill.textContent = "🎄 Geschenkideen für Nikolaus & Weihnachten";

  // Countdown: erst Nikolaus, danach Heiligabend
  const days = (d) => Math.round((d - today) / 86_400_000);
  const niko = new Date(y, 11, 6), heilig = new Date(y, 11, 24);
  const el = document.getElementById("xmasCount");
  const dn = days(niko), dh = days(heilig);
  if (dn > 1) el.textContent = `Noch ${dn} Tage bis Nikolaus · ${dh} Tage bis Heiligabend`;
  else if (dn === 1) el.textContent = "Morgen ist Nikolaus! 🎅";
  else if (dn === 0) el.textContent = "Heute ist Nikolaus! 🎅";
  else if (dh > 1) el.textContent = `Noch ${dh} Tage bis Heiligabend`;
  else if (dh >= 0) el.textContent = dh === 1 ? "Morgen ist Heiligabend! 🎄" : "Frohe Weihnachten! 🎄";
  else el.textContent = "Frohe Weihnachten und ein buntes neues Jahr! 🎆";

  // Firmenanfrage mit vorausgefüllter E-Mail
  const body = "Guten Tag,\n\nwir interessieren uns für GRULU-Boxen als Weihnachtsgeschenk.\n\nFirma:\nAnzahl Boxen:\nGewünschter Liefertermin:\nMit Logo-Grußkarte (ja/nein):\n\nViele Grüße";
  const b2b = document.getElementById("xmasB2b");
  if (b2b) b2b.href = "mailto:hallo@grulu-box.de?subject=" + encodeURIComponent("Anfrage Firmen-Weihnachtsgeschenke") + "&body=" + encodeURIComponent(body);

  // Leichter Schneefall (nicht bei „weniger Bewegung“)
  const snow = sec.querySelector(".snow");
  if (snow && !window.GRULU.reduced) {
    for (let i = 0; i < 26; i++) {
      const f = document.createElement("i");
      f.textContent = i % 3 ? "❄" : "✦";
      f.style.left = Math.random() * 100 + "%";
      f.style.animationDuration = 6 + Math.random() * 8 + "s";
      f.style.animationDelay = -Math.random() * 12 + "s";
      f.style.fontSize = 10 + Math.random() * 14 + "px";
      snow.appendChild(f);
    }
  }
})();
