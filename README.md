# FaceScore Mirror — Luxury Edition

FaceScore Mirror is a static, local-first SaaS product for private on-device
facial geometry analysis. Bilateral balance, proportion reference, and
expression dynamics are mapped entirely in the browser with the bundled
MediaPipe FaceMesh runtime. No account, no backend, no uploads.

This Luxury Edition is a bleeding-edge, feminine-bold-luxury frontend SaaS
built on:

- **Custom `@property` animated gradients** — champagne-gold + magenta + rose
- **Glassmorphism** with `backdrop-filter` blur on every panel
- **Kinetic typography** — staggered word reveals on hero headline
- **Scroll-driven reveals** — IntersectionObserver dual strategy + safety net
- **Magnetic buttons** — cursor-following primary CTAs (desktop only)
- **Scroll progress bar** + sticky header shadow + sticky CTA
- **Mobile-first responsive** — asymmetric grid collapses cleanly
- **`prefers-reduced-motion`** respected everywhere
- **View Transitions API** opt-in for page navigation
- **Web fonts** — Fraunces (display serif) + Inter (body sans)

## Production repair (inherited from v2)

The prior build could obtain camera permission, flash the video, then return
to the unchanged launch screen. The camera was not the root failure. The app
marked the model ready before its graph, packed assets, and WebAssembly
runtime had completed loading; the first camera frame became the actual
initialization attempt, and any model exception immediately stopped the
camera.

This package corrects that startup chain:

1. Browser, WebGL, and WebAssembly capability checks run first.
2. The exact bundled model performs a warmup inference before camera permission is requested.
3. Mobile and desktop use adaptive camera constraints with safe fallbacks.
4. iOS playback waits for metadata and current video data before analysis begins.
5. Model failure pauses analysis without destroying the camera preview.
6. One automatic model restart is allowed; further failures present a controlled manual retry instead of looping.
7. Large model/WASM assets are cached on demand rather than competing with first startup.
8. Safari-compatible WebAssembly CSP and host MIME rules are included.
9. `model.send()` per-frame calls are wrapped in a 20s timeout — a hung send triggers recovery instead of freezing the loop.
10. BNDR.Labs hidden one-click diagnostic report mechanism is wired for unrecoverable failures.

## Files that must remain together

Deploy the complete folder. Do not omit or rename:

- `app.html`, `app.js`, `vision-runtime.js`, `bndr-report.js`
- `index.html`, `pricing.html`, `landing.js`, `legal.js`
- `vendor/` and every file inside it
- `styles.css`, `shared.js`, `config.js`, `sw-register.js`
- `service-worker.js`, `manifest.webmanifest`, `icons/`
- `privacy.html`, `terms.html`, `refund.html`, `success.html`, `404.html`
- `README.md`, `THIRD_PARTY_NOTICES.md`, `LICENSES/`
- `_headers`, `vercel.json`, `robots.txt`

The application will fail closed with a visible diagnostic when required runtime assets are missing.

## Checkout configuration

Edit only the public values in `config.js`:

```js
STRIPE_PAYMENT_LINK: "https://buy.stripe.com/...",          // Pro tier ($29)
STRIPE_PAYMENT_LINK_STUDIO: "https://buy.stripe.com/...",   // Studio tier ($59)
GUMROAD_PRODUCT_URL: "https://your-store.gumroad.com/l/pro",
GUMROAD_PRODUCT_URL_STUDIO: "https://your-store.gumroad.com/l/studio",
SUPPORT_EMAIL: "support@your-domain.com",
BNDR_REPORT_ENDPOINT: "https://your-domain.example/api/bndr-report",
```

Only a configured provider appears. Either provider can be used alone, or both can be shown. Invalid or non-HTTP(S) values are rejected and no button is rendered.

Use a Stripe **Payment Link**, not a Stripe secret key. Never place Stripe secret keys, Gumroad access tokens, webhook secrets, or private API credentials in frontend files.

For Stripe, set the post-payment redirect to:

```text
https://YOUR-DOMAIN/success.html
```

Configure Stripe or Gumroad fulfillment to deliver the customer's access code.

### Pricing tiers

