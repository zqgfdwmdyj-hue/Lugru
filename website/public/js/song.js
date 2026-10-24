// Mitsing-Bereich: GRULU-Song mit mitlaufendem Liedtext.
(() => {
  "use strict";
  const playBtn = document.getElementById("songPlay");
  if (!playBtn) return;
  const { music, confetti } = window.GRULU;
  const song = music.song;
  const cover = document.getElementById("songCover");
  const seek = document.getElementById("songSeek");
  const timeEl = document.getElementById("songTime");
  const durEl = document.getElementById("songDur");
  const prevEl = document.getElementById("kPrev");
  const nowEl = document.getElementById("kNow");
  const nextEl = document.getElementById("kNext");
  const full = document.getElementById("songFull");

  let lines = [];
  let current = -2;
  let raf = 0;
  let seeking = false;

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  fetch("/audio/grulu-song.json")
    .then((r) => r.json())
    .then((data) => {
      lines = data;
      full.replaceChildren(...lines.filter((l) => !l.pause).map((l) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button"; b.textContent = l.text; b.dataset.t = l.t;
        b.addEventListener("click", () => { song.currentTime = l.t; if (!music.on) music.start(); });
        li.append(b);
        return li;
      }));
    })
    .catch(() => { nowEl.textContent = "🎵 Tausend tolle Sachen 🎵"; });

  function lineAt(t) {
    let i = -1;
    for (let k = 0; k < lines.length; k++) { if (lines[k].t <= t + 0.15) i = k; else break; }
    return i;
  }

  function render() {
    const t = song.currentTime || 0;
    if (!seeking) seek.value = t;
    timeEl.textContent = fmt(t);
    const i = lineAt(t);
    if (i !== current) {
      current = i;
      const text = (k) => (lines[k] ? lines[k].text : "");
      prevEl.textContent = i > 0 ? text(i - 1) : "";
      nowEl.textContent = i >= 0 ? text(i) : (song.paused ? "Drück auf ▶ und sing mit!" : "🎵 Gleich geht’s los … 🎵");
      nextEl.textContent = text(i + 1);
      nowEl.classList.remove("pulse"); void nowEl.offsetWidth; nowEl.classList.add("pulse");
      full.querySelectorAll("button.on").forEach((b) => b.classList.remove("on"));
      if (lines[i] && !lines[i].pause) full.querySelector(`button[data-t="${lines[i].t}"]`)?.classList.add("on");
      // Refrain „Grulu, Grulu, Grulu-Box!“ gibt Konfetti
      if (lines[i]?.text.startsWith("Grulu, Grulu, Grulu-Box")) confetti(10);
    }
  }

  function loop() { render(); if (!song.paused) raf = requestAnimationFrame(loop); }

  function syncState() {
    const on = !song.paused;
    playBtn.textContent = on ? "❚❚" : "▶";
    playBtn.setAttribute("aria-label", on ? "Song anhalten" : "Song abspielen");
    cover.classList.toggle("playing", on);
    cancelAnimationFrame(raf);
    if (on) raf = requestAnimationFrame(loop); else render();
  }

  song.addEventListener("play", syncState);
  song.addEventListener("pause", syncState);
  song.addEventListener("ended", () => { song.currentTime = 0; syncState(); });
  song.addEventListener("loadedmetadata", () => { seek.max = song.duration; durEl.textContent = fmt(song.duration); });

  playBtn.addEventListener("click", () => (music.on ? music.stop() : music.start()));
  seek.addEventListener("input", () => { seeking = true; timeEl.textContent = fmt(+seek.value); });
  seek.addEventListener("change", () => { song.currentTime = +seek.value; seeking = false; render(); });
})();
