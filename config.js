/* FaceScore Mirror — Luxury Edition public storefront configuration.
   Use hosted checkout URLs only. Never place Stripe/Gumroad secret keys here. */
window.FACESCORE_CONFIG = Object.freeze({
  PRODUCT_NAME: "FaceScore Mirror",
  PRODUCT_TAGLINE: "Private facial geometry, on your device",
  PRICE: "$29",
  PRICE_NOTE: "one-time purchase",
  CURRENCY: "USD",

  /* Pricing tiers — competitive one-time purchase model.
     Research basis (March 2026 market scan):
       - Golden Ratio Face app: $4.99/mo premium
       - FaceRead AI: $9.99/mo
       - QOVES Studio: $29/mo or $290/yr (professional)
       - FaceShape AI: $14.99 one-time
       - Pretty Scale: free with ads
     Our positioning: premium one-time purchase, no subscription fatigue.
     Pro tier ($29) is the main offer; Studio tier ($59) anchors and
     adds commercial-use license for professionals. */
  TIERS: [
    {
      id: "demo",
      name: "Mirror Demo",
      tagline: "60 seconds to feel it out",
      price: 0,
      priceDisplay: "Free",
      pricePeriod: "",
      ctaLabel: "Start the demo",
      ctaHref: "app.html",
      features: [
        "60 seconds of live analysis",
        "Real-time bilateral balance",
        "Real-time proportion reference",
        "Real-time expression dynamics",
        "On-device — no uploads",
      ],
      disabledFeatures: [],
      featured: false,
    },
    {
      id: "pro",
      name: "Mirror Pro",
      tagline: "Own the full private tool, forever",
      price: 29,
      priceDisplay: "$29",
      pricePeriod: "one-time",
      ctaLabel: "Buy Mirror Pro",
      ctaHref: "",
      stripeSku: "pro",
      gumroadSku: "pro",
      features: [
        "Unlimited analysis sessions",
        "Local metric history (20 snapshots)",
        "JSON + CSV export",
        "Printable / save-as-PDF reports",
        "All current + future geometry metrics",
        "Priority email support",
        "Lifetime access — no subscription",
      ],
      disabledFeatures: [],
      featured: true,
    },
    {
      id: "studio",
      name: "Mirror Studio",
      tagline: "For professionals who present and consult",
      price: 59,
      priceDisplay: "$59",
      pricePeriod: "one-time",
      ctaLabel: "Buy Mirror Studio",
      ctaHref: "",
      stripeSku: "studio",
      gumroadSku: "studio",
      features: [
        "Everything in Mirror Pro",
        "Commercial-use license",
        "Branded printable reports (your name + logo)",
        "Extended local history (50 snapshots)",
        "Early access to new metrics + features",
        "Dedicated support channel",
        "Lifetime access — no subscription",
      ],
      disabledFeatures: [],
      featured: false,
    },
  ],

  /* Checkout URLs.
     Replace empty strings with your hosted checkout URLs.

     For Stripe:
       1. Create a Stripe Payment Link for each tier (Pro $29, Studio $59).
       2. Set the post-payment success URL to https://YOUR-DOMAIN/success.html
       3. Configure Stripe to deliver an access code via email receipt.
       4. Paste the Payment Link URLs below.

     For Gumroad:
       1. Create a Gumroad product for each tier.
       2. Paste the product URLs below.
       3. Configure Gumroad fulfillment to email the access code.

     IMPORTANT: Use Payment Link URLs or product URLs only. Never paste
     Stripe secret keys, Gumroad access tokens, webhook secrets, or any
     private API credentials in this file. */
  STRIPE_PAYMENT_LINK: "",         // e.g. "https://buy.stripe.com/..."
  STRIPE_PAYMENT_LINK_STUDIO: "",  // e.g. "https://buy.stripe.com/..."
  GUMROAD_PRODUCT_URL: "",         // e.g. "https://yourstore.gumroad.com/l/pro"
  GUMROAD_PRODUCT_URL_STUDIO: "",  // e.g. "https://yourstore.gumroad.com/l/studio"

  SUPPORT_EMAIL: "",

  FREE_DEMO_SECONDS: 60,
  ACCESS_CODE_HASHES: [],
  STORAGE_VERSION: "2026-07-15",
  TERMS_VERSION: "2026-07-15",

  /* BNDR.Labs diagnostic endpoint. When a non-empty HTTPS URL is configured,
     unrecoverable failures offer a one-click "Notify BNDR.Labs" button that
     POSTs a sanitized diagnostic package here. Leave empty to disable the
     network send; the user-facing acknowledgment message is still shown. */
  BNDR_REPORT_ENDPOINT: "",
});
