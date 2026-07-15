(() => {
  "use strict";
  const cfg = window.FACESCORE_CONFIG || {};
  const prefix = "facescore_";
  const memory = new Map();

  /* =========================================================================
     Validation helpers
     ====================================================================== */
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

  /* =========================================================================
     Storage layer — localStorage with in-memory fallback.
     Considers consent state before persisting optional data.
     ====================================================================== */
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

  /* =========================================================================
     Consent + entitlement
     ====================================================================== */
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
  const hasStudio = () => {
    const record = accessRecord();
    return Boolean(hasPro() && record && record.source === "studio-code");
  };
  const grantPro = (source) =>
    setJSON(
      "access",
      {
        enabled: true,
        tier: source === "studio-code" ? "studio" : "pro",
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
    // Studio codes are prefixed with "studio-" in the hash list so we can
    // distinguish tiers. A bare hash grants Pro. A hash starting with
    // "studio:" grants Studio.
    const matched = cfg.ACCESS_CODE_HASHES.find(
      (h) => String(h).toLowerCase() === hash,
    );
    const isStudio = String(matched).startsWith("studio:");
    grantPro(isStudio ? "studio-code" : "access-code");
    return isStudio ? "studio" : "pro";
  };

  /* =========================================================================
     Pricing tiers + payment providers
     ====================================================================== */
  const tiers = () => (Array.isArray(cfg.TIERS) ? cfg.TIERS : []);

  const providerUrlFor = (tierId) => {
    if (tierId === "studio") {
      return (
        validHttpUrl(cfg.STRIPE_PAYMENT_LINK_STUDIO)
          ? cfg.STRIPE_PAYMENT_LINK_STUDIO
          : validHttpUrl(cfg.GUMROAD_PRODUCT_URL_STUDIO)
            ? cfg.GUMROAD_PRODUCT_URL_STUDIO
            : ""
      );
    }
    if (tierId === "pro") {
      return (
        validHttpUrl(cfg.STRIPE_PAYMENT_LINK)
          ? cfg.STRIPE_PAYMENT_LINK
          : validHttpUrl(cfg.GUMROAD_PRODUCT_URL)
            ? cfg.GUMROAD_PRODUCT_URL
            : ""
      );
    }
    return "";
  };

  const providersFor = (tierId) => {
    const list = [];
    if (tierId === "studio") {
      if (validHttpUrl(cfg.STRIPE_PAYMENT_LINK_STUDIO))
        list.push({
          id: "stripe",
          label: "Pay with Stripe",
          url: cfg.STRIPE_PAYMENT_LINK_STUDIO,
          className: "button button-primary",
        });
      if (validHttpUrl(cfg.GUMROAD_PRODUCT_URL_STUDIO))
        list.push({
          id: "gumroad",
          label: "Buy on Gumroad",
          url: cfg.GUMROAD_PRODUCT_URL_STUDIO,
          className: "button button-secondary",
        });
    } else if (tierId === "pro") {
      if (validHttpUrl(cfg.STRIPE_PAYMENT_LINK))
        list.push({
          id: "stripe",
          label: "Pay with Stripe",
          url: cfg.STRIPE_PAYMENT_LINK,
          className: "button button-primary",
        });
      if (validHttpUrl(cfg.GUMROAD_PRODUCT_URL))
        list.push({
          id: "gumroad",
          label: "Buy on Gumroad",
          url: cfg.GUMROAD_PRODUCT_URL,
          className: "button button-secondary",
        });
    }
    return list;
  };

  const renderPaymentButtons = (container, options = {}) => {
    if (!container) return 0;
    container.replaceChildren();
    const tierId = options.tier || "pro";
    const items = providersFor(tierId);
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
          sessionStorage.setItem(prefix + "checkout_tier", tierId);
        } catch {}
      });
      container.appendChild(a);
    }
    container.hidden = items.length === 0;
    const empty = options.emptyElement;
    if (empty) empty.hidden = items.length !== 0;
    return items.length;
  };

  const renderTierCards = (container, options = {}) => {
    if (!container) return 0;
    container.replaceChildren();
    const allTiers = tiers();
    if (!allTiers.length) return 0;
    const skipDemo = options.skipDemo === true;
    let rendered = 0;
    for (const tier of allTiers) {
      if (skipDemo && tier.id === "demo") continue;
      const card = document.createElement("article");
      card.className = `pricing-tier${tier.featured ? " featured" : ""}`;
      card.dataset.tier = tier.id;

      const name = document.createElement("div");
      name.className = "tier-name";
      name.textContent = tier.name;
      card.appendChild(name);

      const tagline = document.createElement("div");
      tagline.className = "tier-tagline";
      tagline.textContent = tier.tagline;
      card.appendChild(tagline);

      const priceLine = document.createElement("div");
      const price = document.createElement("span");
      price.className = "tier-price";
      price.textContent = tier.priceDisplay;
      priceLine.appendChild(price);
      if (tier.pricePeriod) {
        const period = document.createElement("span");
        period.className = "tier-price-period";
        period.textContent = tier.pricePeriod;
        priceLine.appendChild(period);
      }
      card.appendChild(priceLine);

      const features = document.createElement("ul");
      features.className = "tier-features";
      for (const f of tier.features || []) {
        const li = document.createElement("li");
        li.textContent = f;
        features.appendChild(li);
      }
      for (const f of tier.disabledFeatures || []) {
        const li = document.createElement("li");
        li.className = "disabled";
        li.textContent = f;
        features.appendChild(li);
      }
      card.appendChild(features);

      const ctaWrap = document.createElement("div");
      ctaWrap.className = "tier-cta";
      if (tier.id === "demo") {
        const a = document.createElement("a");
        a.href = tier.ctaHref || "app.html";
        a.className = "button button-secondary";
        a.textContent = tier.ctaLabel || "Start the demo";
        ctaWrap.appendChild(a);
      } else {
        const paymentButtons = document.createElement("div");
        paymentButtons.className = "payment-buttons";
        const count = renderPaymentButtons(paymentButtons, { tier: tier.id });
        ctaWrap.appendChild(paymentButtons);
        if (count === 0) {
          const empty = document.createElement("p");
          empty.className = "payment-empty";
          empty.textContent = "Checkout not configured yet. Use an access code for now.";
          ctaWrap.appendChild(empty);
        }
        const alt = document.createElement("a");
        alt.href = "app.html#activate";
        alt.className = "text-button";
        alt.style.marginTop = "10px";
        alt.style.display = "inline-block";
        alt.textContent = "Already have an access code?";
        ctaWrap.appendChild(alt);
      }
      card.appendChild(ctaWrap);

      container.appendChild(card);
      rendered++;
    }
    return rendered;
  };

  /* =========================================================================
     Support link wiring
     ====================================================================== */
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

  /* =========================================================================
     Consent banner
     ====================================================================== */
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
      const main = document.querySelector("main") || document.querySelector("#workspace");
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

  /* =========================================================================
     File download helper
     ====================================================================== */
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

  /* =========================================================================
     Kinetic typography — staggered word/letter reveals.
     Honors prefers-reduced-motion.
     ====================================================================== */
  const prefersReducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const splitToWords = (el) => {
    const text = el.textContent;
    el.textContent = "";
    el.dataset.kinetic = "words";
    const frag = document.createDocumentFragment();
    for (const word of text.split(/(\s+)/)) {
      if (word.trim() === "") {
        frag.appendChild(document.createTextNode(word));
      } else {
        const span = document.createElement("span");
        span.className = "kinetic-word";
        span.textContent = word;
        span.style.display = "inline-block";
        span.style.opacity = "0";
        span.style.transform = "translateY(0.4em)";
        span.style.transition =
          "opacity 0.6s var(--ease-out), transform 0.6s var(--ease-out)";
        frag.appendChild(span);
      }
    }
    el.appendChild(frag);
    return el.querySelectorAll(".kinetic-word");
  };

  const animateKinetic = (el, delay = 0) => {
    if (prefersReducedMotion()) {
      el.querySelectorAll(".kinetic-word").forEach((w) => {
        w.style.opacity = "1";
        w.style.transform = "none";
      });
      return;
    }
    const words = el.querySelectorAll(".kinetic-word");
    words.forEach((w, i) => {
      w.style.transitionDelay = `${delay + i * 60}ms`;
      requestAnimationFrame(() => {
        w.style.opacity = "1";
        w.style.transform = "translateY(0)";
      });
    });
  };

  /* =========================================================================
     Scroll reveal — IntersectionObserver dual strategy.
     Lightweight observer for enter/leave; safe to register many elements.
     ====================================================================== */
  let revealObserver = null;
  const initRevealObserver = () => {
    if (prefersReducedMotion()) {
      document.querySelectorAll(".reveal").forEach((el) =>
        el.classList.add("visible"),
      );
      return;
    }
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".reveal").forEach((el) =>
        el.classList.add("visible"),
      );
      return;
    }
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            // Animate kinetic typography inside the revealed element.
            const kinetic = entry.target.querySelectorAll("[data-kinetic]");
            kinetic.forEach((k, i) => animateKinetic(k, i * 80));
            // If the element itself is kinetic, animate it too.
            if (entry.target.dataset.kinetic) animateKinetic(entry.target);
            revealObserver.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    document.querySelectorAll(".reveal").forEach((el) => {
      // Stagger sibling reveals.
      const siblings = Array.from(el.parentElement?.children || []);
      const idx = siblings.indexOf(el);
      if (idx >= 0) el.style.setProperty("--i", idx);
      revealObserver.observe(el);
    });
    // Safety net: never leave content hidden.
    setTimeout(() => {
      document
        .querySelectorAll(".reveal:not(.visible)")
        .forEach((el) => el.classList.add("visible"));
    }, 1800);
  };

  /* =========================================================================
     Scroll progress indicator + sticky header
     ====================================================================== */
  const initScrollEnhancements = () => {
    // Scroll progress bar (skip on app.html where it'd be noise).
    const isAppPage = document.body.classList.contains("app-page");
    if (!isAppPage) {
      const bar = document.createElement("div");
      bar.className = "scroll-progress";
      bar.setAttribute("aria-hidden", "true");
      document.body.appendChild(bar);
      let ticking = false;
      const update = () => {
        const scrollTop =
          document.documentElement.scrollTop || document.body.scrollTop;
        const scrollHeight =
          document.documentElement.scrollHeight -
          document.documentElement.clientHeight;
        const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        bar.style.width = `${pct}%`;
        ticking = false;
      };
      window.addEventListener(
        "scroll",
        () => {
          if (!ticking) {
            requestAnimationFrame(update);
            ticking = true;
          }
        },
        { passive: true },
      );
      update();
    }

    // Sticky header shadow on scroll.
    const header = document.querySelector(".site-header");
    if (header) {
      let ticking = false;
      const updateHeader = () => {
        if (window.scrollY > 12) header.classList.add("scrolled");
        else header.classList.remove("scrolled");
        ticking = false;
      };
      window.addEventListener(
        "scroll",
        () => {
          if (!ticking) {
            requestAnimationFrame(updateHeader);
            ticking = true;
          }
        },
        { passive: true },
      );
      updateHeader();
    }

    // Sticky CTA bar (landing/pricing pages).
    const stickyCta = document.querySelector("[data-sticky-cta]");
    if (stickyCta) {
      let visible = false;
      let ticking = false;
      const updateSticky = () => {
        const heroEnd = window.innerHeight * 0.9;
        const nearBottom =
          window.scrollY + window.innerHeight >
          document.documentElement.scrollHeight - 200;
        const shouldShow = window.scrollY > heroEnd && !nearBottom;
        if (shouldShow !== visible) {
          visible = shouldShow;
          stickyCta.classList.toggle("visible", visible);
        }
        ticking = false;
      };
      window.addEventListener(
        "scroll",
        () => {
          if (!ticking) {
            requestAnimationFrame(updateSticky);
            ticking = true;
          }
        },
        { passive: true },
      );
      updateSticky();
    }
  };

  /* =========================================================================
     Mobile navigation toggle
     ====================================================================== */
  const initMobileNav = () => {
    const toggle = document.querySelector(".mobile-menu-toggle");
    const nav = document.querySelector(".site-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    // Close on nav click.
    nav.addEventListener("click", (e) => {
      if (e.target.tagName === "A") {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    // Close on outside click.
    document.addEventListener("click", (e) => {
      if (
        nav.classList.contains("open") &&
        !nav.contains(e.target) &&
        !toggle.contains(e.target)
      ) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  };

  /* =========================================================================
     Animated number counters (data-count attribute)
     ====================================================================== */
  const initCounters = () => {
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      document.querySelectorAll("[data-count]").forEach((el) => {
        el.textContent = el.dataset.count;
      });
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target;
            const target = parseFloat(el.dataset.count);
            const dur = 1400;
            const start = performance.now();
            const tick = (now) => {
              const t = Math.min(1, (now - start) / dur);
              const eased = 1 - Math.pow(1 - t, 3);
              const value = Math.round(target * eased);
              el.textContent = value.toLocaleString();
              if (t < 1) requestAnimationFrame(tick);
              else el.textContent = target.toLocaleString();
            };
            requestAnimationFrame(tick);
            observer.unobserve(el);
          }
        }
      },
      { threshold: 0.5 },
    );
    document.querySelectorAll("[data-count]").forEach((el) => observer.observe(el));
  };

  /* =========================================================================
     Magnetic button effect (desktop, hover-capable only)
     ====================================================================== */
  const initMagneticButtons = () => {
    if (prefersReducedMotion()) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    document
      .querySelectorAll("[data-magnetic], .button-primary, .icon-button")
      .forEach((btn) => {
        if (btn.dataset.magneticBound) return;
        btn.dataset.magneticBound = "1";
        btn.style.transition =
          "transform 0.25s var(--ease-spring), box-shadow 0.3s var(--ease)";
        btn.addEventListener("mousemove", (e) => {
          const rect = btn.getBoundingClientRect();
          const x = e.clientX - rect.left - rect.width / 2;
          const y = e.clientY - rect.top - rect.height / 2;
          const strength = 0.25;
          btn.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.transform = "";
        });
      });
  };

  /* =========================================================================
     Init orchestrator — call from each page's entry script.
     ====================================================================== */
  const initCommon = () => {
    // Stamp current year everywhere.
    document
      .querySelectorAll("[data-year]")
      .forEach((el) => (el.textContent = String(new Date().getFullYear())));

    // Stamp product name where requested.
    document.querySelectorAll("[data-product-name]").forEach((el) => {
      el.textContent = cfg.PRODUCT_NAME || "FaceScore Mirror";
    });

    // Wire support links.
    wireSupportLinks();

    // Init consent banner.
    initConsent();

    // Scroll enhancements.
    initScrollEnhancements();

    // Mobile nav.
    initMobileNav();

    // Reveal animations.
    initRevealObserver();

    // Counters.
    initCounters();

    // Magnetic buttons.
    initMagneticButtons();

    // Payment buttons rendered inline via [data-payment-buttons].
    document
      .querySelectorAll("[data-payment-buttons]")
      .forEach((el) => {
        const tier = el.dataset.tier || "pro";
        const emptySel = el.dataset.emptyElement;
        const empty = emptySel
          ? document.querySelector(emptySel)
          : el.parentElement?.querySelector("[data-payment-empty]");
        renderPaymentButtons(el, { tier, emptyElement: empty });
      });

    // Tier card grids.
    document
      .querySelectorAll("[data-tier-cards]")
      .forEach((el) => {
        renderTierCards(el, { skipDemo: el.dataset.skipDemo === "true" });
      });

    // Service worker (skip on file://).
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      window.addEventListener("load", () =>
        navigator.serviceWorker
          .register("./service-worker.js")
          .catch(() => {}),
      );
    }
  };

  /* =========================================================================
     Public API
     ====================================================================== */
  window.FaceScore = Object.freeze({
    cfg,
    // validation
    validHttpUrl,
    hashCode,
    normalizeCode,
    // storage
    readRaw,
    writeRaw,
    removeRaw,
    getJSON,
    setJSON,
    // consent
    getConsent,
    setConsent,
    optionalStorageAllowed,
    // entitlement
    hasPro,
    hasStudio,
    grantPro,
    revokePro,
    verifyAccessCode,
    // tiers + providers
    tiers,
    providerUrlFor,
    providersFor,
    renderPaymentButtons,
    renderTierCards,
    // support
    supportHref,
    wireSupportLinks,
    // consent banner
    initConsent,
    // download
    downloadText,
    // kinetic typography
    splitToWords,
    animateKinetic,
    // orchestrator
    initCommon,
  });
})();
