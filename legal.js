(() => {
  document
    .querySelectorAll("[data-year]")
    .forEach((el) => (el.textContent = new Date().getFullYear()));
  FaceScore.wireSupportLinks();
  FaceScore.initConsent();
})();
