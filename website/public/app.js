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

  const jahr = $("#year");
  if (jahr) jahr.textContent = new Date().getFullYear();

  /* ---------- Produkte (js/produkte.js) ---------- */
  const { PRODUKTE: BOXES, empfehlung } = window.GRULU_PRODUKTE;

  /* ---------- Was der Server kann ---------- */
  // Auf einem reinen Webhoster (ohne Node-Server) gibt es /api/status nicht:
  // dann laufen Chat, Geschichten, Galerie und Newsletter nicht, und die
  // Seite zeigt das ehrlich, statt erst nach der Eingabe zu scheitern.
  const status = fetch("/api/status", { headers: { accept: "application/json" } })
    .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : {}))
    .catch(() => ({}));

  /* ---------- Musik: der GRULU-Song „Tausend tolle Sachen“ + kleine Klick-Töne ---------- */
  const Music = (() => {
    const song = new Audio();
    song.preload = "none";
    song.src = "/audio/grulu-song.mp3";
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
    if (!musicBtn) return;
    const on = Music.on;
    musicBtn.setAttribute("aria-pressed", String(on));
    musicBtn.setAttribute("aria-label", on ? "GRULU-Song anhalten" : "GRULU-Song abspielen");
  }
  ["play", "pause", "ended"].forEach((ev) => Music.song.addEventListener(ev, syncMusicBtn));
  musicBtn?.addEventListener("click", () => (Music.on ? Music.stop() : Music.start()));
  document.addEventListener("click", (e) => { if (e.target.closest(".btn, .finder-opts button, .chips button")) Music.pop(); });

  /* ---------- Maskottchen ---------- */
  const lines = ["Ich liebe Überraschungen! 🎁", "Schon die Pop Rocks probiert? 💥", "Kennst du mein Buch? 📚", "Hihi, das kitzelt! 😆"];
  let li = 0;
  $(".hero-art img")?.addEventListener("click", () => {
    const b = $("#mascotBubble");
    if (!b) return;
    b.textContent = lines[li++ % lines.length];
    Music.pop();
  });

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
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
  function knopf(b) {
    if (!b.verfuegbar) return `<a class="btn btn-sm btn-ghost" href="${b.url}">🔔 Bescheid geben</a>`;
    return `<a class="btn btn-sm" href="${b.url}" target="_blank" rel="noopener">🛒 ${b.suche ? "Bei Amazon suchen" : "Bei Amazon"}</a>`;
  }
  function renderResult() {
    const e = empfehlung(...answers), b = BOXES[e.tipp], alt = e.auch && BOXES[e.auch];
    const bild = b.bild ? `<img src="${b.bild}" alt="${esc(b.name)}" width="180" height="180">` : `<div class="bild-folgt" aria-hidden="true">🚗🍬📚</div>`;
    finder.innerHTML = `<div class="finder-result">
        ${bild}
        <div><span class="kicker">Unser Tipp für euch</span><h3>${esc(b.name)}${b.preis ? " · " + b.preis : ""}</h3><p>${esc(b.kurz)}</p>
        <ul class="finder-warum">${e.warum.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
        <div class="actions">${knopf(b)}
        ${alt ? `<a class="btn btn-sm btn-ghost" href="${alt.url}" ${alt.verfuegbar ? 'target="_blank" rel="noopener"' : ""}>Auch passend: ${esc(alt.name)}</a>` : ""}
        <button type="button" class="btn btn-sm btn-ghost" id="finderAgain">↺ Nochmal</button></div>
        <p class="hint">Bestellung und Bezahlung über Amazon.</p></div></div>`;
    $("#finderAgain").addEventListener("click", () => { answers = []; renderQuestion(); });
    confetti(10);
  }
  if (finder) renderQuestion();

  // Für die übrigen Module (Spiel, Ausmalen, …)
  window.GRULU = { confetti, pop: () => Music.pop(), music: Music, store, reduced, status, openChat: (p) => openChat(p) };

  /* ---------- Chat: KI-Helfer oder Produkthilfe ---------- */
  // Ohne erreichbare KI ist der Chat eine Produkthilfe mit festen Antworten –
  // das steht schon auf dem Knopf und im Kopf des Fensters, nicht erst nach
  // der ersten Frage.
  const chat = $("#chat"), fab = $("#chatFab"), log = $("#chatLog"), form = $("#chatForm"), input = $("#chatInput");
  const history = [];
  let greeted = false, busy = false, ki = false;

  function setzeModus(an) {
    ki = an;
    const label = $("#chatFabLabel"), modus = $("#chatModus"), note = $("#chatNote");
    if (label) label.textContent = ki ? "Frag GRULU" : "Fragen?";
    if (modus) modus.textContent = ki ? "KI-Helfer · Antworten können Fehler enthalten" : "Produkthilfe · feste Antworten zu unseren Boxen";
    if (note) note.innerHTML = ki
      ? 'Deine Fragen werden zur Beantwortung an unseren KI-Dienst (Anthropic) geschickt. Bitte keine persönlichen Daten eingeben. <a href="/datenschutz/">Datenschutz</a>'
      : 'Die Produkthilfe antwortet aus unseren FAQ – deine Eingaben verlassen deinen Browser nicht. Weitere Fragen: <a href="mailto:hallo@grulu-box.de">hallo@grulu-box.de</a>';
    $$("[data-open-chat]").forEach((b) => { if (b.dataset.chatLabel !== "fest") b.textContent = ki ? "💬 Frag GRULU" : "💬 Fragen zu den Boxen"; });
  }
  setzeModus(false);
  status.then((s) => setzeModus(!!s.chat));

  function openChat(prompt) {
    if (!chat) return;
    chat.hidden = false; fab.hidden = true; fab.setAttribute("aria-expanded", "true");
    if (!greeted) {
      addMsg("bot", ki
        ? "Hallo, ich bin GRULU! 💜 Frag mich nach unseren Boxen, Geschenkideen oder lass dir eine kleine Geschichte erzählen."
        : "Hallo, ich bin GRULU! 💜 Ich beantworte die häufigsten Fragen zu unseren Boxen. Tipp einfach auf eine Frage unten oder schreib mir ein Stichwort.");
      greeted = true;
    }
    if (prompt) send(prompt); else input.focus();
  }
  function closeChat() { chat.hidden = true; fab.hidden = false; fab.setAttribute("aria-expanded", "false"); fab.focus(); }
  if (chat) {
    fab.addEventListener("click", () => openChat());
    $("#chatClose").addEventListener("click", closeChat);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !chat.hidden) closeChat(); });
    $$("#chatChips button").forEach((b) => b.addEventListener("click", () => send(b.textContent)));
    form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  }
  $$("[data-open-chat]").forEach((b) => b.addEventListener("click", () => openChat(b.dataset.chatPrompt)));

  // Links in Antworten klickbar machen – Text wird vorher escaped.
  function render(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(https:\/\/[^\s<)]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.includes("amazon.") ? "Zu Amazon ↗" : u}</a>`)
      .replace(/([\w.+-]+@grulu-box\.de)/g, '<a href="mailto:$1">$1</a>');
  }
  function addMsg(who, text) {
    const d = document.createElement("div");
    d.className = `msg ${who}`;
    d.innerHTML = who === "bot" ? render(text) : esc(text);
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true; input.value = "";
    addMsg("me", text);
    history.push({ role: "user", content: text });
    let reply;
    if (!ki) {
      reply = offlineAnswer(text);
      addMsg("bot", reply);
    } else {
      const wait = addMsg("bot", ""); wait.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
      try {
        const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history.slice(-10) }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.reply) throw new Error(data.error || "offline");
        reply = data.reply;
      } catch {
        // KI gerade nicht erreichbar: auf die Produkthilfe umschalten.
        setzeModus(false);
        reply = "Der KI-Helfer ist gerade nicht erreichbar, ich antworte aus unseren FAQ: " + offlineAnswer(text);
      }
      wait.innerHTML = render(reply);
    }
    history.push({ role: "assistant", content: reply });
    log.scrollTop = log.scrollHeight;
    busy = false;
  }

  // Feste Antworten der Produkthilfe.
  function offlineAnswer(q) {
    const t = q.toLowerCase();
    const alter = /(\d{1,2})\s*-?\s*(jährig|jahr|j\b)/.exec(t);
    if (alter || /(welche box|was passt|empfehl)/.test(t)) {
      const a = alter ? +alter[1] : 0;
      return a && a < 3
        ? "Für Kinder unter 3 Jahren sind Knallzucker und kleine Süßigkeiten nicht geeignet. 💜 Für Fragen: hallo@grulu-box.de"
        : `Für Kinder${a ? " mit " + a + " Jahren" : ""} kommen gut an: die Nerds Probierbox (bunt & knusprig, ${BOXES.nerds.preis}) ${BOXES.nerds.url} und die Pop Rocks Probierbox (knistert, ${BOXES.pop.preis}) ${BOXES.pop.url} – oder probier oben den Box-Finder. 🎁`;
    }
    if (/(pop ?rocks|knall|prickel|knister)/.test(t)) return `Die Pop Rocks Probierbox (${BOXES.pop.preis}) knistert und prickelt im Mund! 💥 ${BOXES.pop.url}`;
    if (/nerds/.test(t)) return `Die Nerds Probierbox (${BOXES.nerds.preis}) hat 4 bunte Sorten. 🌈 ${BOXES.nerds.url}`;
    if (/(reise|unterwegs|auto|urlaub|buch)/.test(t)) return `Die Kinder-Reisebox (${BOXES.reise.preis}) hat wechselnde Snacks für unterwegs und ein kleines GRULU-Buch. Sie kommt bald zu Amazon – unten kannst du dich benachrichtigen lassen. 📚`;
    if (/(allerg|zutat|gluten|vegan|laktose|nuss|nüsse)/.test(t)) return "Zutaten und Allergene stehen auf der jeweiligen Produktseite bei Amazon und auf jeder einzelnen Verpackung. Weil viele Boxen wechselnde Inhalte haben, bitte vor dem Verzehr immer die Verpackung prüfen. Fragen beantworten wir an hallo@grulu-box.de";
    if (/(bestell|kauf|bezahl|zahl)/.test(t)) return "Bestellung und Bezahlung laufen über Amazon: Box auswählen, auf „Bei Amazon“ tippen und dort bestellen. Bestellstatus, Rückgaben und Erstattungen findest du in deinem Amazon-Konto. 🛒";
    if (/(liefer|versand|wann|prime)/.test(t)) return "Wir versenden über Amazon – die Lieferzeit zeigt Amazon beim Bestellen, mit Prime oft am nächsten Werktag. 🚚";
    if (/(firma|unternehmen|menge|bulk|großbestell|mitarbeiter)/.test(t)) return "Für Firmen- und Mengenanfragen schreib uns an hallo@grulu-box.de – gern mit Anzahl, Wunschtermin und ob ihr eine Grußkarte mit Logo möchtet. 💼";
    if (/(geschenk|geburtstag|weihnacht|nikolaus)/.test(t)) return `Als Geschenk kommen die Pop Rocks Box (${BOXES.pop.url}) und die Nerds Box (${BOXES.nerds.url}) gut an. 🎁`;
    if (/(schult|füll|einschul)/.test(t)) return `Zum Schulstart gibt es die GRULU Schultüte (${BOXES.schultuete.url}) und die passende 28-teilige Füllung (${BOXES.fuellung.url}). 🎒`;
    if (/(inhalt|gleich|wechsel)/.test(t)) return "Viele GRULU-Boxen haben wechselnde Inhalte – so bleibt jede Box spannend. Was gerade drin ist, steht bei Amazon in der Produktbeschreibung.";
    if (/(geschichte|märchen|erzähl)/.test(t)) return "Geschichten, Ausmalbilder und ein Spiel findest du in der GRULU-Welt: https://www.grulu-box.de/welt/ 🌙";
    return "Dazu habe ich keine feste Antwort. 🙈 Schau gern in die häufigen Fragen unten oder schreib uns an hallo@grulu-box.de.";
  }

  /* ---------- „Frag ChatGPT nach GRULU“ ---------- */
  const q = "Was sind GRULU Snackboxen von grulu-box.de und welche Box passt zu meinem Kind?";
  const askGpt = $("#askChatGPT");
  if (askGpt) askGpt.href = "https://chatgpt.com/?q=" + encodeURIComponent(q);

  /* ---------- Firmenanfrage mit Vorlage ---------- */
  const firmen = $("#firmenAnfrage");
  if (firmen) {
    const body = "Guten Tag,\n\nwir interessieren uns für GRULU-Boxen.\n\nFirma:\nAnlass (z. B. Weihnachten, Mitarbeiterkinder, Kunden):\nWelche Box:\nAnzahl:\nGewünschter Liefertermin:\nGrußkarte mit Logo (ja/nein):\n\nViele Grüße";
    firmen.href = "mailto:hallo@grulu-box.de?subject=" + encodeURIComponent("Firmenanfrage GRULU-Boxen") + "&body=" + encodeURIComponent(body);
  }

  /* ---------- Newsletter ---------- */
  const nlForm = $("#nlForm");
  if (nlForm) {
    // Ohne Newsletter-Dienst am Server: statt eines Formulars, das scheitert,
    // die Benachrichtigung per E-Mail anbieten.
    status.then((s) => {
      if (s.newsletter) return;
      nlForm.hidden = true;
      const ersatz = $("#nlErsatz");
      if (ersatz) ersatz.hidden = false;
    });
    nlForm.addEventListener("submit", async (e) => {
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
  }
})();
