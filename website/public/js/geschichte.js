// Persönliche Gute-Nacht-Geschichte: KI schreibt, Browser liest vor.
(() => {
  "use strict";
  const form = document.getElementById("storyForm");
  if (!form) return;
  const { confetti, status } = window.GRULU;
  // Der Reiter erscheint nur, wenn der KI-Dienst am Server bereitsteht.
  status.then((s) => { const tab = document.getElementById("tab-geschichte"); if (tab && s.geschichte) tab.hidden = false; });
  const box = document.getElementById("story");
  const titleEl = document.getElementById("storyTitle");
  const textEl = document.getElementById("storyText");
  const readBtn = document.getElementById("storyRead");
  const submit = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    stopReading();
    const data = Object.fromEntries(new FormData(form));
    data.name = (data.name || "").trim();
    submit.disabled = true; submit.textContent = "✨ GRULU schreibt …";
    box.hidden = false; titleEl.textContent = ""; textEl.innerHTML = '<p class="typing"><span></span><span></span><span></span></p>';
    let story;
    try {
      const res = await fetch("/api/story", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const json = await res.json().catch(() => ({}));
      if (res.status === 429) throw Object.assign(new Error(json.error), { show: true });
      if (!res.ok || !json.text) throw new Error("offline");
      story = { title: json.title, text: json.text };
    } catch (err) {
      if (err.show) { textEl.innerHTML = `<p>${err.message}</p>`; reset(); return; }
      story = offlineStory(data);
    }
    show(story);
    reset();
    confetti(14);
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function reset() { submit.disabled = false; submit.textContent = "✨ Geschichte zaubern"; }

  function show({ title, text }) {
    titleEl.textContent = title;
    textEl.replaceChildren(...text.split(/\n+/).filter(Boolean).map((p) => Object.assign(document.createElement("p"), { textContent: p })));
    readBtn.hidden = !("speechSynthesis" in window);
  }

  // Ersatz, wenn die KI nicht erreichbar ist
  function offlineStory({ name, theme, animal }) {
    const n = name || "Kleiner Entdecker";
    const friend = animal ? `ein kleines ${animal}` : "ein kicherndes Glühwürmchen";
    return {
      title: `${n} und GRULU: ${theme}`,
      text: `Als der Mond über den Dächern aufging, klopfte es leise ans Fenster. Draußen saß GRULU, das flauschige lila Fellwesen mit dem Regenbogenschwanz, und winkte ${n} zu.\n` +
        `„Komm mit“, flüsterte GRULU, „heute erleben wir: ${theme.toLowerCase()}!“ Gemeinsam hüpften sie auf eine Wolke, die nach Zuckerwatte duftete.\n` +
        `Unterwegs trafen sie ${friend}, das den Weg mit funkelnden Sternen erleuchtete. Überall lagen kleine Überraschungen – genau wie in einer GRULU-Box.\n` +
        `${n} war mutig, neugierig und freundlich, und am Ende sagte GRULU: „Du bist der beste Abenteuer-Freund, den ich kenne.“\n` +
        `Dann brachte die Wolke ${n} sanft zurück ins warme Bett. Die Augen wurden schwer, und GRULU flüsterte: „Gute Nacht, ${n}. Bis morgen!“ 🌙`,
    };
  }

  // Vorlesen mit deutscher Stimme
  let speaking = false;
  function stopReading() { if ("speechSynthesis" in window) speechSynthesis.cancel(); speaking = false; readBtn.textContent = "🔊 Vorlesen"; }
  readBtn.addEventListener("click", () => {
    if (speaking) return stopReading();
    const u = new SpeechSynthesisUtterance(titleEl.textContent + ". " + textEl.innerText);
    u.lang = "de-DE"; u.rate = 0.9; u.pitch = 1.1;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("de"));
    if (voice) u.voice = voice;
    u.onend = stopReading;
    speechSynthesis.speak(u);
    speaking = true; readBtn.textContent = "⏹ Stopp";
  });

  document.getElementById("storyPrint").addEventListener("click", () => {
    document.body.classList.add("print-story");
    window.print();
    setTimeout(() => document.body.classList.remove("print-story"), 500);
  });
  document.getElementById("storyNew").addEventListener("click", () => { stopReading(); box.hidden = true; form.querySelector("input").focus(); });
})();
