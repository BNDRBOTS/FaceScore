# FaceScore Mirror — production package

FaceScore Mirror is a static, local-first SaaS product. Facial landmarks and geometry are processed in the browser with the bundled MediaPipe runtime. No account or application backend is required for analysis.

## Production repair in this release

The prior build could obtain camera permission, flash the video, then return to the unchanged launch screen. The camera was not the root failure. The app marked the model ready before its graph, packed assets, and WebAssembly runtime had completed loading; the first camera frame became the actual initialization attempt, and any model exception immediately stopped the camera.

This package corrects that startup chain:

1. Browser, WebGL, and WebAssembly capability checks run first.
2. The exact bundled model performs a warmup inference before camera permission is requested.
3. Mobile and desktop use adaptive camera constraints with safe fallbacks.
4. iOS playback waits for metadata and current video data before analysis begins.
5. Model failure pauses analysis without destroying the camera preview.
6. One automatic model restart is allowed; further failures present a controlled manual retry instead of looping.
7. Large model/WASM assets are cached on demand rather than competing with first startup.
8. Safari-compatible WebAssembly CSP and host MIME rules are included.

## Files that must remain together

Deploy the complete folder. Do not omit or rename:

- `app.html`, `app.js`, `vision-runtime.js`
- `vendor/` and every file inside it
- `styles.css`, `shared.js`, `config.js`
- `service-worker.js`, `manifest.webmanifest`, `icons/`

The application will fail closed with a visible diagnostic when required runtime assets are missing.

## Checkout configuration

Edit only the public values in `config.js`:

```js
STRIPE_PAYMENT_LINK: "https://buy.stripe.com/...",
GUMROAD_PRODUCT_URL: "https://your-store.gumroad.com/l/...",
SUPPORT_EMAIL: "support@your-domain.com",
```

Only a configured provider appears. Either provider can be used alone, or both can be shown. Invalid or non-HTTP(S) values are rejected and no button is rendered.

Use a Stripe **Payment Link**, not a Stripe secret key. Never place Stripe secret keys, Gumroad access tokens, webhook secrets, or private API credentials in frontend files.

For Stripe, set the post-payment redirect to:

```text
https://YOUR-DOMAIN/success.html
```

Configure Stripe or Gumroad fulfillment to deliver the customer’s access code.

## Owner and gift access codes

Access codes are stored as SHA-256 hashes. Generate a hash:

```bash
python3 -c "import hashlib; print(hashlib.sha256('YOUR-CODE'.replace(' ','').upper().encode()).hexdigest())"
```

Add the resulting hash to `ACCESS_CODE_HASHES` in `config.js`. This supports owner access, review copies, gifts, and private giveaways.

Because this edition intentionally has no backend, the browser gate is practical storefront access control, not tamper-proof DRM. Per-customer automatic license verification would require a small server-side verification endpoint.

## Deployment requirements

- Serve through **HTTPS**. Do not open `app.html` directly with `file://`.
- Preserve exact relative paths and filename capitalization.
- Serve `.wasm` as `application/wasm`.
- Serve `.data` and `.binarypb` as `application/octet-stream`.
- Do not override the app CSP with a stricter host policy. `app.html` requires local WebAssembly execution through `'unsafe-eval'` and `'wasm-unsafe-eval'` because of the bundled Emscripten runtime.
- `_headers` is included for Netlify and compatible static hosts.
- `vercel.json` is included for Vercel.

No build command is required. Upload the folder as-is.

## First deployment after the broken release

The new service worker is network-first and removes earlier FaceScore caches. After deployment, load the site once, then reload once if a browser tab was already open during deployment. The repaired service worker takes control and future runtime assets cache on demand.

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

## Local preview

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765`. Localhost is treated as a secure camera context by modern browsers.
