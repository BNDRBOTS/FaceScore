(() => {
  "use strict";
  const FS = window.FaceScore;
  const cfg = FS.cfg;
  document
    .querySelectorAll("[data-year]")
    .forEach((el) => (el.textContent = new Date().getFullYear()));
  document
    .querySelectorAll("[data-price]")
    .forEach((el) => (el.textContent = cfg.PRICE || "$19"));
  document
    .querySelectorAll("[data-price-note]")
    .forEach((el) => (el.textContent = cfg.PRICE_NOTE || "one-time purchase"));
  document
    .querySelectorAll("[data-payment-buttons]")
    .forEach((el) =>
      FS.renderPaymentButtons(el, {
        emptyElement: document.querySelector("[data-payment-empty]"),
      }),
    );
  FS.wireSupportLinks();
  FS.initConsent();
  const observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) =>
            entries.forEach((e) => {
              if (e.isIntersecting) {
                e.target.classList.add("visible");
                observer.unobserve(e.target);
              }
            }),
          { threshold: 0.12 },
        )
      : null;
  document
    .querySelectorAll(".reveal")
    .forEach((el) =>
      observer ? observer.observe(el) : el.classList.add("visible"),
    );
  // Prevent content from remaining hidden after instant jumps, print capture, or aggressive scrolling.
  setTimeout(
    () =>
      document
        .querySelectorAll(".reveal:not(.visible)")
        .forEach((el) => el.classList.add("visible")),
    1200,
  );
  if ("serviceWorker" in navigator && location.protocol !== "file:")
    window.addEventListener("load", () =>
      navigator.serviceWorker.register("./service-worker.js").catch(() => {}),
    );
})();
