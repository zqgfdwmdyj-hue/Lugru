// Ausmalbild: GRULU als Umrisszeichnung, Flächen per Tippen füllen, als PNG speichern.
(() => {
  "use strict";
  const canvas = document.getElementById("paintCanvas");
  if (!canvas) return;
  const { pop, confetti } = window.GRULU;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;

  const COLORS = ["#7b3fe4", "#b88cff", "#ff2a6d", "#ff8ac2", "#ff8a00", "#ffd23f", "#2ecc71", "#7be0a5", "#2f8cff", "#8fd3ff", "#8b5a2b", "#ffffff"];
  let color = COLORS[0];
  const undo = [];

  // Linien: geschlossene Flächen, damit das Füllen sauber stoppt. Reihenfolge = Ebenen (hinten zuerst).
  const S = 'fill="#fff" stroke="#231942" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"';
  const L = 'fill="none" stroke="#231942" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"';
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">
    <rect width="600" height="600" fill="#fff"/>
    <!-- Sterne und Bonbons -->
    <path ${S} d="M70 70 l14 30 32 4 -24 22 7 32 -29-16 -29 16 7-32 -24-22 32-4z"/>
    <path ${S} d="M520 60 l10 22 24 3 -18 16 5 24 -21-12 -21 12 5-24 -18-16 24-3z"/>
    <path ${S} d="M545 300 l8 17 19 2 -14 13 4 19 -17-10 -17 10 4-19 -14-13 19-2z"/>
    <path ${S} d="M60 300 q-22 -14 -36 0 q14 14 36 0z"/><path ${S} d="M120 300 q22 -14 36 0 q-14 14 -36 0z"/><circle ${S} cx="90" cy="300" r="30"/>
    <path ${S} d="M84 330 h12 v120 h-12z"/>
    <circle ${S} cx="90" cy="300" r="16"/>
    <!-- Regenbogen-Schwanz -->
    <path ${S} d="M400 470 C520 500 590 400 540 300 C520 260 470 270 480 320 C490 380 450 420 400 410 Z"/>
    <path ${L} d="M420 440 C500 450 545 390 515 320"/>
    <path ${L} d="M410 425 C480 425 515 375 500 330"/>
    <!-- Ohren -->
    <path ${S} d="M205 175 L150 30 L275 125 Z"/><path ${S} d="M213 155 L175 70 L250 130 Z"/>
    <path ${S} d="M395 175 L450 30 L325 125 Z"/><path ${S} d="M387 155 L425 70 L350 130 Z"/>
    <!-- Körper -->
    <ellipse ${S} cx="300" cy="400" rx="135" ry="150"/>
    <ellipse ${S} cx="300" cy="425" rx="78" ry="100"/>
    <!-- Arme -->
    <ellipse ${S} cx="175" cy="380" rx="32" ry="62" transform="rotate(25 175 380)"/>
    <ellipse ${S} cx="425" cy="350" rx="32" ry="62" transform="rotate(-40 425 350)"/>
    <!-- Füße -->
    <ellipse ${S} cx="225" cy="540" rx="58" ry="34"/><ellipse ${S} cx="375" cy="540" rx="58" ry="34"/>
    <ellipse ${S} cx="225" cy="545" rx="22" ry="15"/><ellipse ${S} cx="375" cy="545" rx="22" ry="15"/>
    <circle ${S} cx="190" cy="525" r="9"/><circle ${S} cx="208" cy="512" r="9"/><circle ${S} cx="242" cy="512" r="9"/><circle ${S} cx="260" cy="525" r="9"/>
    <circle ${S} cx="340" cy="525" r="9"/><circle ${S} cx="358" cy="512" r="9"/><circle ${S} cx="392" cy="512" r="9"/><circle ${S} cx="410" cy="525" r="9"/>
    <!-- Kopf -->
    <circle ${S} cx="300" cy="215" r="112"/>
    <!-- Pilze -->
    <path ${S} d="M218 118 h20 v30 h-20z"/><path ${S} d="M180 122 Q228 50 276 122 Z"/>
    <circle ${S} cx="214" cy="104" r="7"/><circle ${S} cx="240" cy="96" r="8"/><circle ${S} cx="256" cy="113" r="5"/>
    <path ${S} d="M352 112 h16 v28 h-16z"/><path ${S} d="M322 116 Q360 58 398 116 Z"/>
    <circle ${S} cx="350" cy="100" r="6"/><circle ${S} cx="372" cy="94" r="7"/>
    <!-- Gesicht -->
    <ellipse ${S} cx="258" cy="205" rx="32" ry="36"/><ellipse ${S} cx="342" cy="205" rx="32" ry="36"/>
    <circle cx="262" cy="212" r="17" fill="#231942"/><circle cx="346" cy="212" r="17" fill="#231942"/>
    <circle cx="268" cy="204" r="6" fill="#fff"/><circle cx="352" cy="204" r="6" fill="#fff"/>
    <ellipse ${S} cx="300" cy="252" rx="15" ry="10"/>
    <path ${S} d="M262 272 Q300 318 338 272 Z"/>
    <path ${S} d="M285 286 Q300 300 315 286 Q300 310 285 286 Z"/>
    <ellipse ${S} cx="222" cy="262" rx="18" ry="11"/><ellipse ${S} cx="378" cy="262" rx="18" ry="11"/>
    <!-- Bauchfell-Locken -->
    <path ${L} d="M270 360 q15 15 30 0 q15 15 30 0"/>
  </svg>`;

  // Palette
  const pal = document.getElementById("palette");
  COLORS.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "swatch"; b.style.background = c;
    b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(i === 0));
    b.setAttribute("aria-label", "Farbe " + (i + 1));
    b.addEventListener("click", () => {
      color = c;
      pal.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-checked", String(s === b)));
    });
    pal.appendChild(b);
  });

  let ready = false;
  function drawBase() {
    const img = new Image();
    img.onload = () => { ctx.clearRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H); ready = true; undo.length = 0; };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(SVG);
  }
  drawBase();

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // Füllen per Scanline. Dunkle Pixel (Linien) stoppen, ähnliche Farben werden mitgefüllt (glättet Kanten).
  function fill(x0, y0) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const at = (x, y) => (y * W + x) * 4;
    const s = at(x0, y0);
    const sr = d[s], sg = d[s + 1], sb = d[s + 2];
    const dark = (i) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 90;
    if (dark(s)) return false;
    const [fr, fg, fb] = hex(color);
    if (Math.abs(sr - fr) + Math.abs(sg - fg) + Math.abs(sb - fb) < 6) return false;
    undo.push(ctx.getImageData(0, 0, W, H)); if (undo.length > 15) undo.shift();
    const seen = new Uint8Array(W * H);
    const match = (i, p) => !seen[p] && !dark(i) && Math.abs(d[i] - sr) + Math.abs(d[i + 1] - sg) + Math.abs(d[i + 2] - sb) < 120;
    const stack = [[x0, y0]];
    while (stack.length) {
      let [x, y] = stack.pop();
      while (x >= 0 && match(at(x, y), y * W + x)) x--;
      x++;
      let up = false, down = false;
      while (x < W && match(at(x, y), y * W + x)) {
        const i = at(x, y);
        d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255; seen[y * W + x] = 1;
        if (y > 0) { const m = match(at(x, y - 1), (y - 1) * W + x); if (m && !up) { stack.push([x, y - 1]); up = true; } else if (!m) up = false; }
        if (y < H - 1) { const m = match(at(x, y + 1), (y + 1) * W + x); if (m && !down) { stack.push([x, y + 1]); down = true; } else if (!m) down = false; }
        x++;
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!ready) return;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) * W / r.width), y = Math.floor((e.clientY - r.top) * H / r.height);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (fill(x, y)) pop();
  });

  document.getElementById("paintUndo").addEventListener("click", () => { const last = undo.pop(); if (last) ctx.putImageData(last, 0, 0); });
  document.getElementById("paintReset").addEventListener("click", () => { if (undo.length === 0 || confirm("Bild wirklich neu anfangen?")) drawBase(); });
  document.getElementById("paintSave").addEventListener("click", () => {
    // Mit kleinem GRULU-Schriftzug unten rechts speichern
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    const o = out.getContext("2d"); o.drawImage(canvas, 0, 0);
    o.font = "600 18px Fredoka, sans-serif"; o.fillStyle = "#6a35d9"; o.textAlign = "right"; o.fillText("grulu-box.de", W - 14, H - 12);
    out.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "mein-grulu.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      confetti(20);
    }, "image/png");
  });
})();