| Tier | Price | Use case |
|------|-------|----------|
| Demo | Free | 60-second live analysis, no signup |
| Mirror Pro | $29 one-time | Personal use — unlimited analysis, history, exports, printable reports, priority email support |
| Mirror Studio | $59 one-time | Commercial use — everything in Pro + commercial license, branded reports, extended history, early access, dedicated support |

Pricing rationale (March 2026 market scan):

- Golden Ratio Face: $4.99/mo premium
- FaceRead AI: $9.99/mo
- QOVES Studio: $29/mo or $290/yr (professional)
- FaceShape AI: $14.99 one-time
- Pretty Scale: free with ads

FaceScore Mirror's one-time model avoids subscription fatigue and undercuts
professional subscriptions while positioning as a premium tool. The $59
Studio tier anchors the $29 Pro tier (price anchoring).

### BNDR.Labs diagnostic reporting

`BNDR_REPORT_ENDPOINT` is optional. When set to an HTTPS URL, unrecoverable
runtime failures (model startup failure after retry, WebGL/WASM unavailable,
asset load failure, model timeout) reveal a one-click **Notify BNDR.Labs**
button. The click POSTs a sanitized diagnostic package to that endpoint via
`navigator.sendBeacon` (or `fetch` with `keepalive`) and shows the user only:

> Message sent. Thank you for notifying us. We'll address it as soon as possible.

The package contains the failure state, sanitized environment and runtime
facts, anonymized reproducible steps (high-level action codes only — never
camera data, never access codes, never user input), safe logs, affected
path, and a hidden AI-executable repair prompt for the BNDR.Labs repair
agent. The user-facing surface reveals none of the internal material.

If `BNDR_REPORT_ENDPOINT` is empty (default), the trigger still appears for
unrecoverable failures and still shows the canned acknowledgment, but no
network send occurs. Configure the endpoint to enable the send.

The endpoint must:

- Accept `POST` with `Content-Type: application/json`
- Respond with any 2xx status (the response body is ignored)
- Allow CORS from your deployment origin if different from the endpoint origin

## Owner and gift access codes

Access codes are stored as SHA-256 hashes. Generate a hash:

```bash
# Pro code:
python3 -c "import hashlib; print(hashlib.sha256('YOUR-CODE'.replace(' ','').upper().encode()).hexdigest())"

# Studio code (prefix the hash with "studio:" in the config):
python3 -c "import hashlib; print('studio:' + hashlib.sha256('YOUR-CODE'.replace(' ','').upper().encode()).hexdigest())"
```

Add the resulting hash to `ACCESS_CODE_HASHES` in `config.js`. This supports
owner access, review copies, gifts, and private giveaways. A bare hash grants
Mirror Pro; a `studio:`-prefixed hash grants Mirror Studio.

Because this edition intentionally has no backend, the browser gate is
practical storefront access control, not tamper-proof DRM. Per-customer
automatic license verification would require a small server-side
verification endpoint.

## Deployment requirements

- Serve through **HTTPS**. Do not open `app.html` directly with `file://`.
- Preserve exact relative paths and filename capitalization.
- Serve `.wasm` as `application/wasm`.
- Serve `.data` and `.binarypb` as `application/octet-stream`.
- Do not override the app CSP with a stricter host policy. `app.html` requires local WebAssembly execution through `'unsafe-eval'` and `'wasm-unsafe-eval'` because of the bundled Emscripten runtime.
- `_headers` is included for Netlify and compatible static hosts.
- `vercel.json` is included for Vercel.
- HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`) and `X-Frame-Options: DENY` are set globally as defense-in-depth alongside the CSP `frame-ancestors 'none'`.

No build command is required. Upload the folder as-is.

## First deployment after the broken release

The new service worker is network-first and removes earlier FaceScore caches.
After deployment, load the site once, then reload once if a browser tab was
already open during deployment. The repaired service worker takes control
and future runtime assets cache on demand.

## Runtime self-test

Open:

```text
https://YOUR-DOMAIN/app.html?selftest=1
```

A passing result displays: `System check passed — the local model and bundled assets are ready.` This test loads the real graph, packed model data, loader, and selected WASM runtime without requesting camera permission.

## Browser support

Use current Safari on iPhone/iPad/macOS or current Chrome, Edge, or Firefox with JavaScript, WebGL, WebAssembly, and camera permission enabled. The app explains blocked permission, unavailable WebGL/WASM, missing assets, timeout, and camera-in-use states without silently collapsing.

## Privacy and product limits

- Camera frames remain in the browser and are not intentionally uploaded or stored.
- Optional history contains measurements and timestamps only.
- The product does not perform identity recognition, medical diagnosis, emotion inference, deception detection, or objective beauty judgment.
- Legal pages are included and connected: `privacy.html`, `terms.html`, and `refund.html`.
- MediaPipe notices are retained in `LICENSES/` and `THIRD_PARTY_NOTICES.md`.
- Google Fonts (Fraunces + Inter) are loaded from `fonts.googleapis.com` over HTTPS with `preconnect`. If your deployment CSP blocks third-party stylesheets, replace with self-hosted fonts.

## Local preview

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765`. Localhost is treated as a secure camera context by modern browsers.

