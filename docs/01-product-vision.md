# 01 · Product Vision & Roadmap

> **Paperwren — Open anything. Instantly.**

---

## 1. The problem

Every "office" app on the Play Store punishes the user for the crime of just wanting to *read a file*:

| App | The pain |
|-----|----------|
| WPS Office | Full-screen ads, login nags, bloat (~300 MB install) |
| Microsoft 365 | Requires a Microsoft account to be useful; upsells subscription |
| Adobe Acrobat | Upsells Premium at every turn; heavy; tracks usage |
| OfficeSuite | Ads + paywall for basic comfort features |
| Google Drive viewer | Requires file to be in Drive/Google ecosystem |
| "Simple" viewers | Usually abandoned, ugly, or PDF-only |

**The gap:** nobody offers a small, beautiful, offline, permission-free, no-login *viewer* that handles the four formats people actually receive: **PDF, Word, Excel, PowerPoint.**

## 2. Vision statement

> Paperwren is the fastest, calmest way to open a document on Android. It does one job — *showing* you your files — and does it with respect: no ads, no accounts, no tracking, no waiting.

## 3. Product principles

These five principles are the tie-breakers for every future decision. If a feature violates one, it doesn't ship.

1. **Zero friction.** No account, no ads, no interstitials, no permissions, no "pro" nag. Open a file in under 2 seconds from cold start.
2. **Your files stay yours.** 100% offline. Nothing is uploaded, nothing is phoned home — there are literally no network calls in v1.
3. **Featherweight.** Install under ~25 MB. Cold start under 1.2 s on a low-end device. RAM stays under budget on 2 GB phones.
4. **Calm confidence.** The design is warm, quiet, and precise. The app never shouts, never nags, never blinks at you for attention.
5. **Honesty over dark patterns.** Clear errors ("this file is password-protected") instead of spinners; graceful degradation instead of fake support; every setting does exactly what it says.

## 4. Target users

| Persona | Story | What wins them |
|---------|-------|----------------|
| **Aisha, 21, student** | Gets lecture PDFs and DOCX notes on a 2 GB-decade-old phone via WhatsApp. Hates WPS ads. | Tiny install, instant opens, dark mode for late-night reading. |
| **Ravi, 34, field engineer** | Receives XLSX inventory sheets and PPTX briefs on the road. Zero patience for logins. | "Always" open-with reliability, offline, spreadsheets that just scroll. |
| **Maya, 45, small-business owner** | Privacy-conscious. Doesn't want invoices sent to any cloud. | Zero permissions, zero telemetry, clear privacy policy. |

## 5. Goals & non-goals

### Goals (v1.x)
- Be the **default "open with → Always"** choice for PDF/DOCX/XLSX/PPTX.
- Sub-2-second open for typical files on low-end hardware.
- 5★-bait polish: coherent design, thoughtful details, zero crashes.
- A privacy story strong enough to print on the store listing: **no permissions, no tracking, no network.**

### Non-goals (explicitly, for v1)
- ❌ Editing (v2+ explores light editing: form-fill, notes — see roadmap)
- ❌ Cloud accounts / sync / sign-in of any kind
- ❌ Ads or third-party SDKs
- ❌ Annotation & markup (parked; possible v2)
- ❌ Creating new documents
- ❌ Converting between formats

## 6. Feature scope matrix

| Capability | v1.0 | v1.1 | v1.2 | v1.3 |
|------------|:----:|:----:|:----:|:----:|
| PDF viewer (zoom, search, outline, position memory) | ✅ | ✅ | ✅+ | ✅ |
| Password-protected PDF open | ✅ | ✅ | ✅ | ✅ |
| XLSX viewer (sheet tabs, freeze, copy cell) | ✅ | ✅ | ✅ | ✅ |
| DOCX reader | ➖ v1.1 | ✅ | ✅ | ✅ |
| PPTX viewer | ➖ v1.2 | ➖ | ✅ | ✅ |
| CSV / TXT / ODF preview | ➖ | ➖ | ➖ | ✅ |
| In-app storage browser | ➖ | ✅ | ✅ | ✅ |
| Recents + pin favorites | ✅ | ✅ | ✅ | ✅ |
| Print via Android system service | ➖ | ➖ | ➖ | ✅ |
| Light editing (form-fill, notes) | — | — | — | v2 |

## 7. Roadmap & release strategy

