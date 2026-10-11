// Light and dark theme. The choice is remembered in this browser; by default the system setting is used.
// A small inline script in the <head> applies the saved theme before the page is drawn.
const KEY = "theme";
const sys = () => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const label = (t) => (t === "dark" ? "Light theme" : "Dark theme");

export function initTheme() {
  const apply = (t) => {
    document.documentElement.setAttribute("data-theme", t);
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => { b.textContent = label(t); b.setAttribute("aria-label", "Switch to the " + label(t).toLowerCase()); });
  };
  apply(saved() || sys());
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("[data-theme-toggle]")) return;
    const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, t); } catch {}
    apply(t);
  });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (!saved()) apply(sys()); });
}
