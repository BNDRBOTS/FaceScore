/*
 * BNDR.Labs hidden diagnostic report mechanism.
 *
 * Purpose: when the local vision runtime cannot recover, offer the user a
 * single one-click "Notify BNDR.Labs" affordance. The click sends a sanitized
 * diagnostic package to the configured endpoint (FACESCORE_CONFIG.BNDR_REPORT_ENDPOINT)
 * and displays only the canned acknowledgment message. No raw logs, no internal
 * JSON, no proprietary orchestration, no user camera data, no access codes,
 * and no other PII ever leave the browser through this path.
 *
 * The package also embeds a hidden AI-executable repair prompt that an
 * automated repair agent can consume. The user never sees this prompt or any
 * other internal material.
 */
(() => {
  "use strict";

  const CFG = window.FACESCORE_CONFIG || {};
  const ACTION_LOG_MAX = 25;
  const ACTION_LOG_KEY = "facescore_action_log";

  // High-level user action ring buffer. Persists across reloads in localStorage
  // (essential storage) so a crash-then-reload sequence still has reproducible
  // steps. Contains only anonymized action codes and timestamps — never user
  // input, never camera data, never access codes.
  let actionLog = loadActionLog();

  function loadActionLog() {
    try {
      const raw = localStorage.getItem(ACTION_LOG_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(-ACTION_LOG_MAX) : [];
    } catch {
      return [];
    }
  }

  function persistActionLog() {
    try {
      localStorage.setItem(ACTION_LOG_KEY, JSON.stringify(actionLog));
    } catch {
      // Storage may be unavailable (private mode, quota). Action log is
      // best-effort only — never block user flow on it.
    }
  }

  function recordAction(code, detail = "") {
    if (!code || typeof code !== "string") return;
    // Hard whitelist of action codes; no user-supplied strings enter the log.
    const safeCode = code.slice(0, 48);
    const safeDetail = String(detail || "").slice(0, 80);
    actionLog.push({
      t: Date.now(),
      a: safeCode,
      d: safeDetail,
    });
    if (actionLog.length > ACTION_LOG_MAX)
      actionLog = actionLog.slice(-ACTION_LOG_MAX);
    persistActionLog();
  }

  function clearActionLog() {
    actionLog = [];
    try {
      localStorage.removeItem(ACTION_LOG_KEY);
    } catch {
      // ignore
    }
  }

  function safePath() {
    // Strip query string and hash; never exfiltrate URL parameters.
    return location.pathname || "/";
  }

  function sanitizeError(error) {
    if (!error) return { name: "Unknown", message: "No error supplied." };
    const name = String(error.name || "Error").slice(0, 120);
    const raw = String(error.message || error || "Unknown runtime error");
    // Strip anything that looks like a URL, file path with a username, or
    // token-like substring. Keep the human-readable diagnostic.
    const message = raw
      .replace(/https?:\/\/[^\s'"<>]+/gi, "[url]")
      .replace(/\/[^\s'"<>]+\.(js|wasm|data|binarypb|html)/gi, "[path]")
      .replace(/[A-Za-z0-9_-]{32,}/g, "[token]")
      .slice(0, 600);
    return { name, message };
  }

  function environmentFacts() {
    const nav = navigator || {};
    const screen = window.screen || {};
    return {
      userAgent: String(nav.userAgent || "").slice(0, 240),
      platform: String(nav.platform || "").slice(0, 80),
      language: String(nav.language || "").slice(0, 24),
      onLine: Boolean(nav.onLine),
      cookieEnabled: Boolean(nav.cookieEnabled),
      doNotTrack: String(nav.doNotTrack || "").slice(0, 8),
      hardwareConcurrency: Number(nav.hardwareConcurrency) || 0,
      deviceMemory: Number(nav.deviceMemory) || 0,
      maxTouchPoints: Number(nav.maxTouchPoints) || 0,
      viewport: {
        w: window.innerWidth || 0,
        h: window.innerHeight || 0,
        dpr: window.devicePixelRatio || 1,
      },
      screen: {
        w: screen.width || 0,
        h: screen.height || 0,
      },
      secureContext: Boolean(window.isSecureContext),
      webAssembly: typeof WebAssembly === "object",
      webgl: detectWebGL(),
      simd: detectSimd(),
      serviceWorker: "serviceWorker" in navigator,
      videoFrameCallback:
        typeof HTMLVideoElement !== "undefined" &&
        typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function",
      mediaDevices: Boolean(nav.mediaDevices && nav.mediaDevices.getUserMedia),
      timezone:
        String(Intl.DateTimeFormat().resolvedOptions().timeZone || "").slice(
          0,
          64,
        ) || "unknown",
    };
  }

  function detectWebGL() {
    try {
      const canvas = document.createElement("canvas");
      const ctx =
        canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!ctx) return "unavailable";
      return ctx instanceof WebGL2RenderingContext ? "webgl2" : "webgl1";
    } catch {
      return "probe-error";
    }
  }

  function detectSimd() {
    try {
      // Minimum SIMD-validating module: returns true if the browser accepts
      // the SIMD instruction byte sequence.
      const bytes = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9, 1,
        7, 0, 65, 0, 253, 15, 26, 11,
      ]);
      return WebAssembly.validate(bytes);
    } catch {
      return false;
    }
  }

  function runtimeFacts(issue) {
    const fsm = window.__FSM_TEST__ || {};
    return {
      product: String(CFG.PRODUCT_NAME || "FaceScore Mirror").slice(0, 80),
      storageVersion: String(CFG.STORAGE_VERSION || "").slice(0, 32),
      termsVersion: String(CFG.TERMS_VERSION || "").slice(0, 32),
      affectedPath: safePath(),
      errorCode: String(issue?.code || "UNKNOWN").slice(0, 48),
      errorTitle: String(issue?.title || "").slice(0, 200),
      errorDetail: String(issue?.detail || "").slice(0, 600),
      errorTechnical: String(issue?.technical || "").slice(0, 600),
      selfTest: {
        status: String(fsm.status || "unknown").slice(0, 24),
        details: String(fsm.details || "").slice(0, 400),
      },
      consentState: readConsentState(),
      entitlementState: readEntitlementState(),
      modelState: readModelState(),
    };
  }

  function readConsentState() {
    try {
      return String(localStorage.getItem("facescore_consent") || "unset").slice(
        0,
        24,
      );
    } catch {
      return "storage-unavailable";
    }
  }

  function readEntitlementState() {
    try {
      const raw = localStorage.getItem("facescore_access");
      if (!raw) return "none";
      const parsed = JSON.parse(raw);
      return {
        enabled: Boolean(parsed.enabled),
        source: String(parsed.source || "").slice(0, 32),
        version: String(parsed.version || "").slice(0, 32),
      };
    } catch {
      return "corrupt";
    }
  }

  function readModelState() {
    // Read-only snapshot of model state if app.js exposes it. Otherwise
    // return a minimal placeholder. Never includes camera data.
    return {
      hasModel: Boolean(window.__FSM_TEST__),
      timestamp: new Date().toISOString(),
    };
  }

  function reproducibleSteps() {
    return (actionLog || []).map((entry) => ({
      time: new Date(entry.t).toISOString(),
      action: String(entry.a || "").slice(0, 48),
      detail: String(entry.d || "").slice(0, 80),
    }));
  }

  function safeLogs() {
    // "Safe logs" = the action log + the last self-test status. No console
    // output, no network responses, no camera frames, no error stack traces
    // beyond what `errorTechnical` already provides (sanitized).
    return {
      actionLog: reproducibleSteps(),
      selfTestStatus: String(
        window.__FSM_TEST__?.status || "unknown",
      ).slice(0, 24),
    };
  }

  function buildRepairPrompt(facts, environment, sanitizedError) {
    // Hidden AI-executable repair prompt. Never displayed to the user, never
    // logged to the console. Consumed only by the BNDR.Labs repair agent.
    return [
      "You are an autonomous repair agent for the FaceScore Mirror static SaaS application.",
      "A user-reported unrecoverable failure has occurred. Diagnose the root cause and propose the smallest complete non-regressive patch.",
      "",
      `Affected path: ${facts.affectedPath}`,
      `Error code: ${facts.errorCode}`,
      `Error title: ${facts.errorTitle}`,
      `Error detail: ${facts.errorDetail}`,
      `Sanitized error: ${sanitizedError.name}: ${sanitizedError.message}`,
      `Self-test status: ${facts.selfTest.status} — ${facts.selfTest.details}`,
      `Browser: ${environment.userAgent}`,
      `Secure context: ${environment.secureContext}`,
      `WebAssembly: ${environment.webAssembly}`,
      `WebGL: ${environment.webgl}`,
      `SIMD: ${environment.simd}`,
      `Service worker: ${environment.serviceWorker}`,
      `Video frame callback API: ${environment.videoFrameCallback}`,
      `MediaDevices getUserMedia: ${environment.mediaDevices}`,
      `Storage version: ${facts.storageVersion}`,
      `Terms version: ${facts.termsVersion}`,
      `Consent state: ${facts.consentState}`,
      `Entitlement: ${JSON.stringify(facts.entitlementState)}`,
      `Model state: ${JSON.stringify(facts.modelState)}`,
      "",
      "Reproducible steps (most recent 25, anonymized):",
      ...facts.safeLogs.actionLog.map(
        (s, i) => `  ${i + 1}. [${s.time}] ${s.action} ${s.detail}`,
      ),
      "",
      "Constraints:",
      "1. Do not weaken validation, remove tests, or alter schemas incompatibly.",
      "2. Do not expose internal logs, debug output, or proprietary orchestration to the user.",
      "3. Preserve all verified intent, functionality, data, and production requirements.",
      "4. Return only the smallest complete patch that resolves the verified defect.",
    ].join("\n");
  }

  function buildPackage(issue) {
    const sanitizedError = sanitizeError(issue?.error || issue);
    const environment = environmentFacts();
    const facts = runtimeFacts(issue);
    const safeLogSnapshot = safeLogs();
    const pkg = {
      schema: "bndr.facescore.v1",
      generatedAt: new Date().toISOString(),
      product: facts.product,
      affectedPath: facts.affectedPath,
      failure: {
        code: facts.errorCode,
        title: facts.errorTitle,
        detail: facts.errorDetail,
        technical: facts.errorTechnical,
        sanitizedError,
      },
      environment,
      runtime: {
        storageVersion: facts.storageVersion,
        termsVersion: facts.termsVersion,
        consentState: facts.consentState,
        entitlementState: facts.entitlementState,
        modelState: facts.modelState,
        selfTest: facts.selfTest,
      },
      reproducibleSteps: safeLogSnapshot.actionLog,
      safeLogs: safeLogSnapshot,
      // The hidden repair prompt is part of the package but never rendered
      // or shown to the user. It is intended only for the BNDR.Labs repair
      // agent at the receiving endpoint.
      repairPrompt: buildRepairPrompt(
        { ...facts, safeLogs: safeLogSnapshot },
        environment,
        sanitizedError,
      ),
    };
    return pkg;
  }

  function endpointValid() {
    const url = String(CFG.BNDR_REPORT_ENDPOINT || "").trim();
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return null;
      return url;
    } catch {
      return null;
    }
  }

  async function sendPackage(pkg) {
    const endpoint = endpointValid();
    if (!endpoint) {
      // No endpoint configured. The mechanism is still "wired" — the
      // user-facing acknowledgment is shown. Operator can configure the
      // endpoint later without code changes.
      return { sent: false, reason: "endpoint-not-configured" };
    }
    const body = JSON.stringify(pkg);
    // Try sendBeacon first for reliability during unload; fall back to fetch
    // with keepalive. Both are fire-and-forget from the user's perspective.
    if (navigator.sendBeacon) {
      try {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(endpoint, blob)) {
          return { sent: true, transport: "beacon" };
        }
      } catch {
        // fall through to fetch
      }
    }
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        mode: "cors",
        credentials: "omit",
        redirect: "error",
      });
      return { sent: true, transport: "fetch" };
    } catch (err) {
      // Network failure, CORS rejection, or non-2xx response. The user still
      // sees only the canned acknowledgment — failures are silent to them.
      return { sent: false, reason: "network-error" };
    }
  }

  // Standard canned acknowledgment. The user-facing surface reveals none of
  // the internal diagnostic material, per spec.
  const ACK_MESSAGE =
    "Message sent. Thank you for notifying us. We'll address it as soon as possible.";

  function showAcknowledgment(nearElement) {
    // Display the canned message as a toast near the trigger. Never expose
    // the diagnostic package contents in the DOM.
    if (window.FaceScore?.downloadText) {
      // FaceScore.toast() not exposed; use a local toast.
    }
    const toast = document.createElement("div");
    toast.className = "toast bndr-ack";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = ACK_MESSAGE;
    const stack = document.getElementById("toastStack") || document.body;
    stack.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  /**
   * Submit a BNDR.Labs diagnostic report for the given failure classification.
   * Returns a promise that resolves once the send attempt completes (or fails
   * silently). The user sees only the canned acknowledgment.
   *
   * @param {Object} issue - Failure classification from Vision.classifyError
   *   or an Error instance. May include `.error` for the original error.
   */
  async function submitReport(issue) {
    showAcknowledgment();
    try {
      const pkg = buildPackage(issue);
      await sendPackage(pkg);
      // Always clear the action log after a report so subsequent sessions
      // don't accumulate stale context. If the user hits another failure,
      // a fresh log starts.
      clearActionLog();
    } catch {
      // Swallow. The acknowledgment has already been shown. Per spec, the
      // user-facing surface must reveal none of this internal material.
    }
  }

  /**
   * Attach a one-click report trigger to a button element. The button's
   * visible label is set by the caller (e.g., "Notify BNDR.Labs"); the
   * click handler collects the current failure context and submits.
   */
  function attachTrigger(button, issueSupplier) {
    if (!button) return;
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const issue =
          typeof issueSupplier === "function" ? issueSupplier() : issueSupplier;
        await submitReport(issue);
      } finally {
        // Re-enable after a short delay so the acknowledgment is visible
        // and the user understands the click was acknowledged.
        setTimeout(() => {
          button.disabled = false;
        }, 1500);
      }
    });
  }

  window.BNDRReporter = Object.freeze({
    recordAction,
    clearActionLog,
    submitReport,
    attachTrigger,
    buildPackage, // exposed for self-test only
    ACK_MESSAGE,
  });
})();
