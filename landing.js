(() => {
  "use strict";
  // Defer until DOM is ready (script has defer so this fires after parse).
  document.addEventListener("DOMContentLoaded", () => {
    if (window.FaceScore?.initCommon) {
      window.FaceScore.initCommon();
    }
    // Split hero h1 into kinetic words after common init.
    const hero = document.querySelector("[data-kinetic]");
    if (hero && window.FaceScore?.splitToWords) {
      window.FaceScore.splitToWords(hero);
    }
  });
})();
