// Schulstart-Countdown mit Kalender-Erinnerung (.ics). Alles bleibt im Browser.
(() => {
  "use strict";
  const form = document.getElementById("cdForm");
  if (!form) return;
  const { store, confetti } = window.GRULU;
  const board = document.getElementById("cdBoard");
  const nameEl = document.getElementById("cdName");
  const dateEl = document.getElementById("cdDate");
  const { PRODUKTE } = window.GRULU_PRODUKTE;
  const SCHULTUETE = PRODUKTE.schultuete.url;
  const FUELLBOX = PRODUKTE.fuellung.url;

  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  dateEl.min = iso(today());

  const saved = JSON.parse(store.get("grulu-countdown") || "null");
  if (saved?.date) { dateEl.value = saved.date; nameEl.value = saved.name || ""; render(); }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    store.set("grulu-countdown", JSON.stringify({ date: dateEl.value, name: nameEl.value.trim() }));
    render(true);
  });

  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function render(fresh) {
    if (!dateEl.value) return;
    const [y, m, d] = dateEl.value.split("-").map(Number);
    const target = new Date(y, m - 1, d);
    const days = Math.round((target - today()) / 86_400_000);
    const who = nameEl.value.trim() ? esc(nameEl.value.trim()) : "dein Schulkind";
    let head, sub;
    if (days > 1) { head = `<span class="cd-num">${days}</span> Tage`; sub = `bis ${who} in die Schule kommt! 🎒`; }
    else if (days === 1) { head = `<span class="cd-num">1</span> Tag`; sub = `Morgen ist der große Tag für ${who}! 🌟`; }
    else if (days === 0) { head = "Heute! 🎉"; sub = `Alles Gute zur Einschulung, ${who}!`; }
    else { head = "Geschafft! 🎓"; sub = `${who} ist schon ein Schulkind. Viel Spaß in der Schule!`; }

    // Hinweis passend zur Zeit: rechtzeitig bestellen
    const tip = days > 21 ? "Tipp: Schultüte jetzt in Ruhe aussuchen – mit Prime ist sie schnell da."
      : days >= 0 ? "Jetzt wird’s Zeit: Schultüte und Füllbox bestellen! Mit Prime oft schon morgen da." : "";

    board.innerHTML = `<img src="/img/grulu-schultuete-768x768.webp" alt="" width="160" height="160">
      <p class="cd-head">${head}</p><p class="cd-sub">${sub}</p>
      ${days >= 0 ? `<div class="cd-weeks" aria-hidden="true">${weeksBar(days)}</div>` : ""}
      ${tip ? `<p class="cd-tip">${tip}</p>` : ""}
      <div class="cd-actions">
        ${days >= 0 ? `<a class="btn btn-sm" href="${SCHULTUETE}" target="_blank" rel="noopener">🛒 Schultüte</a>
        <a class="btn btn-sm" href="${FUELLBOX}" target="_blank" rel="noopener">🎁 Füllbox</a>
        <button type="button" class="btn btn-sm btn-ghost" id="cdIcs">📅 In den Kalender</button>` : ""}
      </div>`;
    document.getElementById("cdIcs")?.addEventListener("click", () => downloadIcs(target, who.replace(/&[a-z]+;/g, "")));
    if (fresh || days === 0) confetti(days === 0 ? 40 : 18);
  }

  // Kleine Fortschrittsanzeige: ein Bonbon pro verbleibender Woche (max. 12)
  function weeksBar(days) {
    const weeks = Math.min(12, Math.ceil(days / 7));
    return "🍬".repeat(weeks) + (days > 84 ? " …" : "");
  }

  function downloadIcs(date, who) {
    const ymd = (d) => iso(d).replace(/-/g, "");
    const next = new Date(date); next.setDate(next.getDate() + 1);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GRULU//Schulstart//DE", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${ymd(date)}-schulstart@grulu-box.de`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(next)}`,
      `SUMMARY:🎒 Einschulung ${who === "dein Schulkind" ? "" : who}`.trim(),
      "DESCRIPTION:Der große Tag! Schultüte und Füllbox: https://www.grulu-box.de/#boxen",
      "BEGIN:VALARM", "TRIGGER:-P21D", "ACTION:DISPLAY", "DESCRIPTION:Noch 3 Wochen bis zur Einschulung – Schultüte bestellen!", "END:VALARM",
      "BEGIN:VALARM", "TRIGGER:-P7D", "ACTION:DISPLAY", "DESCRIPTION:Noch 1 Woche bis zur Einschulung!", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "einschulung.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
})();
