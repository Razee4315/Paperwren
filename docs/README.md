# Paperwren — Product & Design Documentation

> **Open anything. Instantly.** A feather-weight, ad-free, no-login document viewer for Android.
> PDF · Word · Excel · PowerPoint — viewed beautifully, zero fuss.

Welcome to the single source of truth for everything Paperwren: product strategy, design system, motion language, screen specs, viewer behavior, architecture, privacy, and launch readiness. Everything here is **planning-level documentation** — no implementation code.

---

## The one-paragraph pitch

Paperwren is what happens when you delete everything annoying from an office app and keep only the part people actually need: **opening a file and reading it, fast**. No account. No ads. No upsells. No tracking. You tap a PDF in your Files app, choose Paperwren, hit **Always**, and from that day on every document opens in under a second on even a cheap phone. It weighs ~15 MB, works fully offline, and requests **zero Android permissions**.

---

## Document map

Read in order for onboarding, or jump to what you need.

| # | Document | What it covers | Status |
|---|----------|----------------|--------|
| 01 | [Product Vision & Roadmap](01-product-vision.md) | Problem, principles, users, scope, phases, naming | ✅ Final draft |
| 02 | [Design System — "Paper & Ink"](02-design-system.md) | Colors, typography, spacing, shape, components | ✅ Final draft |
| 03 | [Iconography & Brand Marks](03-iconography.md) | Icon language, format glyphs, launcher icon concept | ✅ Final draft |
| 04 | [Motion & Animation](04-motion.md) | Motion tokens, transitions, micro-interactions, haptics | ✅ Final draft |
| 05 | [Screen Inventory & Navigation](05-screens.md) | Every screen, page count, navigation map | ✅ Final draft |
| 06 | [Onboarding & Welcome Flow](06-onboarding.md) | First-run experience, full copy deck, coach marks | ✅ Final draft |
| 07 | [Viewer Specifications](07-viewers.md) | Per-format behavior: PDF, DOCX, XLSX, PPTX | ✅ Final draft |
| 08 | [Settings](08-settings.md) | Full settings IA, every key, defaults, behavior | ✅ Final draft |
| 09 | [Interaction & States](09-interactions.md) | How everything responds: loading, empty, errors, gestures | ✅ Final draft |
| 10 | [Technical Architecture](10-architecture.md) | Tauri + WebView plan, libraries, Android integration | ✅ Final draft |
| 11 | [Privacy & Compliance](11-privacy.md) | Data stance, privacy policy draft, Play Data Safety | ✅ Final draft |
| 12 | [Production Readiness & Launch](12-production.md) | QA plan, test corpus, Play Store listing, release process | ✅ Final draft |

---

## Decision snapshot

The headline decisions, so you never have to dig:

| Decision | Choice | Why (short) |
|----------|--------|-------------|
| App name | **Paperwren** | The wren is one of the smallest birds alive — "paper, but feather-light" is the whole brand in one word. Audited free: GitHub (user + org), `paperwren.app/.dev/.io` unregistered, no app or software product anywhere (2026-09-03). Runners-up: Emberwisp, Inkember. Full audit in [01 §10](01-product-vision.md#10-naming--brand). |
| Platform | Android first (Tauri 2) | Tauri 2 ships stable Android support; the best lightweight Office renderers are web renderers, so a WebView-centric app is the natural home for them. |
| UI framework | Svelte 5 + TypeScript (recommended) | Tiny runtime, fast, small bundle. Alternatives vetted in doc 10. |
| Renderers | pdf.js · docx-preview · SheetJS + custom grid · PPTX renderer (phased) | Proven, permissively licensed, offline-capable. See doc 07/10. |
| Min Android | 8.0 (API 26) | Covers ~97% of devices; avoids ancient WebView pain. |
| Design language | **Paper & Ink** | Warm paper surfaces, ink-dark dark mode, terracotta "Ember" accent. Distinctive without being loud. |
| Fonts | Manrope (UI) + Fraunces (display moments) | Both OFL, both characterful, both subset-able to stay light. |
| Permissions | **Zero** | System file picker (SAF) + "open with" intents need no permissions at all. A real privacy selling point. |
| Telemetry | **None** | No analytics, no crash upload, no network calls in v1. Privacy is the brand. |
| Monetization | Free, ad-free; optional one-time "Supporter" tip jar later | No ads, ever. No accounts, ever. |

## Release phases

| Version | Theme | Contents |
|---------|-------|----------|
| **v0.9** | Internal | Project scaffold, PDF viewer, onboarding, recents |
| **v1.0** | Public launch | PDF (excellent) + XLSX (good) + onboarding + settings + privacy |
| **v1.1** | Documents | DOCX reader, in-app storage browser, more languages |
| **v1.2** | Slides | PPTX viewer, PDF enhancements (outline, thumbnails) |
| **v1.3** | Polish | CSV, ODF preview, print via system service |
| **v2.0+** | Beyond | Light editing (form-fill, notes), themes, tablets/optimized |

> Full rationale in [01-product-vision.md](01-product-vision.md).

## How to use these docs

- **Status legend** — ✅ final draft · 🚧 in progress · 💤 parked. All docs currently ✅.
- Every spec is written so an engineer or designer can implement without asking "what did they mean."
- Copy decks (exact user-facing strings) are marked **COPY** and quoted in tables.
- Token names use `kebab-case` (e.g., `accent-ember-500`) and are stable contract names — don't rename them casually.
- Docs live in `docs/` next to the future app repo; keep them updated as decisions change.

---

*Paperwren documentation · v1.0 of the docs · September 2026*
