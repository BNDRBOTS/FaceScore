(() => {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 45_000;
  const SIMD_PROBE = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9, 1, 7, 0,
    65, 0, 253, 15, 26, 11,
  ]);

  function withTimeout(promise, timeoutMs, message) {
    let timeoutId = 0;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error(message)),
        timeoutMs,
      );
    });
    return Promise.race([promise, timeout]).finally(() =>
      window.clearTimeout(timeoutId),
    );
  }

  function supportsWebAssembly() {
    return (
      typeof WebAssembly === "object" &&
      typeof WebAssembly.instantiate === "function"
    );
  }

  function supportsWebGL() {
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false });
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  }

  function supportsSimd() {
    try {
      return WebAssembly.validate(SIMD_PROBE);
    } catch {
      return false;
    }
  }

  function classifyError(error) {
    const name = error?.name || "Error";
    const raw = error?.message || String(error || "Unknown runtime error");
    const message = raw.toLowerCase();

    if (message.includes("webgl is not available")) {
      return {
        code: "WEBGL_UNAVAILABLE",
        title: "This browser cannot start the local vision engine.",
        detail:
          "Enable hardware acceleration or use a current Safari, Chrome, Edge, or Firefox browser with WebGL enabled.",
        technical: `${name}: ${raw}`,
      };
    }

    if (
      message.includes("content security policy") ||
      message.includes("unsafe-eval") ||
      message.includes("wasm code generation disallowed") ||
      message.includes("webassembly.compile")
    ) {
      return {
        code: "WASM_BLOCKED",
        title: "The browser blocked the local vision engine.",
        detail:
          "The deployment Content Security Policy must allow WebAssembly execution. Use the included deployment policy and reload the page.",
        technical: `${name}: ${raw}`,
      };
    }

    if (
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("404") ||
      message.includes("abort") ||
      message.includes("expected magic word")
    ) {
      return {
        code: "ASSET_LOAD_FAILED",
        title: "The local model files did not load completely.",
        detail:
          "Deploy the entire folder without renaming or excluding the vendor directory, then reload the app.",
        technical: `${name}: ${raw}`,
      };
    }

    if (message.includes("timed out")) {
      return {
        code: "MODEL_TIMEOUT",
        title: "The local model took too long to start.",
        detail:
          "Close other camera-heavy tabs, confirm a stable connection for the first load, and retry. Later loads are cached on demand.",
        technical: `${name}: ${raw}`,
      };
    }

    if (name === "NotAllowedError") {
      return {
        code: "CAMERA_DENIED",
        title: "Camera access is blocked.",
        detail:
          "Allow camera access for this site in the browser settings, return to the page, and press Retry camera.",
        technical: `${name}: ${raw}`,
      };
    }

    if (name === "NotFoundError") {
      return {
        code: "CAMERA_MISSING",
        title: "No usable camera was found.",
        detail: "Connect or enable a camera, then retry.",
        technical: `${name}: ${raw}`,
      };
    }

    if (name === "NotReadableError" || name === "AbortError") {
      return {
        code: "CAMERA_BUSY",
        title: "The camera is busy.",
        detail:
          "Close other apps or tabs using the camera, then return and retry.",
        technical: `${name}: ${raw}`,
      };
    }

    if (name === "OverconstrainedError") {
      return {
        code: "CAMERA_CONSTRAINTS",
        title: "The camera rejected the requested mode.",
        detail: "FaceScore will retry with the device default camera settings.",
        technical: `${name}: ${raw}`,
      };
    }

    return {
      code: "RUNTIME_ERROR",
      title: "The local analysis engine could not continue.",
      detail:
        "Reload the current production files and retry. The camera preview will remain available when recovery is possible.",
      technical: `${name}: ${raw}`,
    };
  }

  function makeWarmupCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#181818";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function prepareModel({
    onResults,
    onStage = () => {},
    assetBase = "vendor/",
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    onStage("runtime-check", "Checking this browser");

    if (!supportsWebAssembly()) {
      throw new Error("WebAssembly is not available in this browser.");
    }
    if (!supportsWebGL()) {
      throw new Error("WebGL is not available in this browser.");
    }
    if (typeof window.FaceMesh !== "function") {
      throw new Error("The bundled FaceMesh script did not load.");
    }

    const baseUrl = new URL(assetBase, document.baseURI);
    const locateFile = (file) => new URL(file, baseUrl).href;

    onStage(
      "model-create",
      supportsSimd()
        ? "Preparing optimized model"
        : "Preparing compatible model",
    );

    const model = new window.FaceMesh({ locateFile });
    model.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.62,
      minTrackingConfidence: 0.62,
    });
    model.onResults((results) => onResults?.(results));

    try {
      onStage("asset-load", "Loading the private vision engine");
      await withTimeout(
        model.send({ image: makeWarmupCanvas() }),
        timeoutMs,
        "Local model startup timed out.",
      );
      onStage("ready", "Private vision engine ready");
      return model;
    } catch (error) {
      try {
        model.close?.();
      } catch {
        // Closing a failed Emscripten runtime is best-effort only.
      }
      throw error;
    }
  }

  function isMobileDevice() {
    return (
      matchMedia("(pointer: coarse)").matches ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    );
  }

  function preferredConstraints() {
    const mobile = isMobileDevice();
    return {
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: mobile ? 640 : 960, max: 1280 },
        height: { ideal: mobile ? 480 : 720, max: 960 },
        frameRate: { ideal: mobile ? 24 : 30, max: 30 },
      },
    };
  }

  async function requestCamera() {
    const mediaDevices = navigator.mediaDevices;
    if (!window.isSecureContext || !mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera access requires HTTPS or localhost in a supported browser.",
      );
    }

    try {
      return await mediaDevices.getUserMedia(preferredConstraints());
    } catch (error) {
      if (error?.name !== "OverconstrainedError") throw error;
      try {
        return await mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "user" } },
        });
      } catch (fallbackError) {
        if (fallbackError?.name !== "OverconstrainedError") throw fallbackError;
        return mediaDevices.getUserMedia({ audio: false, video: true });
      }
    }
  }

  function waitForEvent(target, eventName, timeoutMs) {
    return withTimeout(
      new Promise((resolve, reject) => {
        const onEvent = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error(`Video emitted ${eventName} startup error.`));
        };
        const cleanup = () => {
          target.removeEventListener(eventName, onEvent);
          target.removeEventListener("error", onError);
        };
        target.addEventListener(eventName, onEvent, { once: true });
        target.addEventListener("error", onError, { once: true });
      }),
      timeoutMs,
      `Video ${eventName} timed out.`,
    );
  }

  async function attachStream(video, stream, timeoutMs = 12_000) {
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.srcObject = stream;

    if (
      !video.videoWidth ||
      video.readyState < HTMLMediaElement.HAVE_METADATA
    ) {
      await waitForEvent(video, "loadedmetadata", timeoutMs);
    }

    await withTimeout(
      video.play(),
      timeoutMs,
      "The camera preview could not begin playback.",
    );

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForEvent(video, "loadeddata", timeoutMs);
    }
  }

  function stopStream(stream) {
    stream?.getTracks?.().forEach((track) => track.stop());
  }

  window.FaceScoreVision = Object.freeze({
    prepareModel,
    requestCamera,
    attachStream,
    stopStream,
    classifyError,
    isMobileDevice,
    supportsSimd,
    supportsWebGL,
  });
})();