Ship in slices; each release is genuinely useful on its own. PDF-first because it's the highest-demand, highest-fidelity format and it validates all the plumbing (intents, recents, settings, store listing) on the easiest case.

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **v0.9 — Internal** | Scaffold, PDF viewer, onboarding, recents, settings v1 | Team dogfood: open 200-file corpus with 0 crashes |
| **v1.0 — Public launch** | PDF + XLSX, polish, privacy page, store launch | Crash-free ≥ 99.5%, cold start < 1.2 s (p50 on test device) |
| **v1.1 — Documents** | DOCX reader, storage browser, 5 more languages | DOCX fidelity checklist ≥ 95% pass |
| **v1.2 — Slides** | PPTX viewer, PDF thumbnails + outline upgrades | PPTX renders text/images/tables correctly on corpus |
| **v1.3 — Breadth** | CSV/TXT/ODF, print, fine-polish pass | Store rating ≥ 4.5 maintained |
| **v2.0 — Beyond** | Light editing exploration, tablets | Separate discovery doc |

## 8. Positioning

> **"The document viewer that stays out of your way — and out of your data."**

Competitive frame: Paperwren is to office apps what a good gallery app is to photo suites. We don't create documents; we're the fastest path between "I received a file" and "I've read it."

## 9. Success metrics (no telemetry required)

We measure success without tracking users:

- **Play vitals** (Google-provided, aggregate): crash rate, ANR rate, install size
- **Store signals**: rating, review themes, uninstall rate
- **Delight proxies**: "small & fast" mentioned in positive reviews; feature requests in reviews
- Any future opt-in, anonymous, local-first diagnostics are strictly opt-in and documented (see doc 11) — v1 has none.

## 10. Naming & brand

- **Name: Paperwren** — the wren is one of the smallest birds alive; pair it with paper and the name *is* the product promise: **all your documents, feather-light.** Warm, memorable, pronounceable in any language, and it gives the brand a quiet mascot (a little wren perched on a stack of papers — used sparingly in illustrations, never in UI chrome).
- Package id: `app.paperwren.docs`
- Tagline: **Open anything. Instantly.**
- Voice: quiet, warm, precise. Never exclamatory. The app says "Ready." not "🎉 WELCOME!!!"

### Availability audit (checked 2026-09-03)

| Asset | Status | Detail |
|-------|--------|--------|
| GitHub user `github.com/paperwren` | ✅ **Free** | HTTP 404 |
| GitHub org `github.com/orgs/paperwren` | ✅ **Free** | HTTP 404 — claim both when scaffolding |
| `paperwren.app` | ✅ **Unregistered** | The natural domain for an Android app (Google's TLD, HTTPS-enforced) |
| `paperwren.dev` | ✅ Unregistered | Optional docs/blog home |
| `paperwren.io` | ✅ Unregistered | — |
| `paperwren.com` | ⚠️ Parked, no site | GoDaddy aftermarket lander — no active product; optionally acquire later, not blocking |
| Google Play | ✅ **No listing** | No app named Paperwren (searched name variants) |
| Web presence | ✅ No software conflict | Only hits: a Pinterest crafts profile ("thepaperwren527") and a small non-software recruitment page ("Paperwren Media") — different industry, no tech product |

> Audit method: RDAP registry lookups (.com/.app/.dev/.io), GitHub namespace probes (control-tested with a guaranteed-nonexistent name), and targeted web searches for products/listings. Before Play launch, do one final re-check of GitHub + `.app` and register them if not already claimed.
> Runners-up if Paperwren ever falls through: **Emberwisp** (GitHub + .app free, .com parked), **Inkember** (GitHub + .app free, .com dead-parked). **Quietfold** was rejected — an active site exists at quietfold.com.

### First-day brand registrations (do at scaffold time)

1. Create GitHub org `paperwren` (+ reserve user name)
2. Register `paperwren.app` (~$15/yr)
3. Reserve handles `@paperwren` on X/Instagram if you want them — checked best-effort only (login walls prevent definitive checks); unverified but no indexed product uses them

## 11. Business model

- v1.x: completely free, ad-free — the brand *is* the absence of monetization noise.
- Future (optional, non-gated): a one-time **"Supporter"** in-app purchase / tip jar that adds a badge and funds development. **Nothing user-facing is ever paywalled.** If a feature can't be free, it doesn't exist.