## Pages

| Path | Purpose |
|------|---------|
| `index.html` | Landing page — hero, how-it-works, privacy, metrics, pricing preview, testimonials, FAQ, final CTA |
| `pricing.html` | Dedicated pricing page — tier comparison table, feature matrix, gift/access-code section, pricing FAQ |
| `app.html` | The application — camera, live metrics, save/export/print, history, settings, paywall |
| `privacy.html` | Privacy policy |
| `terms.html` | Terms of use |
| `refund.html` | Refund policy |
| `success.html` | Post-purchase landing (Stripe/Gumroad redirect target) |
| `404.html` | Error page |

## Architecture

- **Multi-page static HTML** — no React, no build step, no server.
- **`shared.js`** — common module: storage, consent, entitlement, payment
  providers, tier rendering, kinetic typography, scroll reveal, scroll
  progress, mobile nav, animated counters, magnetic buttons, service-worker
  registration. Exposes `window.FaceScore.initCommon()` for pages to call.
- **`config.js`** — public storefront configuration (frozen).
- **`bndr-report.js`** — BNDR.Labs hidden one-click diagnostic report
  mechanism. Sanitized payload, sendBeacon/fetch keepalive, canned
  acknowledgment, hidden AI-executable repair prompt.
- **`vision-runtime.js`** — MediaPipe FaceMesh lifecycle (warmup, camera
  attach with iOS metadata waits, error classification).
- **`app.js`** — application: camera loop, frame processing, metrics,
  history, exports, walkthrough, paywall, settings, BNDR trigger wiring.
- **`landing.js` / `legal.js` / `sw-register.js`** — page-specific entry
  scripts that call `initCommon()` plus minor extras.
- **`service-worker.js`** — network-first shell cache + on-demand vendor
  asset cache.
- **`styles.css`** — bleeding-edge design system (CSS custom properties,
  `@property` animated gradients, scroll-driven reveals, glassmorphism,
  kinetic typography, magnetic buttons, sticky CTA, mobile-first
  responsive, `prefers-reduced-motion`, print styles).

## Testing

Run the regression test suite (requires Node.js + jsdom):

```bash
NODE_PATH=/tmp/jsdom-install/node_modules \
  node /home/z/my-project/scripts/regression-test.js
```

The suite covers file inventory, JS syntax, JSON validity, service-worker
shell list, CSP policies, hardening headers, BNDR.Labs module, frame timeout
fix, consent/preferences interaction, focus trap, history labels, CSV
disclaimer, print header, config endpoint, SW registration on all pages,
functional jsdom test (loads app.html with stubbed browser APIs), self-test
mode, access-code hashing, payment URL validation, no placeholders, README
docs, MediaPipe vendor integrity, manifest consistency, modal Escape +
backdrop, action log cap, and many more — 248+ assertions in 25+ groups.

## License

The application code outside `vendor/` is provided as part of this
deliverable. MediaPipe FaceMesh 0.4.1633559619 is bundled under Apache
License 2.0 — see `LICENSES/Apache-2.0.txt` and `THIRD_PARTY_NOTICES.md`.
