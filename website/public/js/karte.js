// Grußkarte: Text + Anlass → buntes Bild (1080×1350) zum Teilen oder Speichern.
(() => {
  "use strict";
  const canvas = document.getElementById("cardCanvas");
  if (!canvas) return;
  const { confetti } = window.GRULU;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const form = document.getElementById("cardForm");

  const MOTIFS = {
    geburtstag: { title: "Alles Gute!", colors: ["#ff2a6d", "#ff8a00"], deco: ["🎂", "🎈", "🎁", "🎉"], text: "Alles Liebe zu deinem Geburtstag – auf ein Jahr voller Überraschungen!" },
    schule: { title: "Hurra, Schulkind!", colors: ["#2f8cff", "#6a35d9"], deco: ["🎒", "✏️", "📚", "⭐"], text: "Alles Gute zur Einschulung! Viel Spaß beim Lernen und Entdecken." },
    danke: { title: "Danke!", colors: ["#6a35d9", "#ff8ac2"], deco: ["💜", "🌸", "✨", "🍬"], text: "Danke, dass es dich gibt!" },
    einfach: { title: "Hallo du!", colors: ["#2ecc71", "#2f8cff"], deco: ["🌈", "🍭", "⭐", "🍩"], text: "Ich denk an dich – eine kleine Überraschung für zwischendurch!" },
  };

  const mascot = new Image();
  mascot.src = "/img/grulu-768x525.webp";

  function wrap(text, maxW) {
    const words = text.split(/\s+/), lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw() {
    const f = Object.fromEntries(new FormData(form));
    const m = MOTIFS[f.motif] || MOTIFS.geburtstag;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, m.colors[0]); g.addColorStop(1, m.colors[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Deko-Emojis am Rand
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "90px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
    const spots = [[110, 110], [970, 120], [90, 700], [990, 640], [140, 1250], [950, 1250], [540, 70]];
    spots.forEach(([x, y], i) => ctx.fillText(m.deco[i % m.deco.length], x, y));

    // Maskottchen in weißer Karte
    roundRect(110, 190, 860, 590, 50); ctx.fillStyle = "#fff"; ctx.fill();
    if (mascot.complete && mascot.naturalWidth) {
      ctx.save(); roundRect(130, 210, 820, 550, 38); ctx.clip();
      ctx.drawImage(mascot, 130, 210, 820, 560); ctx.restore();
    }

    // Titel
    ctx.fillStyle = "#fff"; ctx.font = "700 96px Fredoka, sans-serif";
    ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
    const to = (f.to || "").trim();
    ctx.fillText(to ? `${m.title.replace("!", "")}, ${to}!` : m.title, W / 2, 880, W - 120);
    ctx.shadowColor = "transparent";

    // Gruß
    ctx.font = "600 50px Nunito, sans-serif";
    const lines = wrap((f.text || "").trim() || m.text, W - 200).slice(0, 4);
    lines.forEach((l, i) => ctx.fillText(l, W / 2, 990 + i * 64));

    const from = (f.from || "").trim();
    if (from) { ctx.font = "700 46px Fredoka, sans-serif"; ctx.fillText("– " + from, W / 2, 1000 + lines.length * 64 + 30); }

    ctx.font = "600 34px Fredoka, sans-serif"; ctx.globalAlpha = 0.85;
    ctx.fillText("grulu-box.de", W / 2, H - 50); ctx.globalAlpha = 1;
  }

  form.addEventListener("input", draw);
  form.addEventListener("change", draw);
  mascot.onload = draw;
  document.fonts?.ready.then(draw);
  draw();

  const toBlob = () => new Promise((r) => canvas.toBlob(r, "image/png"));
  function download(blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "grulu-grusskarte.png"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.getElementById("cardSave").addEventListener("click", async () => { download(await toBlob()); confetti(16); });
  document.getElementById("cardShare").addEventListener("click", async () => {
    const blob = await toBlob();
    const file = new File([blob], "grulu-grusskarte.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "GRULU-Grußkarte", text: "Eine Karte für dich 💜 grulu-box.de" }); confetti(16); }
      catch { /* abgebrochen */ }
      return;
    }
    // Ohne Teilen-Funktion (z. B. am PC): Bild speichern und WhatsApp mit Text öffnen
    download(blob);
    const f = Object.fromEntries(new FormData(form));
    const text = `${(f.text || "").trim() || MOTIFS[f.motif].text} 💜 – Karte gemacht auf https://www.grulu-box.de`;
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
  });
})();
