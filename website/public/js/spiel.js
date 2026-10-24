// Mini-Spiel „Süßigkeiten-Fang“: GRULU fängt fallende Süßigkeiten, Brokkoli kostet ein Leben.
(() => {
  "use strict";
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const { store, pop, confetti } = window.GRULU;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const overlay = document.getElementById("gameOverlay");
  const msg = document.getElementById("gameMsg");
  const startBtn = document.getElementById("gameStart");
  const bestEl = document.getElementById("gameBest");

  let best = Number(store.get("grulu-best") || 0);
  bestEl.textContent = best;

  // GRULU-Figur aus dem Maskottchen-Bild ausschneiden
  const sprite = new Image();
  sprite.src = "/img/grulu-768x525.webp";
  const CROP = { x: 30, y: 30, w: 290, h: 290 };
  const PW = 110, PH = 110;

  const GOOD = [["🍬", 1], ["🍭", 1], ["🍫", 1], ["🍩", 1], ["⭐", 2], ["💥", 3]];
  let state = "idle", player, items, score, lives, speed, spawnIn, last, raf, floats, keys = {};

  function reset() {
    player = { x: W / 2, target: W / 2 };
    items = []; floats = [];
    score = 0; lives = 3; speed = 150; spawnIn = 0.4;
  }

  function spawn() {
    const bad = Math.random() < Math.min(0.12 + score / 400, 0.3);
    const [e, pts] = bad ? ["🥦", 0] : GOOD[Math.random() < 0.08 ? 5 : Math.floor(Math.random() * 5)];
    items.push({ x: 30 + Math.random() * (W - 60), y: -30, e, pts, bad, vy: speed * (0.8 + Math.random() * 0.5), rot: Math.random() * 6, spin: (Math.random() - 0.5) * 4 });
  }

  function update(dt) {
    if (keys.ArrowLeft) player.target -= 420 * dt;
    if (keys.ArrowRight) player.target += 420 * dt;
    player.target = Math.max(PW / 2, Math.min(W - PW / 2, player.target));
    player.x += (player.target - player.x) * Math.min(1, dt * 14);

    speed += dt * 4;
    spawnIn -= dt;
    if (spawnIn <= 0) { spawn(); spawnIn = Math.max(0.28, 0.9 - score / 120) * (0.7 + Math.random() * 0.6); }

    const py = H - PH - 10;
    for (const it of items) {
      it.y += it.vy * dt; it.rot += it.spin * dt;
      const caught = it.y > py + 10 && it.y < py + 60 && Math.abs(it.x - player.x) < PW / 2;
      if (caught) {
        it.dead = true;
        if (it.bad) { lives--; floats.push({ x: it.x, y: py, t: "Igitt! 🥦", c: "#2ecc71", life: 1 }); if (navigator.vibrate) navigator.vibrate(80); }
        else { score += it.pts; pop(); floats.push({ x: it.x, y: py, t: "+" + it.pts, c: it.pts > 1 ? "#ff2a6d" : "#ffb400", life: 1 }); }
      } else if (it.y > H + 40) it.dead = true;
    }
    items = items.filter((i) => !i.dead);
    for (const f of floats) { f.y -= 50 * dt; f.life -= dt; }
    floats = floats.filter((f) => f.life > 0);
    if (lives <= 0) end();
  }

  function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a1460"); g.addColorStop(1, "#6a35d9");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Sterne im Hintergrund
    ctx.fillStyle = "rgba(255,255,255,.5)";
    for (let i = 0; i < 30; i++) ctx.fillRect((i * 97) % W, (i * 53 + (performance.now() / 60) * (i % 3 + 1) * 0.2) % H, 2, 2);

    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "34px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
    for (const it of items) { ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.rot); ctx.fillText(it.e, 0, 0); ctx.restore(); }

    const py = H - PH - 10;
    if (sprite.complete && sprite.naturalWidth) {
      ctx.save(); ctx.beginPath(); ctx.arc(player.x, py + PH / 2, PW / 2, 0, Math.PI * 2); ctx.closePath();
      ctx.fillStyle = "#fff"; ctx.fill(); ctx.clip();
      ctx.drawImage(sprite, CROP.x, CROP.y, CROP.w, CROP.h, player.x - PW / 2, py, PW, PH);
      ctx.restore();
      ctx.lineWidth = 4; ctx.strokeStyle = "#ffb400"; ctx.beginPath(); ctx.arc(player.x, py + PH / 2, PW / 2, 0, Math.PI * 2); ctx.stroke();
    } else { ctx.font = "70px sans-serif"; ctx.fillText("🟣", player.x, py + PH / 2); }

    for (const f of floats) { ctx.globalAlpha = Math.max(0, f.life); ctx.fillStyle = f.c; ctx.font = "700 26px Fredoka, sans-serif"; ctx.fillText(f.t, f.x, f.y); }
    ctx.globalAlpha = 1;

    ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = "700 26px Fredoka, sans-serif";
    ctx.fillText("🍬 " + score, 16, 30);
    ctx.textAlign = "right"; ctx.fillText("💜".repeat(Math.max(0, lives)), W - 16, 30);
  }

  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (state !== "play") return;
    update(dt); draw();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    reset(); state = "play"; overlay.hidden = true;
    last = performance.now(); raf = requestAnimationFrame(loop);
    canvas.focus({ preventScroll: true });
  }

  function end() {
    state = "over"; cancelAnimationFrame(raf); draw();
    const record = score > best;
    if (record) { best = score; store.set("grulu-best", String(best)); bestEl.textContent = best; confetti(30); }
    msg.textContent = record ? `Neuer Rekord: ${score} Punkte! 🏆` : `${score} Punkte! Schaffst du mehr als ${best}?`;
    startBtn.textContent = "↺ Nochmal";
    overlay.hidden = false;
  }

  function pause() {
    if (state !== "play") return;
    state = "paused"; cancelAnimationFrame(raf);
    msg.textContent = "Pause"; startBtn.textContent = "▶ Weiter"; overlay.hidden = false;
  }
  function resume() { state = "play"; overlay.hidden = true; last = performance.now(); raf = requestAnimationFrame(loop); }

  startBtn.addEventListener("click", () => (state === "paused" ? resume() : start()));

  // Steuerung: Finger/Maus ziehen oder Pfeiltasten
  canvas.tabIndex = 0;
  const moveTo = (e) => { const r = canvas.getBoundingClientRect(); player.target = (e.clientX - r.left) * W / r.width; };
  canvas.addEventListener("pointerdown", (e) => { if (state === "play") { canvas.setPointerCapture(e.pointerId); moveTo(e); } });
  canvas.addEventListener("pointermove", (e) => { if (state === "play" && (e.pointerType === "mouse" || e.buttons)) moveTo(e); });
  canvas.addEventListener("keydown", (e) => { if (e.key.startsWith("Arrow") && state === "play") { keys[e.key] = true; e.preventDefault(); } });
  canvas.addEventListener("keyup", (e) => { keys[e.key] = false; });

  // Pausieren, wenn Tab/Reiter gewechselt oder Spiel aus dem Bild gescrollt wird
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  document.addEventListener("grulu:tab", (e) => { if (e.detail !== "spiel") pause(); });
  new IntersectionObserver(([en]) => { if (!en.isIntersecting) pause(); }, { threshold: 0.3 }).observe(canvas);

  reset();
  sprite.onload = draw;
  draw();
})();
