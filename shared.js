(() => {
  "use strict";
  const cfg = window.FACESCORE_CONFIG || {};
  const prefix = "facescore_";
  const memory = new Map();

  const validHttpUrl = (value) => {
    try {
      const u = new URL(String(value || ""));
      return ["https:", "http:"].includes(u.protocol);
    } catch {
      return false;
    }
  };
  const normalizeCode = (value) =>
    String(value || "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();
  const hashCode = async (value) => {
    const bytes = new TextEncoder().encode(normalizeCode(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };
  const readRaw = (key) => {
    try {
      const v = localStorage.getItem(prefix + key);
      return v === null ? (memory.get(key) ?? null) : v;
    } catch {
      return memory.get(key) ?? null;
    }
  };
  const writeRaw = (key, value, persistent = true) => {
    memory.set(key, String(value));
    if (persistent) {
      try {
        localStorage.setItem(prefix + key, String(value));
      } catch {}
    }
  };
  const removeRaw = (key) => {
    memory.delete(key);
    try {
      localStorage.removeItem(prefix + key);
    } catch {}
  };
  const getJSON = (key, fallback) => {
    try {
      const v = readRaw(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  };
  const setJSON = (key, value, persistent = true) =>
    writeRaw(key, JSON.stringify(value), persistent);

  const getConsent = () => readRaw("consent") || "unset";
  const setConsent = (value) => writeRaw("consent", value, true);
  const optionalStorageAllowed = () => getConsent() === "preferences";

  const accessRecord = () => getJSON("access", null);
  const hasPro = () => {
    const record = accessRecord();
    return Boolean(
      record &&
      record.enabled === true &&
      record.version === cfg.STORAGE_VERSION,
    );
  };
  const grantPro = (source) =>
    setJSON(
      "access",
      {
        enabled: true,
        source,
        grantedAt: new Date().toISOString(),
        version: cfg.STORAGE_VERSION,
      },
      true,
    );
  const revokePro = () => removeRaw("access");
  const verifyAccessCode = async (code) => {
    const hashes = Array.isArray(cfg.ACCESS_CODE_HASHES)
      ? cfg.ACCESS_CODE_HASHES.map((v) => String(v).toLowerCase())
      : [];
    if (!hashes.length || !normalizeCode(code)) return false;
    const hash = await hashCode(code);
    if (!hashes.includes(hash)) return false;
    grantPro("access-code");
    return true;
  };

  const providers = () =>
    [
      {
        id: "stripe",
        label: "Pay with Stripe",
        url: cfg.STRIPE_PAYMENT_LINK,
        className: "button button-primary",
      },
      {
        id: "gumroad",
        label: "Buy on Gumroad",
        url: cfg.GUMROAD_PRODUCT_URL,
        className: "button button-secondary",
      },
    ].filter((p) => validHttpUrl(p.url));

  const renderPaymentButtons = (container, options = {}) => {
    if (!container) return 0;
    container.replaceChildren();
    const items = providers();
    for (const provider of items) {
      const a = document.createElement("a");
      a.href = provider.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = provider.className;
      a.dataset.provider = provider.id;
      a.textContent = provider.label;
      a.addEventListener("click", () => {
        try {
          sessionStorage.setItem(prefix + "checkout_provider", provider.id);
        } catch {}
      });
      container.appendChild(a);
    }
    container.hidden = items.length === 0;
    const empty = options.emptyElement;
    if (empty) empty.hidden = items.length !== 0;
    return items.length;
  };

  const supportHref = () => {
    const email = String(cfg.SUPPORT_EMAIL || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : "";
  };
  const wireSupportLinks = () => {
    const href = supportHref();
    document.querySelectorAll("[data-support-link]").forEach((a) => {
      if (href) {
        a.href = href;
        a.hidden = false;
      } else a.hidden = true;
    });
  };

  const initConsent = () => {
    const banner = document.querySelector("[data-consent-banner]");
    if (!banner) return;
    if (getConsent() !== "unset") {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const dismiss = () => {
      banner.hidden = true;
      const main = document.querySelector("main");
      if (main) {
        main.tabIndex = -1;
        main.focus({ preventScroll: true });
      }
    };
    banner
      .querySelector("[data-consent-essential]")
      ?.addEventListener("click", () => {
        setConsent("essential");
        dismiss();
        document.dispatchEvent(
          new CustomEvent("facescore-consent", { detail: "essential" }),
        );
      });
    banner
      .querySelector("[data-consent-preferences]")
      ?.addEventListener("click", () => {
        setConsent("preferences");
        dismiss();
        document.dispatchEvent(
          new CustomEvent("facescore-consent", { detail: "preferences" }),
        );
      });
  };

  const downloadText = (filename, text, type = "text/plain") => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  window.FaceScore = Object.freeze({
    cfg,
    validHttpUrl,
    hashCode,
    readRaw,
    writeRaw,
    removeRaw,
    getJSON,
    setJSON,
    getConsent,
    setConsent,
    optionalStorageAllowed,
    hasPro,
    grantPro,
    revokePro,
    verifyAccessCode,
    providers,
    renderPaymentButtons,
    supportHref,
    wireSupportLinks,
    initConsent,
    downloadText,
  });
})();
