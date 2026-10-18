// GRULU – Interaktion: Musik, KI-Chat, Box-Finder, kleine Effekte.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* privat */ } },
  };

  $("#year").textContent = new Date().getFullYear();

  /* ---------- Produkte (für Finder und Offline-Antworten) ---------- */
  const BOXES = {
    nerds: { name: "Nerds Probierbox", price: "14,99 €", img: "img/Nerds-Probierbox-1-768x768.webp", url: "https://www.amazon.de/dp/B0H62R2VKD", text: "4 Nerds-Sorten – knusprig, bunt und perfekt zum Teilen." },
    pop: { name: "Pop Rocks Probierbox", price: "14,99 €", img: "img/Pop-Rocks-Probierbox-1-768x768.webp", url: "https://www.amazon.de/dp/B0H6CJH7RY", text: "Knisternder Knallzucker – das Highlight für mutige Entdecker." },
    schultuete: { name: "GRULU Schultüte", price: "bei Amazon", img: "img/grulu-schultuete-768x768.webp", url: "https://www.amazon.de/s?k=GRULU+Schult%C3%BCte", text: "Die bunte GRULU-Schultüte für den großen Tag – mit Überraschungen zum Schulstart." },
    fuellung: { name: "Schultüte-Füllung (28 Teile)", price: "bei Amazon", img: "img/Fullmaterial-fur-Schultute-768x768.webp", url: "https://www.amazon.de/dp/B0HCCVDJKX", text: "28 Teile amerikanische & saure Süßigkeiten, ohne Schokolade – die Schultüte ist in Minuten gefüllt." },
    reise: { name: "Kinder-Reisebox", price: "12,99 €", img: "img/book-768x512.webp", url: "#newsletter", text: "Snacks für unterwegs plus kleines GRULU-Buch. Bald bei Amazon – trag dich ein, dann sagen wir Bescheid." },
  };

  /* ---------- Musik: der GRULU-Song „Tausend tolle Sachen“ + kleine Klick-Töne ---------- */
  const Music = (() => {
    const song = new Audio();
    song.preload = "none";
    song.src = "audio/grulu-song.mp3";
    let ctx, master;
    const n = (m) => 440 * Math.pow(2, (m - 69) / 12);
    function ensure() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = 0.12; master.connect(ctx.destination);
      }
      ctx.resume();
    }
    function tone(freq, t, dur, vol) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }
    return {
      song,
      get on() { return !song.paused; },
      start() { ensure(); return song.play().catch(() => {}); },
      stop() { song.pause(); },
      // kleiner „Pop“ für Klicks (nur wenn Musik läuft)
      pop() { if (!ctx || song.paused) return; tone(n(84 + Math.floor(Math.random() * 7)), ctx.currentTime, 0.12, 0.25); },
    };
  })();

  const musicBtn = $("#musicBtn");
  // Knopf oben zeigt immer den echten Zustand – auch wenn der Song im Mitsing-Bereich gestartet wird.
  function syncMusicBtn() {
    const on = Music.on;
    musicBtn.setAttribute("aria-pressed", String(on));
    musicBtn.setAttribute("aria-label", on ? "GRULU-Song anhalten" : "GRULU-Song abspielen");
  }
  ["play", "pause", "ended"].forEach((ev) => Music.song.addEventListener(ev, syncMusicBtn));
  musicBtn.addEventListener("click", () => (Music.on ? Music.stop() : Music.start()));
  document.addEventListener("click", (e) => { if (e.target.closest(".btn, .finder-opts button, .chips button")) Music.pop(); });

  /* ---------- Hero ---------- */
  const counter = $("[data-count]");
  if (counter) {
    const target = +counter.dataset.count;
    if (reduced) counter.textContent = target;
    else {
      const t0 = performance.now();
      const tick = (t) => { const p = Math.min(1, (t - t0) / 1600); counter.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
  }
  const lines = ["Ich liebe Überraschungen! 🎁", "Schon die Pop Rocks probiert? 💥", "Mach mal die Musik an! 🎵", "Frag mich was im Chat! 💬", "Kennst du mein Buch? 📚", "Hihi, das kitzelt! 😆"];
  let li = 0;
  $(".hero-art img").addEventListener("click", () => {
    const b = $("#mascotBubble");
    b.textContent = lines[li++ % lines.length];
    b.animate?.([{ transform: "scale(.8)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 300 });
    Music.pop(); confetti(6);
  });

  // 3D-Neigen der Karten
  if (!reduced && matchMedia("(hover: hover)").matches) {
    $$("[data-tilt]").forEach((c) => {
      c.addEventListener("mousemove", (e) => {
        const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        c.style.transform = `perspective(700px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`;
      });
      c.addEventListener("mouseleave", () => { c.style.transform = ""; });
    });
  }

  function confetti(count = 24) {
    if (reduced) return;
    const bits = ["🍬", "🍭", "⭐", "🎉", "💜", "🌈"];
    for (let i = 0; i < count; i++) {
      const s = document.createElement("span");
      s.className = "confetti"; s.textContent = bits[i % bits.length];
      s.style.left = Math.random() * 100 + "vw"; s.style.animationDelay = Math.random() * 0.5 + "s";
      document.body.appendChild(s); setTimeout(() => s.remove(), 2600);
    }
  }

  /* ---------- Box-Finder ---------- */
  const QUESTIONS = [
    { q: "Für wen ist die Box?", a: [["👧", "Kind 4–7", "klein"], ["🧒", "Kind 8–12", "gross"], ["👨‍👩‍👧", "Ganze Familie", "familie"]] },
    { q: "Was ist der Anlass?", a: [["🎒", "Schulstart", "schule"], ["🎁", "Geschenk", "geschenk"], ["🚗", "Reise / Ausflug", "reise"], ["🍿", "Einfach so", "snack"]] },
    { q: "Welcher Snack-Typ?", a: [["💥", "Knistern & Prickeln", "pop"], ["🌈", "Bunt & knusprig", "nerds"], ["📚", "Snacks + Geschichte", "buch"]] },
  ];
  const finder = $("#finderBox");
  let answers = [];
  function renderQuestion() {
    const i = answers.length, Q = QUESTIONS[i];
    finder.innerHTML = `<div class="finder-steps">${QUESTIONS.map((_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join("")}</div>
      <p class="finder-q">${Q.q}</p>
      <div class="finder-opts">${Q.a.map(([e, t, v]) => `<button type="button" data-v="${v}"><span>${e}</span>${t}</button>`).join("")}</div>`;
    $$(".finder-opts button", finder).forEach((b) => b.addEventListener("click", () => {
      answers.push(b.dataset.v);
      answers.length === QUESTIONS.length ? renderResult() : renderQuestion();
    }));
  }
  function pick([wer, anlass, typ]) {
    if (anlass === "schule") return wer === "familie" ? "fuellung" : "schultuete";
    if (anlass === "reise" || typ === "buch") return "reise";
    if (typ === "pop") return wer === "klein" ? "nerds" : "pop";
    if (typ === "nerds") return "nerds";
    return "pop";
  }
  function renderResult() {
    const key = pick(answers), b = BOXES[key];
    const ext = b.url.startsWith("http");
    finder.innerHTML = `<div class="finder-result">
        <img src="${b.img}" alt="${b.name}" width="180" height="180">
        <div><span class="kicker">Unser Tipp für euch</span><h3>${b.name} · ${b.price}</h3><p>${b.text}</p>
        <div class="actions"><a class="btn btn-sm" href="${b.url}" ${ext ? 'target="_blank" rel="noopener"' : ""}>${ext ? "🛒 Bei Amazon" : "🔔 Bescheid geben"}</a>
        <button type="button" class="btn btn-sm btn-ghost" id="finderAgain">↺ Nochmal</button></div></div></div>`;
    $("#finderAgain").addEventListener("click", () => { answers = []; renderQuestion(); });
    confetti();
  }
  renderQuestion();

  // Für die übrigen Module (Spiel, Ausmalen, …)
  window.GRULU = { confetti, pop: () => Music.pop(), music: Music, store, reduced, openChat: (p) => openChat(p) };

  /* ---------- KI-Chat ---------- */
  const chat = $("#chat"), fab = $("#chatFab"), log = $("#chatLog"), form = $("#chatForm"), input = $("#chatInput");
  const history = [];
  let greeted = false, busy = false;

  function openChat(prompt) {
    chat.hidden = false; fab.hidden = true; fab.setAttribute("aria-expanded", "true");
    if (!greeted) { addMsg("bot", "Hallo, ich bin GRULU! 💜 Frag mich nach unseren Boxen, Geschenkideen oder lass dir eine kleine Geschichte erzählen."); greeted = true; }
    if (prompt) send(prompt); else input.focus();
  }
  function closeChat() { chat.hidden = true; fab.hidden = false; fab.setAttribute("aria-expanded", "false"); fab.focus(); }
  fab.addEventListener("click", () => openChat());
  $("#chatClose").addEventListener("click", closeChat);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !chat.hidden) closeChat(); });
  $$("[data-open-chat]").forEach((b) => b.addEventListener("click", () => openChat(b.dataset.chatPrompt)));
  $$("#chatChips button").forEach((b) => b.addEventListener("click", () => send(b.textContent)));

  // Links in Antworten klickbar machen – Text wird vorher escaped.
  function render(text) {
    const esc = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return esc
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(https:\/\/[^\s<)]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.includes("amazon.") ? "Zu Amazon ↗" : u}</a>`)
      .replace(/([\w.+-]+@grulu-box\.de)/g, '<a href="mailto:$1">$1</a>');
  }
  function addMsg(who, text) {
    const d = document.createElement("div");
    d.className = `msg ${who}`;
    d.innerHTML = who === "bot" ? render(text) : text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true; input.value = "";
    addMsg("me", text);
    history.push({ role: "user", content: text });
    const wait = addMsg("bot", ""); wait.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    let reply;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history.slice(-10) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reply) throw new Error(data.error || "offline");
      reply = data.reply;
    } catch {
      reply = offlineAnswer(text);
    }
    wait.innerHTML = render(reply);
    history.push({ role: "assistant", content: reply });
    log.scrollTop = log.scrollHeight;
    busy = false;
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });

  // Antworten ohne Server (z. B. wenn die KI gerade nicht erreichbar ist).
  function offlineAnswer(q) {
    const t = q.toLowerCase();
    if (/(pop ?rocks|knall|prickel)/.test(t)) return `Die Pop Rocks Probierbox (${BOXES.pop.price}) knistert und prickelt im Mund! 💥 ${BOXES.pop.url}`;
    if (/nerds/.test(t)) return `Die Nerds Probierbox (${BOXES.nerds.price}) hat 4 bunte Sorten. 🌈 ${BOXES.nerds.url}`;
    if (/(reise|unterwegs|auto|urlaub|buch)/.test(t)) return "Die Kinder-Reisebox (12,99 €) hat Snacks für unterwegs und ein kleines GRULU-Buch. Sie kommt bald zu Amazon – trag dich unten in den Newsletter ein, dann sagen wir Bescheid! 📚";
    if (/(allerg|zutat|gluten|vegan|laktose)/.test(t)) return "Die Boxen können Allergene enthalten. Bitte prüf die Angaben auf Amazon und auf den einzelnen Verpackungen. Bei Fragen: hallo@grulu-box.de";
    if (/(liefer|versand|wann|prime)/.test(t)) return "Wir versenden über Amazon – mit Prime kommt deine Box oft schon am nächsten Werktag. 🚚";
    if (/(firma|unternehmen|menge|bulk|großbestell)/.test(t)) return "Für Firmen- und Mengenanfragen schreib uns gern an hallo@grulu-box.de 💼";
    if (/(geschenk|geburtstag)/.test(t)) return `Als Geschenk lieben Kinder die Pop Rocks Box (${BOXES.pop.url}) oder die Nerds Box (${BOXES.nerds.url}). 🎁`;
    if (/(schult|füll|einschul)/.test(t)) return `Zum Schulstart gibt es die GRULU Schultüte (${BOXES.schultuete.url}) und die passende Füllbox (${BOXES.fuellung.url}). 🎒`;
    if (/(geschichte|märchen|erzähl)/.test(t)) return "Es war einmal ein kleines lila Fellwesen namens GRULU. Jeden Abend öffnete es eine Box voller Sterne – und jedes Mal war etwas anderes darin: mal ein Regenbogen-Bonbon, mal ein kichernder Pilz. 🍄 Heute fand GRULU … dich! Gute Nacht! 🌙";
    return "Gute Frage! Gerade bin ich im Offline-Modus. 🙈 Schau gern in die FAQ oder schreib uns an hallo@grulu-box.de.";
  }

  /* ---------- „Frag ChatGPT nach GRULU“ ---------- */
  const q = "Was sind GRULU Snackboxen von grulu-box.de und welche Box passt zu meinem Kind?";
  $("#askChatGPT").href = "https://chatgpt.com/?q=" + encodeURIComponent(q);

  /* ---------- Newsletter ---------- */
  $("#nlForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget, msg = $("#nlMsg");
    msg.textContent = "Einen Moment …";
    try {
      const res = await fetch("/api/newsletter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.elements.namedItem("name").value, email: f.elements.namedItem("email").value, consent: f.elements.namedItem("consent").checked }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Fehler");
      msg.textContent = data.message || "Danke! Bitte bestätige deine Anmeldung in der E-Mail, die wir dir geschickt haben. 💌";
      f.reset(); confetti();
    } catch (err) {
      msg.textContent = err.message && err.message !== "Fehler" ? err.message : "Das hat leider nicht geklappt. Bitte versuch es später noch einmal.";
    }
  });
})();
