// TikTok-Bereich (lädt erst nach Klick, wegen Datenschutz) und Unboxing-Galerie.
(() => {
  "use strict";
  const { confetti } = window.GRULU;

  /* ---------- TikTok ---------- */
  // Hier euren TikTok-Kanal eintragen (ohne @). Leer = Bereich zeigt „bald“.
  const TIKTOK_HANDLE = "wigru0";
  // Während eines Live-Shoppings auf true setzen.
  const TIKTOK_LIVE = false;

  const follow = document.getElementById("ttFollow");
  const embed = document.getElementById("ttEmbed");
  if (embed) {
    if (!TIKTOK_HANDLE) {
      embed.innerHTML = '<div class="tt-consent"><p>🎬 Unser TikTok-Kanal startet bald – mit Unboxings und Live Shopping!</p><a class="btn btn-sm" href="#newsletter">🔔 Bescheid geben</a></div>';
    } else {
      const url = `https://www.tiktok.com/@${TIKTOK_HANDLE}`;
      follow.href = url; follow.hidden = false;
      if (TIKTOK_LIVE) { const live = document.getElementById("ttLive"); live.hidden = false; follow.href = url + "/live"; follow.textContent = "🔴 Jetzt live zuschauen"; }
      document.getElementById("ttLoad").addEventListener("click", () => {
        embed.innerHTML = `<blockquote class="tiktok-embed" cite="${url}" data-unique-id="${TIKTOK_HANDLE}" data-embed-type="creator"><section><a target="_blank" rel="noopener" href="${url}">@${TIKTOK_HANDLE}</a></section></blockquote>`;
        const s = document.createElement("script");
        s.src = "https://www.tiktok.com/embed.js"; s.async = true;
        document.body.appendChild(s);
      });
    }
  }

  /* ---------- Galerie ---------- */
  const gallery = document.getElementById("gallery");
  if (!gallery) return;

  async function loadGallery() {
    try {
      const res = await fetch("/api/gallery");
      if (!res.ok) throw new Error();
      const { items } = await res.json();
      if (!items.length) throw new Error("leer");
      gallery.replaceChildren(...items.map((it) => {
        const fig = document.createElement("figure");
        const img = Object.assign(document.createElement("img"), { src: it.url, alt: it.caption || "Unboxing einer GRULU-Box", loading: "lazy", width: 400, height: 400 });
        const cap = document.createElement("figcaption");
        cap.textContent = [it.caption, it.name && "– " + it.name].filter(Boolean).join(" ");
        fig.append(img); if (cap.textContent) fig.append(cap);
        return fig;
      }));
    } catch {
      gallery.innerHTML = '<p class="gallery-empty">📦 Noch keine Fotos – sei die oder der Erste!</p>';
    }
  }
  loadGallery();

  const form = document.getElementById("uploadForm");
  const fileIn = form.querySelector('input[type="file"]');
  const preview = document.getElementById("uploadPreview");
  const pick = document.getElementById("uploadPick");
  const msg = document.getElementById("uploadMsg");
  let prepared = null;

  // Bild im Browser verkleinern und neu speichern – entfernt dabei auch Standortdaten (EXIF).
  async function prepare(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
    if (!bmp) throw new Error("Dieses Bild kann leider nicht gelesen werden.");
    const max = 1280, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
  }

  fileIn.addEventListener("change", async () => {
    msg.textContent = ""; prepared = null;
    const f = fileIn.files[0];
    if (!f) return;
    try {
      prepared = await prepare(f);
      preview.src = URL.createObjectURL(prepared); preview.hidden = false;
      pick.textContent = "Anderes Foto wählen";
    } catch (err) { msg.textContent = err.message; }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!prepared) { msg.textContent = "Bitte zuerst ein Foto auswählen."; return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; msg.textContent = "Wird hochgeladen …";
    try {
      const params = new URLSearchParams({ name: form.elements.namedItem("name").value.trim(), caption: form.elements.namedItem("caption").value.trim(), consent: "1" });
      const res = await fetch("/api/gallery?" + params, { method: "POST", headers: { "content-type": "image/jpeg" }, body: prepared });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Das hat leider nicht geklappt.");
      msg.textContent = "Danke! 🎉 Wir schauen uns dein Foto kurz an und zeigen es dann hier.";
      form.reset(); preview.hidden = true; prepared = null; pick.textContent = "Foto auswählen";
      confetti(24);
    } catch (err) { msg.textContent = err.message; }
    btn.disabled = false;
  });
})();
