// GRULU-Welt: Reiter (Ausmalen, Spiel, Geschichte, Grußkarte).
(() => {
  "use strict";
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  if (!tabs.length) return;

  function select(tab, focus = true) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
    document.dispatchEvent(new CustomEvent("grulu:tab", { detail: tab.id.replace("tab-", "") }));
  }

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length]); }
    });
  });

  // Links wie <a data-open-tab="geschichte"> öffnen direkt den passenden Reiter.
  document.querySelectorAll("[data-open-tab]").forEach((a) => a.addEventListener("click", () => {
    const t = document.getElementById("tab-" + a.dataset.openTab);
    if (t) select(t, false);
  }));
})();
