(() => {
  "use strict";

  const FS = window.FaceScore;
  const Vision = window.FaceScoreVision;
  const CFGX = FS.cfg;
  const PHI = 1.61803398875;
  const DETECTION_INTERVAL_MS = 150;
  const MAX_HISTORY_MS = 950;
  const FRAME_SEND_TIMEOUT_MS = 20_000;
  const FREE_SECONDS = Math.max(10, Number(CFGX.FREE_DEMO_SECONDS) || 60);
  const $ = (id) => document.getElementById(id);

  // Wrap a model.send() promise in a timeout so a hung runtime triggers
  // recovery instead of freezing the frame loop indefinitely.
  function withFrameTimeout(sendPromise) {
    let timeoutId = 0;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error("Local model send timed out.")),
        FRAME_SEND_TIMEOUT_MS,
      );
    });
    return Promise.race([sendPromise, timeout]).finally(() =>
      window.clearTimeout(timeoutId),
    );
  }

  const els = {
    video: $("video"),
    overlay: $("overlayCanvas"),
    analysisCanvas: $("analysisCanvas"),
    cameraCard: $("cameraCard"),
    cameraViewport: $("cameraViewport"),
    faceGuide: $("faceGuide"),
    launchOverlay: $("launchOverlay"),
    startButton: $("startButton"),
    stopButton: $("stopButton"),
    saveButton: $("saveButton"),
    exportButton: $("exportButton"),
    launchNote: $("launchNote"),
    runtimeProgress: $("runtimeProgress"),
    runtimeProgressLabel: $("runtimeProgressLabel"),
    runtimeRecovery: $("runtimeRecovery"),
    runtimeRecoveryTitle: $("runtimeRecoveryTitle"),
    runtimeRecoveryDetail: $("runtimeRecoveryDetail"),
    runtimeRecoveryTechnical: $("runtimeRecoveryTechnical"),
    retryAnalysisButton: $("retryAnalysisButton"),
    reloadAppButton: $("reloadAppButton"),
    cameraMessage: $("cameraMessage"),
    modelChip: $("modelChip"),
    statusPill: $("statusPill"),
    statusLabel: $("statusLabel"),
    symmetryValue: $("symmetryValue"),
    symmetryFill: $("symmetryFill"),
    symmetryDetail: $("symmetryDetail"),
    phiValue: $("phiValue"),
    phiFill: $("phiFill"),
    phiDetail: $("phiDetail"),
    dynamicsValue: $("dynamicsValue"),
    dynamicsFill: $("dynamicsFill"),
    movementTag: $("movementTag"),
    overallValue: $("overallValue"),
    overallFill: $("overallFill"),
    poseQuality: $("poseQuality"),
    scaleQuality: $("scaleQuality"),
    lightQuality: $("lightQuality"),
    signalQuality: $("signalQuality"),
    qualityMessage: $("qualityMessage"),
    entitlementPill: $("entitlementPill"),
    demoTimer: $("demoTimer"),
    demoTimerValue: $("demoTimerValue"),
    toastStack: $("toastStack"),
    walkthroughModal: $("walkthroughModal"),
    settingsModal: $("settingsModal"),
    historyModal: $("historyModal"),
    paywallModal: $("paywallModal"),
    walkthroughButton: $("walkthroughButton"),
    historyButton: $("historyButton"),
    settingsButton: $("settingsButton"),
    walkthroughBack: $("walkthroughBack"),
    walkthroughNext: $("walkthroughNext"),
    disclaimerAccept: $("disclaimerAccept"),
    overlayToggle: $("overlayToggle"),
    motionToggle: $("motionToggle"),
    historyToggle: $("historyToggle"),
    settingsPlanBadge: $("settingsPlanBadge"),
    accessCodeInput: $("accessCodeInput"),
    activateCodeButton: $("activateCodeButton"),
    accessMessage: $("accessMessage"),
    removeAccessButton: $("removeAccessButton"),
    historyList: $("historyList"),
    clearHistoryButton: $("clearHistoryButton"),
    paywallPayments: $("paywallPayments"),
    paywallEmpty: $("paywallEmpty"),
    paywallActivateButton: $("paywallActivateButton"),
    restartDemoButton: $("restartDemoButton"),
    bndrReportButton: $("bndrReportButton"),
    bndrLaunchReportButton: $("bndrLaunchReportButton"),
  };

  const ctx = els.overlay.getContext("2d");
  const analysisCtx = els.analysisCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  const state = {
    model: null,
    modelReady: false,
    modelLoading: null,
    stream: null,
    running: false,
    processing: false,
    raf: 0,
    videoFrameCallback: 0,
    recovering: false,
    recoveryAttempts: 0,
    startupGeneration: 0,
    lastRuntimeError: null,
    lastProcessAt: 0,
    cssWidth: 0,
    cssHeight: 0,
    dpr: 1,
    featureHistory: [],
    luminance: { mean: 0, contrast: 0, detail: 0, sampledAt: 0 },
    smoothed: { symmetry: null, phi: null, dynamics: null, overall: null },
    messageTimer: 0,
    selfTestResolver: null,
    walkthroughStep: 0,
    pendingStart: false,
    demoUsed: Math.max(0, Number(FS.readRaw("demo_used_seconds")) || 0),
    demoInterval: 0,
    currentSnapshot: null,
    preferences: Object.assign(
      {
        overlay: true,
        reduceMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        saveHistory: true,
      },
      FS.getJSON("preferences", {}),
    ),
  };

  const CONTOURS = [
    [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
      378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
      162, 21, 54, 103, 67, 109, 10,
    ],
    [33, 160, 158, 133, 153, 144, 33],
    [362, 385, 387, 263, 373, 380, 362],
    [
      61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17,
      84, 181, 91, 146, 61,
    ],
  ];
  const SYMMETRY_PAIRS = [
    [33, 263],
    [133, 362],
    [160, 387],
    [159, 386],
    [158, 385],
    [157, 384],
    [173, 398],
    [246, 466],
    [70, 300],
    [63, 293],
    [105, 334],
    [66, 296],
    [107, 336],
    [234, 454],
    [93, 323],
    [132, 361],
    [58, 288],
    [172, 397],
    [136, 365],
    [150, 379],
    [149, 378],
    [176, 400],
    [148, 377],
    [129, 358],
    [98, 327],
    [61, 291],
    [78, 308],
    [191, 415],
    [80, 310],
    [81, 311],
    [82, 312],
    [87, 317],
    [88, 318],
    [95, 324],
  ];
  const LEFT_EYE = [33, 133, 159, 145, 153, 154, 155, 173];
  const RIGHT_EYE = [362, 263, 386, 374, 380, 381, 382, 398];

  window.__FSM_TEST__ = { status: "idle", details: "" };

  function clamp(v, min = 0, max = 100) {
    return Math.max(min, Math.min(max, v));
  }
  function mean(values) {
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  }
  function median(values) {
    if (!values.length) return 0;
    const a = [...values].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function dist2D(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function avgPoint(points, indices) {
    const usable = indices.map((i) => points[i]).filter(Boolean);
    return {
      x: mean(usable.map((p) => p.x)),
      y: mean(usable.map((p) => p.y)),
      z: mean(usable.map((p) => p.z || 0)),
    };
  }
  function ema(previous, next, factor) {
    return previous == null ? next : previous + (next - previous) * factor;
  }
  function scoreClass(value) {
    return value >= 72 ? "good" : value >= 46 ? "warn" : "bad";
  }
  function disclaimerAccepted() {
    return FS.readRaw("disclaimer") === CFGX.TERMS_VERSION;
  }
  function persistPreferences() {
    FS.setJSON("preferences", state.preferences, FS.optionalStorageAllowed());
  }

  function toast(message) {
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = message;
    els.toastStack.appendChild(item);
    setTimeout(() => item.remove(), 3600);
  }
  function setStatus(label, tone = "") {
    els.statusLabel.textContent = label;
    els.statusPill.className = `status-pill ${tone}`.trim();
  }
  function showMessage(text, tone = "", sticky = false) {
    clearTimeout(state.messageTimer);
    els.cameraMessage.textContent = text;
    els.cameraMessage.className = `camera-message visible ${tone}`.trim();
    if (!sticky)
      state.messageTimer = setTimeout(() => {
        els.cameraMessage.className = "camera-message";
      }, 2700);
  }
  function setQuality(el, value) {
    el.textContent = `${Math.round(value)}%`;
    el.className = scoreClass(value);
  }
  function updateEntitlement() {
    const pro = FS.hasPro();
    const studio = FS.hasStudio();
    const label = studio ? "STUDIO ACTIVE" : pro ? "PRO ACTIVE" : "FREE DEMO";
    els.entitlementPill.textContent = label;
    els.settingsPlanBadge.textContent = label;
    els.removeAccessButton.hidden = !pro;
    els.demoTimer.hidden = pro || !state.running;
    if (pro) clearDemoTimer();
    updateActionButtons();
  }
  function updateActionButtons() {
    const hasResult = Boolean(state.currentSnapshot);
    const pro = FS.hasPro();
    els.saveButton.disabled = !(pro && hasResult);
    els.exportButton.disabled = !(pro && hasResult);
  }
  function resetScores(message = "Waiting for a measurable frontal frame") {
    state.smoothed = {
      symmetry: null,
      phi: null,
      dynamics: null,
      overall: null,
    };
    state.currentSnapshot = null;
    els.symmetryValue.textContent = "--";
    els.symmetryFill.style.width = "0%";
    els.symmetryDetail.textContent = message;
    els.phiValue.textContent = "--";
    els.phiFill.style.width = "0%";
    els.phiDetail.textContent = "Reference ratio: 1.618";
    els.dynamicsValue.textContent = "--";
    els.dynamicsFill.style.width = "0%";
    els.movementTag.textContent = "WAITING";
    els.overallValue.textContent = "--";
    els.overallFill.style.width = "0%";
    updateActionButtons();
  }

  // Focus trap for modal dialogs. When a modal is open, Tab and Shift+Tab
  // cycle focus within the modal only — keyboard users cannot escape to
  // background controls. State is tracked so Escape still closes the modal
  // (handled by the global Escape listener below).
  let activeTrap = null;

  function trapFocus(modal) {
    if (!modal) return null;
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      [...modal.querySelectorAll(selector)].filter(
        (el) =>
          !el.hidden &&
          el.getClientRects().length > 0 &&
          el.getAttribute("aria-hidden") !== "true",
      );
    const onFocus = (event) => {
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !modal.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    modal.addEventListener("keydown", onFocus);
    return {
      modal,
      release() {
        modal.removeEventListener("keydown", onFocus);
      },
    };
  }

  function openModal(modal) {
    if (!modal) return;
    document.querySelectorAll(".modal-backdrop:not([hidden])").forEach((m) => {
      if (m !== modal) m.hidden = true;
    });
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (activeTrap) activeTrap.release();
    activeTrap = trapFocus(modal);
    setTimeout(() => modal.querySelector("button, input, [href]")?.focus(), 0);
  }
  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (activeTrap && activeTrap.modal === modal) {
      activeTrap.release();
      activeTrap = null;
    }
    if (
      ![...document.querySelectorAll(".modal-backdrop")].some((m) => !m.hidden)
    )
      document.body.style.overflow = "";
  }
  document
    .querySelectorAll("[data-close-modal]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        closeModal(button.closest(".modal-backdrop")),
      ),
    );
  document.querySelectorAll(".modal-backdrop").forEach((modal) =>
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    }),
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape")
      document
        .querySelectorAll(".modal-backdrop:not([hidden])")
        .forEach(closeModal);
  });

  function showWalkthrough(step = 0) {
    state.walkthroughStep = clamp(step, 0, 3);
    renderWalkthrough();
    openModal(els.walkthroughModal);
  }
  function renderWalkthrough() {
    const slides = [
      ...els.walkthroughModal.querySelectorAll(".walkthrough-slide"),
    ];
    const bars = [
      ...els.walkthroughModal.querySelectorAll(".walkthrough-progress i"),
    ];
    slides.forEach((s, i) =>
      s.classList.toggle("active", i === state.walkthroughStep),
    );
    bars.forEach((b, i) =>
      b.classList.toggle("active", i <= state.walkthroughStep),
    );
    els.walkthroughBack.hidden = state.walkthroughStep === 0;
    els.walkthroughNext.textContent =
      state.walkthroughStep === 3 ? "I understand — continue" : "Next";
  }
  els.walkthroughBack.addEventListener("click", () => {
    state.walkthroughStep = Math.max(0, state.walkthroughStep - 1);
    renderWalkthrough();
  });
  els.walkthroughNext.addEventListener("click", () => {
    if (state.walkthroughStep < 3) {
      state.walkthroughStep++;
      renderWalkthrough();
      return;
    }
    if (!els.disclaimerAccept.checked) {
      toast("Please confirm that you understand the measurement limits.");
      return;
    }
    FS.writeRaw("disclaimer", CFGX.TERMS_VERSION, true);
    closeModal(els.walkthroughModal);
    if (state.pendingStart) {
      state.pendingStart = false;
      startCameraSafely();
    }
  });

  function applyPreferences() {
    // When consent is "essential only", optional storage (preferences +
    // history) cannot persist. Force saveHistory=false to reflect that
    // metric history will not be retained, and reflect the same in the
    // toggle so the UI never lies about persisted state.
    if (!FS.optionalStorageAllowed()) {
      state.preferences.saveHistory = false;
    }
    els.overlayToggle.checked = Boolean(state.preferences.overlay);
    els.motionToggle.checked = Boolean(state.preferences.reduceMotion);
    els.historyToggle.checked = Boolean(state.preferences.saveHistory);
    els.historyToggle.disabled = !FS.optionalStorageAllowed();
    document.body.classList.toggle(
      "reduce-motion",
      Boolean(state.preferences.reduceMotion),
    );
    if (!state.preferences.overlay) clearOverlay();
  }
  els.overlayToggle.addEventListener("change", () => {
    state.preferences.overlay = els.overlayToggle.checked;
    persistPreferences();
    if (!state.preferences.overlay) clearOverlay();
  });
  els.motionToggle.addEventListener("change", () => {
    state.preferences.reduceMotion = els.motionToggle.checked;
    applyPreferences();
    persistPreferences();
  });
  els.historyToggle.addEventListener("change", () => {
    // Refuse to enable history when consent is "essential only" — there is
    // nowhere safe to persist it.
    if (!FS.optionalStorageAllowed()) {
      els.historyToggle.checked = false;
      state.preferences.saveHistory = false;
      toast("Allow preferences storage to enable metric history.");
      return;
    }
    state.preferences.saveHistory = els.historyToggle.checked;
    persistPreferences();
  });

  async function activateCode() {
    els.activateCodeButton.disabled = true;
    els.accessMessage.textContent = "Checking code…";
    try {
      const result = await FS.verifyAccessCode(els.accessCodeInput.value);
      if (!result) {
        els.accessMessage.textContent = "That code is not valid.";
        return;
      }
      const tierLabel = result === "studio" ? "Mirror Studio" : "Mirror Pro";
      els.accessMessage.textContent = `${tierLabel} is active on this browser.`;
      els.accessCodeInput.value = "";
      updateEntitlement();
      closeModal(els.paywallModal);
      toast(`${tierLabel} unlocked.`);
    } catch {
      els.accessMessage.textContent = "This browser could not verify the code.";
    } finally {
      els.activateCodeButton.disabled = false;
    }
  }
  els.activateCodeButton.addEventListener("click", activateCode);
  els.accessCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") activateCode();
  });
  els.removeAccessButton.addEventListener("click", () => {
    FS.revokePro();
    updateEntitlement();
    els.accessMessage.textContent = "Access removed from this browser.";
    toast("Pro access removed.");
  });

  function getHistory() {
    return FS.getJSON("history", []);
  }
  function setHistory(items) {
    FS.setJSON("history", items.slice(0, 20), FS.optionalStorageAllowed());
  }
  function saveCurrentResult() {
    if (!FS.hasPro()) {
      openPaywall();
      return;
    }
    if (!state.currentSnapshot) {
      toast("Hold a measurable frame before saving.");
      return;
    }
    if (!state.preferences.saveHistory || !FS.optionalStorageAllowed()) {
      toast("Turn on metric history in Settings first.");
      return;
    }
    const items = getHistory();
    items.unshift({
      ...state.currentSnapshot,
      savedAt: new Date().toISOString(),
    });
    setHistory(items);
    renderHistory();
    toast("Metric snapshot saved locally.");
  }
  function renderHistory() {
    const items = getHistory();
    els.historyList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "No saved snapshots yet.";
      els.historyList.appendChild(empty);
      els.clearHistoryButton.hidden = true;
      return;
    }
    els.clearHistoryButton.hidden = false;
    const labels = {
      overall: "Overall",
      symmetry: "Bilateral",
      phi: "Proportion",
      dynamics: "Dynamics",
    };
    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "history-row";
      const date = document.createElement("span");
      date.className = "history-date";
      date.textContent = new Date(
        item.savedAt || item.timestamp,
      ).toLocaleString();
      row.appendChild(date);
      for (const key of ["overall", "symmetry", "phi", "dynamics"]) {
        const cell = document.createElement("div");
        cell.className = `history-cell history-${key}`;
        const label = document.createElement("span");
        label.className = "history-cell-label";
        label.textContent = labels[key];
        const strong = document.createElement("strong");
        strong.title = labels[key];
        strong.textContent = Number.isFinite(item[key])
          ? Math.round(item[key])
          : "--";
        cell.appendChild(label);
        cell.appendChild(strong);
        row.appendChild(cell);
      }
      const del = document.createElement("button");
      del.className = "history-delete";
      del.type = "button";
      del.ariaLabel = `Delete snapshot ${index + 1}`;
      del.textContent = "×";
      del.addEventListener("click", () => {
        const next = getHistory();
        next.splice(index, 1);
        setHistory(next);
        renderHistory();
      });
      row.appendChild(del);
      els.historyList.appendChild(row);
    });
  }
  els.clearHistoryButton.addEventListener("click", () => {
    setHistory([]);
    renderHistory();
    toast("Local history deleted.");
  });

  function ensureExportModal() {
    let modal = $("exportModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "exportModal";
    modal.className = "modal-backdrop";
    modal.hidden = true;
    modal.innerHTML =
      '<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="exportTitle"><button class="modal-close" data-close-modal aria-label="Close">×</button><p class="eyebrow">PRIVATE EXPORT</p><h2 id="exportTitle">Choose a format</h2><p>Exports contain measurements and quality values only. No camera image is included.</p><div class="payment-buttons"><button class="button button-primary" data-export-json type="button">Download JSON</button><button class="button button-secondary" data-export-csv type="button">Download CSV</button><button class="button button-ghost" data-export-print type="button">Print / Save PDF</button></div></section>';
    document.body.appendChild(modal);
    // Wire the close button so it participates in the same data-close-modal
    // handler used by every other modal, and so Escape closes it via the
    // global keydown listener.
    modal
      .querySelector("[data-close-modal]")
      .addEventListener("click", () => closeModal(modal));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
    modal
      .querySelector("[data-export-json]")
      .addEventListener("click", () => exportJSON());
    modal
      .querySelector("[data-export-csv]")
      .addEventListener("click", () => exportCSV());
    modal.querySelector("[data-export-print]").addEventListener("click", () => {
      closeModal(modal);
      window.print();
    });
    return modal;
  }
  function safeFilename(ext) {
    return `facescore-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  }
  function exportJSON() {
    if (!state.currentSnapshot) return;
    FS.downloadText(
      safeFilename("json"),
      JSON.stringify(
        {
          product: CFGX.PRODUCT_NAME,
          disclaimer:
            "Geometry estimates only; not beauty, identity, health, emotion, or diagnosis.",
          ...state.currentSnapshot,
        },
        null,
        2,
      ),
      "application/json",
    );
    toast("JSON downloaded.");
  }
  function exportCSV() {
    if (!state.currentSnapshot) return;
    const s = state.currentSnapshot;
    const disclaimer =
      "# FaceScore Mirror export. Geometry estimates only; not beauty, identity, health, emotion, or diagnosis.";
    const rows = [
      [
        "timestamp",
        "overall",
        "bilateral_balance",
        "proportion_reference",
        "expression_dynamics",
        "pose_quality",
        "scale_quality",
        "light_quality",
        "signal_quality",
      ],
      [
        s.timestamp,
        s.overall,
        s.symmetry,
        s.phi,
        s.dynamics,
        s.quality.pose,
        s.quality.scale,
        s.quality.light,
        s.quality.signal,
      ],
    ];
    FS.downloadText(
      safeFilename("csv"),
      [disclaimer]
        .concat(
          rows.map((r) =>
            r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
          ),
        )
        .join("\n"),
      "text/csv",
    );
    toast("CSV downloaded.");
  }
  els.saveButton.addEventListener("click", saveCurrentResult);
  els.exportButton.addEventListener("click", () => {
    if (!FS.hasPro()) return openPaywall();
    if (state.currentSnapshot) openModal(ensureExportModal());
  });

  function openPaywall() {
    document
      .querySelectorAll("[data-price]")
      .forEach((el) => (el.textContent = CFGX.PRICE || "$29"));
    document
      .querySelectorAll("[data-price-note]")
      .forEach(
        (el) => (el.textContent = CFGX.PRICE_NOTE || "one-time purchase"),
      );
    FS.renderPaymentButtons(els.paywallPayments, {
      tier: "pro",
      emptyElement: els.paywallEmpty,
    });
    openModal(els.paywallModal);
  }
  els.paywallActivateButton.addEventListener("click", () => {
    closeModal(els.paywallModal);
    openModal(els.settingsModal);
    setTimeout(() => els.accessCodeInput.focus(), 50);
  });
  els.restartDemoButton.addEventListener("click", () =>
    closeModal(els.paywallModal),
  );

  function formatSeconds(seconds) {
    const n = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  }
  function remainingDemo() {
    return Math.max(0, FREE_SECONDS - state.demoUsed);
  }
  function updateDemoDisplay() {
    els.demoTimerValue.textContent = formatSeconds(remainingDemo());
    els.demoTimer.hidden = FS.hasPro() || !state.running;
  }
  function startDemoTimer() {
    clearDemoTimer();
    if (FS.hasPro()) return;
    updateDemoDisplay();
    state.demoInterval = setInterval(() => {
      if (!state.running) return;
      state.demoUsed += 1;
      FS.writeRaw("demo_used_seconds", Math.floor(state.demoUsed), true);
      updateDemoDisplay();
      if (remainingDemo() <= 0) {
        stopCamera();
        openPaywall();
        toast("The free camera demo is complete.");
        if (window.BNDRReporter?.recordAction)
          window.BNDRReporter.recordAction("demo-expired");
      }
    }, 1000);
  }
  function clearDemoTimer() {
    if (state.demoInterval) clearInterval(state.demoInterval);
    state.demoInterval = 0;
    updateDemoDisplay();
  }

  function resizeOverlay() {
    const rect = els.cameraViewport.getBoundingClientRect();
    state.cssWidth = Math.max(1, rect.width);
    state.cssHeight = Math.max(1, rect.height);
    state.dpr = Math.min(devicePixelRatio || 1, 2);
    els.overlay.width = Math.round(state.cssWidth * state.dpr);
    els.overlay.height = Math.round(state.cssHeight * state.dpr);
    els.overlay.style.width = `${state.cssWidth}px`;
    els.overlay.style.height = `${state.cssHeight}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }
  function clearOverlay() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
    ctx.restore();
  }
  function videoToViewport(point) {
    const vw = els.video.videoWidth || 1,
      vh = els.video.videoHeight || 1,
      scale = Math.max(state.cssWidth / vw, state.cssHeight / vh),
      displayW = vw * scale,
      displayH = vh * scale;
    return {
      x: (state.cssWidth - displayW) / 2 + point.x * vw * scale,
      y: (state.cssHeight - displayH) / 2 + point.y * vh * scale,
    };
  }
  function drawOverlay(points) {
    clearOverlay();
    if (!state.preferences.overlay || !points?.length) return;
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(232,189,119,.3)";
    ctx.fillStyle = "rgba(247,214,157,.78)";
    ctx.shadowColor = "rgba(232,189,119,.3)";
    ctx.shadowBlur = 4;
    for (const contour of CONTOURS) {
      ctx.beginPath();
      contour.forEach((index, i) => {
        const p = videoToViewport(points[index]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }
    for (const index of [
      10, 152, 234, 454, 1, 33, 133, 263, 362, 61, 291, 13, 14,
    ]) {
      const p = videoToViewport(points[index]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  function normalizedFrame(points) {
    const leftEye = avgPoint(points, LEFT_EYE),
      rightEye = avgPoint(points, RIGHT_EYE),
      eyeDistance = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
    if (!Number.isFinite(eyeDistance) || eyeDistance < 0.001) return null;
    const center = {
      x: (leftEye.x + rightEye.x) / 2,
      y: (leftEye.y + rightEye.y) / 2,
      z: (leftEye.z + rightEye.z) / 2,
    };
    const angle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x),
      c = Math.cos(angle),
      s = Math.sin(angle);
    return {
      points: points.map((p) => {
        const dx = p.x - center.x,
          dy = p.y - center.y;
        return {
          x: (dx * c + dy * s) / eyeDistance,
          y: (-dx * s + dy * c) / eyeDistance,
          z: ((p.z || 0) - center.z) / eyeDistance,
        };
      }),
      eyeDistance,
      eyeCenter: center,
      roll: angle,
    };
  }
  function sampleImageQuality(points, now) {
    if (now - state.luminance.sampledAt < 420) return state.luminance;
    const minX = clamp(Math.min(...points.map((p) => p.x)), 0, 1),
      maxX = clamp(Math.max(...points.map((p) => p.x)), 0, 1),
      minY = clamp(Math.min(...points.map((p) => p.y)), 0, 1),
      maxY = clamp(Math.max(...points.map((p) => p.y)), 0, 1),
      w = els.analysisCanvas.width,
      h = els.analysisCanvas.height;
    analysisCtx.drawImage(els.video, 0, 0, w, h);
    const x0 = Math.min(w - 1, Math.max(0, Math.floor(minX * w))),
      y0 = Math.min(h - 1, Math.max(0, Math.floor(minY * h))),
      rw = Math.max(
        1,
        Math.min(w - x0, Math.max(8, Math.floor((maxX - minX) * w))),
      ),
      rh = Math.max(
        1,
        Math.min(h - y0, Math.max(8, Math.floor((maxY - minY) * h))),
      ),
      data = analysisCtx.getImageData(x0, y0, rw, rh).data,
      gray = [];
    let detailSum = 0,
      detailCount = 0,
      previous = null;
    for (let i = 0; i < data.length; i += 16) {
      const g = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      gray.push(g);
      if (previous != null) {
        detailSum += Math.abs(g - previous);
        detailCount++;
      }
      previous = g;
    }
    const m = mean(gray),
      sd = Math.sqrt(mean(gray.map((v) => (v - m) * (v - m))));
    state.luminance = {
      mean: m,
      contrast: sd,
      detail: detailCount ? detailSum / detailCount : 0,
      sampledAt: now,
    };
    return state.luminance;
  }
  function computeQuality(points, frame, now) {
    const p = frame.points,
      nose = p[1],
      yawProxy = Math.abs(nose.x),
      pose = clamp(100 * (1 - (yawProxy - 0.018) / 0.105)),
      leftRaw = avgPoint(points, LEFT_EYE),
      rightRaw = avgPoint(points, RIGHT_EYE),
      eyePx = Math.hypot(
        (rightRaw.x - leftRaw.x) * els.video.videoWidth,
        (rightRaw.y - leftRaw.y) * els.video.videoHeight,
      ),
      scale = clamp(((eyePx - 45) / 85) * 100),
      lum = sampleImageQuality(points, now),
      lightRange =
        lum.mean < 105 ? (lum.mean - 35) / 70 : (235 - lum.mean) / 130,
      light = clamp(lightRange * 100),
      signal = clamp(
        ((lum.contrast - 8) / 28) * 100 * 0.75 +
          ((lum.detail - 2) / 10) * 100 * 0.25,
      ),
      gate = pose >= 45 && scale >= 40 && light >= 36 && signal >= 25;
    let message = "Measurement quality is sufficient.";
    if (pose < 45) message = "Turn directly toward the camera.";
    else if (scale < 40)
      message = "Move closer until your face fills more of the guide.";
    else if (light < 36)
      message =
        lum.mean < 80
          ? "Add soft front lighting."
          : "Reduce harsh overexposure.";
    else if (signal < 25) message = "Hold still and improve image clarity.";
    return {
      pose,
      scale,
      light,
      signal,
      gate,
      message,
      yawProxy,
      eyePx,
      luminance: lum,
    };
  }
  function computeSymmetry(frame) {
    const errors = [];
    for (const [left, right] of SYMMETRY_PAIRS) {
      const a = frame.points[left],
        b = frame.points[right];
      if (!a || !b) continue;
      errors.push(
        Math.hypot(
          Math.abs(a.x + b.x),
          Math.abs(a.y - b.y),
          Math.abs(a.z - b.z) * 0.28,
        ),
      );
    }
    const robustError = median(errors);
    return {
      score: clamp(100 * Math.exp(-4.9 * robustError)),
      error: robustError,
    };
  }
  function computePhi(frame) {
    const p = frame.points,
      faceHeight = dist2D(p[10], p[152]),
      faceWidth = dist2D(p[234], p[454]),
      ratio = faceWidth > 0 ? faceHeight / faceWidth : 0,
      deviation = ratio > 0 ? Math.abs(Math.log(ratio / PHI)) : Infinity;
    return { score: clamp(100 * Math.exp(-2.8 * deviation)), ratio };
  }
  function expressionFeatures(frame) {
    const p = frame.points;
    return [
      dist2D(p[159], p[145]) / Math.max(0.001, dist2D(p[33], p[133])),
      dist2D(p[386], p[374]) / Math.max(0.001, dist2D(p[263], p[362])),
      dist2D(p[13], p[14]),
      dist2D(p[61], p[291]),
      dist2D(p[105], p[159]),
      dist2D(p[334], p[386]),
      p[61].y - p[291].y,
    ];
  }
  function computeDynamics(frame, now) {
    const vector = expressionFeatures(frame);
    state.featureHistory.push({ t: now, v: vector });
    state.featureHistory = state.featureHistory.filter(
      (item) => now - item.t <= MAX_HISTORY_MS,
    );
    if (state.featureHistory.length < 4) return { score: 0, velocity: 0 };
    const velocities = [];
    for (let i = 1; i < state.featureHistory.length; i++) {
      const a = state.featureHistory[i - 1],
        b = state.featureHistory[i],
        dt = Math.max(0.01, (b.t - a.t) / 1000),
        dv = Math.sqrt(
          mean(b.v.map((value, j) => Math.pow(value - a.v[j], 2))),
        );
      velocities.push(dv / dt);
    }
    const velocity = median(velocities);
    return { score: clamp(((velocity - 0.008) / 0.17) * 100), velocity };
  }
  function movementLabel(score) {
    if (score < 12) return "STABLE";
    if (score < 34) return "SUBTLE";
    if (score < 67) return "ACTIVE";
    return "DYNAMIC";
  }
  function renderQuality(q) {
    setQuality(els.poseQuality, q.pose);
    setQuality(els.scaleQuality, q.scale);
    setQuality(els.lightQuality, q.light);
    setQuality(els.signalQuality, q.signal);
    els.qualityMessage.textContent = q.message;
  }
  function renderMetrics(symmetry, phi, dynamics, quality) {
    state.smoothed.symmetry = ema(
      state.smoothed.symmetry,
      symmetry.score,
      0.22,
    );
    state.smoothed.phi = ema(state.smoothed.phi, phi.score, 0.18);
    state.smoothed.dynamics = ema(
      state.smoothed.dynamics,
      dynamics.score,
      0.28,
    );
    const overallTarget =
      state.smoothed.symmetry * 0.7 + state.smoothed.phi * 0.3;
    state.smoothed.overall = ema(state.smoothed.overall, overallTarget, 0.2);
    const s = Math.round(state.smoothed.symmetry),
      p = Math.round(state.smoothed.phi),
      d = Math.round(state.smoothed.dynamics),
      o = Math.round(state.smoothed.overall);
    els.symmetryValue.textContent = s;
    els.symmetryFill.style.width = `${s}%`;
    els.symmetryDetail.textContent = `Residual bilateral deviation: ${(symmetry.error * 100).toFixed(1)}% of eye spacing`;
    els.phiValue.textContent = p;
    els.phiFill.style.width = `${p}%`;
    els.phiDetail.textContent = `Measured ratio: ${phi.ratio.toFixed(3)} · reference: 1.618`;
    els.dynamicsValue.textContent = d;
    els.dynamicsFill.style.width = `${d}%`;
    els.movementTag.textContent = movementLabel(d);
    els.overallValue.textContent = o;
    els.overallFill.style.width = `${o}%`;
    state.currentSnapshot = {
      timestamp: new Date().toISOString(),
      symmetry: s,
      phi: p,
      dynamics: d,
      overall: o,
      ratio: Number(phi.ratio.toFixed(4)),
      bilateralDeviation: Number((symmetry.error * 100).toFixed(2)),
      quality: {
        pose: Math.round(quality.pose),
        scale: Math.round(quality.scale),
        light: Math.round(quality.light),
        signal: Math.round(quality.signal),
      },
    };
    const printTs = document.getElementById("printTimestamp");
    if (printTs)
      printTs.textContent = `Report generated ${new Date().toLocaleString()}`;
    updateActionButtons();
  }
  function handleResults(results) {
    if (state.selfTestResolver) {
      const resolve = state.selfTestResolver;
      state.selfTestResolver = null;
      resolve(true);
    }
    const faces = results?.multiFaceLandmarks;
    if (!state.running || !faces?.length) {
      if (state.running) {
        els.cameraCard.classList.remove("tracking");
        clearOverlay();
        state.featureHistory = [];
        resetScores("No face detected");
        els.qualityMessage.textContent = "Center one face inside the guide.";
        showMessage("Center one face inside the guide", "warning");
      }
      return;
    }
    const points = faces[0];
    els.cameraCard.classList.add("tracking");
    drawOverlay(points);
    const frame = normalizedFrame(points);
    if (!frame) {
      resetScores("Unable to establish eye baseline");
      return;
    }
    const now = performance.now(),
      quality = computeQuality(points, frame, now);
    renderQuality(quality);
    if (!quality.gate) {
      state.featureHistory = [];
      resetScores(quality.message);
      showMessage(quality.message, "warning");
      return;
    }
    const symmetry = computeSymmetry(frame),
      phi = computePhi(frame),
      dynamics = computeDynamics(frame, now);
    renderMetrics(symmetry, phi, dynamics, quality);
  }
  function setStartupStage(stage, label) {
    els.runtimeProgress.hidden = false;
    els.runtimeProgress.dataset.stage = stage;
    els.runtimeProgressLabel.textContent = label;
    els.startButton.textContent = label;
    els.modelChip.textContent =
      stage === "ready" ? "MODEL READY" : "MODEL LOADING";
    els.modelChip.classList.add("active");
    setStatus(
      stage === "ready" ? "READY" : "LOADING",
      stage === "ready" ? "" : "warning",
    );
  }

  function clearStartupStage() {
    els.runtimeProgress.hidden = true;
    delete els.runtimeProgress.dataset.stage;
  }

  function hideRuntimeRecovery() {
    els.runtimeRecovery.hidden = true;
    state.lastRuntimeError = null;
    if (els.bndrReportButton) els.bndrReportButton.hidden = true;
    if (els.bndrLaunchReportButton) els.bndrLaunchReportButton.hidden = true;
  }

  function showRuntimeRecovery(error) {
    const issue = Vision.classifyError(error);
    issue.error = error;
    state.lastRuntimeError = issue;
    els.runtimeRecoveryTitle.textContent = issue.title;
    els.runtimeRecoveryDetail.textContent = issue.detail;
    els.runtimeRecoveryTechnical.textContent = issue.technical;
    els.runtimeRecovery.hidden = false;
    els.modelChip.textContent = "MODEL PAUSED";
    setStatus("PAUSED", "error");
    // Reveal the BNDR.Labs trigger after the auto-retry budget is exhausted.
    // The trigger is visible only when the failure is genuinely unrecoverable
    // from the user's perspective.
    if (els.bndrReportButton && state.recoveryAttempts >= 1) {
      els.bndrReportButton.hidden = false;
    }
    return issue;
  }

  function closeModel() {
    try {
      state.model?.close?.();
    } catch {
      // MediaPipe cleanup is best-effort after a failed runtime.
    }
    state.model = null;
    state.modelReady = false;
  }

  async function initializeModel({ force = false } = {}) {
    if (state.modelReady && state.model && !force) return state.model;
    if (state.modelLoading && !force) return state.modelLoading;

    if (force) closeModel();

    state.modelLoading = Vision.prepareModel({
      onResults: handleResults,
      assetBase: "vendor/",
      onStage: setStartupStage,
    })
      .then((model) => {
        state.model = model;
        state.modelReady = true;
        els.modelChip.textContent = "MODEL READY";
        els.modelChip.classList.add("active");
        setStatus("READY");
        return model;
      })
      .catch((error) => {
        closeModel();
        els.modelChip.textContent = "MODEL ERROR";
        setStatus("ERROR", "error");
        throw error;
      })
      .finally(() => {
        state.modelLoading = null;
      });

    return state.modelLoading;
  }

  function attachTrackGuards(stream) {
    for (const track of stream.getVideoTracks()) {
      track.addEventListener(
        "ended",
        () => {
          if (!state.running) return;
          stopCamera();
          els.launchNote.textContent =
            "The camera disconnected. Re-enable it, then retry.";
          els.launchNote.classList.add("error");
          showMessage("The camera disconnected.", "error", true);
        },
        { once: true },
      );
    }
  }

  async function startCamera() {
    if (state.running) return;
    if (!FS.hasPro() && remainingDemo() <= 0) {
      openPaywall();
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera access requires HTTPS or localhost in a supported browser.",
      );
    }

    const generation = ++state.startupGeneration;
    els.startButton.disabled = true;
    els.launchNote.classList.remove("error");
    hideRuntimeRecovery();

    setStartupStage("runtime-check", "Preparing private engine…");
    await initializeModel();
    if (generation !== state.startupGeneration) return;

    setStartupStage("camera-request", "Waiting for camera permission…");
    const stream = await Vision.requestCamera();
    if (generation !== state.startupGeneration) {
      Vision.stopStream(stream);
      return;
    }

    state.stream = stream;
    attachTrackGuards(stream);
    setStartupStage("camera-start", "Starting camera preview…");

    try {
      await Vision.attachStream(els.video, stream);
    } catch (error) {
      Vision.stopStream(stream);
      state.stream = null;
      els.video.srcObject = null;
      throw error;
    }

    resizeOverlay();
    state.running = true;
    state.processing = false;
    state.recovering = false;
    state.recoveryAttempts = 0;
    state.lastProcessAt = 0;
    state.featureHistory = [];

    clearStartupStage();
    els.launchOverlay.classList.add("hidden");
    els.stopButton.disabled = false;
    els.startButton.disabled = false;
    els.startButton.textContent = "Enable camera";
    setStatus("ACTIVE", "active");
    els.modelChip.textContent = "MODEL ACTIVE";
    showMessage("Private vision engine active.");
    startDemoTimer();
    scheduleNextFrame();
  }

  async function startCameraSafely() {
    if (!disclaimerAccepted()) {
      state.pendingStart = true;
      showWalkthrough(0);
      return;
    }

    try {
      await startCamera();
    } catch (error) {
      console.error(error);
      const issue = Vision.classifyError(error);
      issue.error = error;
      state.lastRuntimeError = issue;
      clearStartupStage();
      setStatus("ERROR", "error");
      els.launchNote.textContent = issue.detail;
      els.launchNote.classList.add("error");
      els.startButton.disabled = false;
      els.startButton.textContent = "Retry camera";
      els.modelChip.textContent = issue.code.startsWith("CAMERA_")
        ? state.modelReady
          ? "MODEL READY"
          : "MODEL IDLE"
        : "MODEL ERROR";
      showMessage(issue.title, "error", true);
      // Reveal the BNDR.Labs trigger for non-camera failures (model runtime,
      // WebGL/WASM unavailable, asset load, timeout). Camera failures are
      // user-recoverable (grant permission / connect camera) and do not
      // surface the trigger.
      if (els.bndrLaunchReportButton && !issue.code.startsWith("CAMERA_")) {
        els.bndrLaunchReportButton.hidden = false;
      }
      if (state.stream) {
        Vision.stopStream(state.stream);
        state.stream = null;
        els.video.srcObject = null;
      }
    }
  }

  function cancelFrameLoop() {
    if (state.videoFrameCallback && els.video.cancelVideoFrameCallback) {
      els.video.cancelVideoFrameCallback(state.videoFrameCallback);
    }
    state.videoFrameCallback = 0;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function scheduleNextFrame() {
    if (!state.running || state.recovering || document.hidden) return;
    if (typeof els.video.requestVideoFrameCallback === "function") {
      state.videoFrameCallback = els.video.requestVideoFrameCallback((now) => {
        state.videoFrameCallback = 0;
        processFrame(now);
      });
    } else {
      state.raf = requestAnimationFrame((now) => {
        state.raf = 0;
        processFrame(now);
      });
    }
  }

  async function retryAnalysis({ automatic = false } = {}) {
    if (!state.stream || !state.running || state.modelLoading) return;

    state.recovering = true;
    cancelFrameLoop();
    els.retryAnalysisButton.disabled = true;
    els.runtimeRecovery.hidden = false;
    els.runtimeRecoveryTitle.textContent = automatic
      ? "Restarting the local engine…"
      : "Repairing the local engine…";
    els.runtimeRecoveryDetail.textContent =
      "The camera remains private and active while the model restarts.";
    setStatus("RECOVERING", "warning");

    try {
      await initializeModel({ force: true });
      state.recovering = false;
      if (!automatic) state.recoveryAttempts = 0;
      hideRuntimeRecovery();
      els.modelChip.textContent = "MODEL ACTIVE";
      setStatus("ACTIVE", "active");
      showMessage("Analysis recovered.");
      if (!automatic) scheduleNextFrame();
    } catch (error) {
      showRuntimeRecovery(error);
      state.recovering = true;
      if (window.BNDRReporter?.recordAction)
        window.BNDRReporter.recordAction(
          "recovery-failed",
          String(error?.name || "Error").slice(0, 60),
        );
    } finally {
      els.retryAnalysisButton.disabled = false;
    }
  }

  async function handleProcessingFailure(error) {
    console.error(error);
    cancelFrameLoop();
    state.processing = false;
    state.recovering = true;
    resetScores("Analysis paused while the local engine recovers");

    const issue = showRuntimeRecovery(error);
    const transient = ["RUNTIME_ERROR", "MODEL_TIMEOUT"].includes(issue.code);
    if (transient && state.recoveryAttempts < 1) {
      state.recoveryAttempts += 1;
      await retryAnalysis({ automatic: true });
    }
  }

  async function processFrame(now) {
    if (!state.running || state.recovering) return;

    const ready =
      state.modelReady &&
      state.model &&
      els.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    const intervalElapsed = now - state.lastProcessAt >= DETECTION_INTERVAL_MS;

    if (!ready || !intervalElapsed || state.processing) {
      scheduleNextFrame();
      return;
    }

    state.processing = true;
    state.lastProcessAt = now;
    try {
      await withFrameTimeout(state.model.send({ image: els.video }));
      state.recoveryAttempts = 0;
    } catch (error) {
      await handleProcessingFailure(error);
    } finally {
      state.processing = false;
    }

    scheduleNextFrame();
  }

  function stopCamera() {
    state.startupGeneration += 1;
    state.running = false;
    state.recovering = false;
    cancelFrameLoop();
    state.processing = false;
    state.featureHistory = [];
    clearDemoTimer();
    Vision.stopStream(state.stream);
    state.stream = null;
    els.video.pause();
    els.video.srcObject = null;
    clearOverlay();
    hideRuntimeRecovery();
    clearStartupStage();
    els.cameraCard.classList.remove("tracking");
    els.launchOverlay.classList.remove("hidden");
    els.stopButton.disabled = true;
    els.startButton.disabled = false;
    els.startButton.textContent = "Enable camera";
    els.modelChip.textContent = state.modelReady ? "MODEL READY" : "MODEL IDLE";
    setStatus("READY");
    resetScores();
    [
      els.poseQuality,
      els.scaleQuality,
      els.lightQuality,
      els.signalQuality,
    ].forEach((element) => {
      element.textContent = "--";
      element.className = "";
    });
    els.qualityMessage.textContent = "Enable the camera to begin.";
  }

  async function runSelfTest() {
    window.__FSM_TEST__ = { status: "running", details: "" };
    try {
      await initializeModel({ force: true });
      window.__FSM_TEST__ = {
        status: "passed",
        details: `Bundled runtime, WASM, graph, and model assets loaded locally. SIMD: ${Vision.supportsSimd() ? "yes" : "fallback"}.`,
      };
      document.documentElement.dataset.selftest = "passed";
      els.launchNote.textContent =
        "System check passed — the local model and bundled assets are ready.";
      els.launchNote.classList.remove("error");
      showMessage("System check passed.");
    } catch (error) {
      const issue = Vision.classifyError(error);
      window.__FSM_TEST__ = {
        status: "failed",
        details: `${issue.code}: ${issue.technical}`,
      };
      document.documentElement.dataset.selftest = "failed";
      els.launchNote.textContent = issue.detail;
      els.launchNote.classList.add("error");
      showMessage(issue.title, "error", true);
      console.error("Self-test failed:", error);
    } finally {
      clearStartupStage();
    }
  }

  els.startButton.addEventListener("click", startCameraSafely);
  els.stopButton.addEventListener("click", stopCamera);
  els.retryAnalysisButton.addEventListener("click", () => retryAnalysis());
  els.reloadAppButton.addEventListener("click", () => {
    stopCamera();
    location.reload();
  });
  els.walkthroughButton.addEventListener("click", () => showWalkthrough(0));
  els.settingsButton.addEventListener("click", () =>
    openModal(els.settingsModal),
  );
  els.historyButton.addEventListener("click", () => {
    renderHistory();
    openModal(els.historyModal);
  });

  // BNDR.Labs hidden one-click diagnostic report triggers. The user-facing
  // surface reveals none of the internal material — only the canned
  // acknowledgment message is shown after the click. The diagnostic package
  // is sent to FACESCORE_CONFIG.BNDR_REPORT_ENDPOINT when configured.
  if (window.BNDRReporter) {
    if (els.bndrReportButton) {
      window.BNDRReporter.attachTrigger(els.bndrReportButton, () => {
        const issue = state.lastRuntimeError || {
          code: "RUNTIME_ERROR",
          title: "Analysis paused",
          detail: "The local engine could not recover.",
          technical: "",
          error: null,
        };
        return issue;
      });
    }
    if (els.bndrLaunchReportButton) {
      window.BNDRReporter.attachTrigger(els.bndrLaunchReportButton, () => {
        const issue = state.lastRuntimeError || {
          code: "RUNTIME_ERROR",
          title: "Camera could not start",
          detail: "The local engine or camera could not start.",
          technical: "",
          error: null,
        };
        return issue;
      });
    }
  }

  // Record high-level user actions for the BNDR.Labs diagnostic "reproducible
  // steps" field. Only anonymized action codes — never user input, never
  // camera data, never access codes.
  const recordAction = (code, detail = "") => {
    if (window.BNDRReporter?.recordAction)
      window.BNDRReporter.recordAction(code, detail);
  };
  els.startButton.addEventListener("click", () =>
    recordAction("start-camera"),
  );
  els.stopButton.addEventListener("click", () => recordAction("stop-camera"));
  els.retryAnalysisButton.addEventListener("click", () =>
    recordAction("retry-analysis"),
  );
  els.reloadAppButton.addEventListener("click", () =>
    recordAction("reload-app"),
  );
  els.walkthroughButton.addEventListener("click", () =>
    recordAction("open-walkthrough"),
  );
  els.settingsButton.addEventListener("click", () =>
    recordAction("open-settings"),
  );
  els.historyButton.addEventListener("click", () =>
    recordAction("open-history"),
  );
  els.saveButton.addEventListener("click", () =>
    recordAction("save-result"),
  );
  els.exportButton.addEventListener("click", () =>
    recordAction("open-export"),
  );
  els.activateCodeButton.addEventListener("click", () =>
    recordAction("activate-code"),
  );
  els.walkthroughNext.addEventListener("click", () =>
    recordAction("walkthrough-next", `step=${state.walkthroughStep}`),
  );
  els.paywallActivateButton.addEventListener("click", () =>
    recordAction("paywall-activate"),
  );
  window.addEventListener("resize", resizeOverlay, { passive: true });
  window.addEventListener("beforeunload", () => {
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  });
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
      cancelFrameLoop();
      return;
    }
    if (state.running) {
      try {
        await els.video.play();
      } catch (error) {
        showRuntimeRecovery(error);
        return;
      }
      scheduleNextFrame();
    }
  });
  document.addEventListener("facescore-consent", () => {
    persistPreferences();
    applyPreferences();
    renderHistory();
    if (window.BNDRReporter?.recordAction)
      window.BNDRReporter.recordAction(
        "consent-change",
        FS.getConsent ? FS.getConsent() : "",
      );
  });

  // Multi-tab sync: when another tab changes localStorage (e.g., grants or
  // revokes Pro access, changes consent, or updates preferences), this tab
  // re-reads the affected state and re-renders so the UI never lies about
  // persisted state.
  window.addEventListener("storage", (event) => {
    if (!event.key || !event.key.startsWith("facescore_")) return;
    if (event.key === "facescore_access") {
      updateEntitlement();
    } else if (event.key === "facescore_consent") {
      applyPreferences();
      renderHistory();
    } else if (event.key === "facescore_preferences") {
      state.preferences = Object.assign(
        {
          overlay: true,
          reduceMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          saveHistory: true,
        },
        FS.getJSON("preferences", {}),
      );
      applyPreferences();
    } else if (event.key === "facescore_history") {
      renderHistory();
    }
  });

  // App-specific init. Common setup (consent, support links, mobile nav,
  // reveal observer, SW registration, year stamp, payment buttons) runs
  // via initCommon. We then do app-only setup on top.
  if (FS.initCommon) FS.initCommon();
  applyPreferences();
  updateEntitlement();
  resizeOverlay();
  resetScores();
  renderHistory();
  if (!window.isSecureContext)
    els.launchNote.textContent =
      "Open through HTTPS or localhost — camera access is blocked on file://";
  if (!disclaimerAccepted()) setTimeout(() => showWalkthrough(0), 350);
  if (location.hash === "#activate")
    setTimeout(() => {
      openModal(els.settingsModal);
      els.accessCodeInput.focus();
    }, 350);
  if (new URLSearchParams(location.search).get("selftest") === "1")
    runSelfTest();
})();
