// Minimal service worker registration for static standalone pages that do
// not load the full shared.js + landing.js / legal.js bundle. Kept as a
// separate file so the strict `script-src 'self'` CSP on these pages
// remains valid without 'unsafe-inline'.
(() => {
  "use strict";
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () =>
      navigator.serviceWorker
        .register("./service-worker.js")
        .catch(() => {}),
    );
  }
  // Also stamp the current year into any [data-year] elements (footer
  // copyright on standalone pages).
  try {
    document
      .querySelectorAll("[data-year]")
      .forEach((el) => (el.textContent = String(new Date().getFullYear())));
  } catch {
    // ignore — non-critical
  }
})();
