// Apply persisted theme before paint to avoid a flash of the wrong theme.
// Kept as an external file (not inline) so the app can ship a strict
// script-src 'self' CSP without needing a per-build inline-script hash.
(function () {
  try {
    // zustand persists the store under "wore.settings" as { state: { theme } }.
    var raw = localStorage.getItem("wore.settings");
    var theme = raw ? (JSON.parse(raw).state || {}).theme || "system" : "system";
    var sys = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = theme === "dark" || (theme === "system" && sys);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
