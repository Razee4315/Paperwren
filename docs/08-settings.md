# 08 · Settings

> Settings exist so the app defaults to the right behavior — not to expose every internal knob. Five groups, ~20 keys, every one instant-apply. No restarts, ever.

---

## 1. Information architecture

```
SET-00 Settings
├── SET-01 Appearance
├── SET-02 Viewer defaults
├── SET-03 Files & storage
├── SET-04 Privacy & security
└── SET-05 About
    └── Open-source licenses
```

Global rules: changes apply instantly; no "save" buttons; each row shows its current value as end-of-row `small` text; destructive actions confirm via dialog + offer Undo where cheap.

## 2. Full key registry

Keys are the stable contract between UI, store, and tests.

### SET-01 · Appearance

| Key | Type | Default | Options / notes |
|-----|------|---------|-----------------|
| `appearance.theme` | enum | `system` | `system` · `light` · `dark` — live-switch, no flash |
| `appearance.pure_black` | bool | `false` | OLED variant of dark (doc 02 §2.5); visible only when theme resolves dark |
| `appearance.dynamic_color` | bool | `false` | Material You wallpaper palette (Android 12+); format colors stay fixed |
| `appearance.language` | enum | `system` | System + shipped locales (en at v1.0; +5 by v1.1) |

### SET-02 · Viewer defaults

| Key | Type | Default | Options / notes |
|-----|------|---------|-----------------|
| `viewer.zoom_mode_pdf` | enum | `fit_width` | `fit_width` · `fit_page` · `100` |
| `viewer.remember_position` | bool | `true` | Per-file resume across formats |
| `viewer.keep_screen_on` | bool | `false` | While a viewer is open |
| `viewer.darken_pages` | bool | `false` | PDF page darkening (doc 07 §2) |
| `viewer.docx_reading_size` | int | `100` | 70–200%, DOCX reading mode text scale |
| `viewer.chrome_autohide` | bool | `true` | 2.5 s auto-hide in viewers |
| `viewer.haptics` | bool | `true` | Ticks per doc 04 §6 |

### SET-03 · Files & storage

| Key | Type | Default | Options / notes |
|-----|------|---------|-----------------|
| `files.save_recents` | bool | `true` | Off → recents list disabled & cleared (privacy-hardened mode) |
| `files.recents_limit` | enum | `50` | `20` · `50` · `100` · `unlimited` |
| `files.cache_size` | display | — | Read-only: "12.4 MB" + **Clear cache** button (snackbar confirms with freed size) |
| `files.clear_recents` | action | — | Dialog "Remove all recents?" · destructive-ghost · undoable snackbar 4 s |

### SET-04 · Privacy & security ★ (a brand page)

Sparse on purpose. Written in plain sentences, zero legalese — this page is marketing that happens to be settings.

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `privacy.hide_in_switcher` | bool | `false` | Blurs viewer content in the recents/task switcher (FLAG_SECURE) |
| `privacy.screenshot_block_viewer` | bool | `false` | Blocks screenshots *in viewers only* (same mechanism) |
| — | static text | — | "Paperwren has no ads, no accounts, and no analytics. It never connects to the internet." + link to full policy (in-app page, not a URL) |
| `privacy.view_policy` | action | — | Opens in-app privacy page (doc 11 §6) |

### SET-05 · About

| Row | Behavior |
|-----|----------|
| Version | `1.0.0 (build 12)`; tap 5× → easter egg: fanned-stack confetti of format sheets (2 s, reduced-motion: static badge) |
| Check for updates | Deep-links to Play Store page (no self-update logic, no network from app) |
| Rate Paperwren | Play store rating intent |
| Share Paperwren | System share sheet with store link |
| Privacy policy | In-app page |
| Open-source licenses | Legal requirement — auto-generated list of all bundled libraries with licenses (pdf.js, SheetJS, docx-preview, Lucide, Manrope, Fraunces, Svelte, Tauri, …) |
| Support | `mailto:` link — the only "contact" that exists |

## 3. Behaviors & edge cases

| Case | Behavior |
|------|----------|
| System theme changes mid-session | Instant transition, `dur-fast` crossfade (doc 04) |
| `files.save_recents` turned off | Recents cleared immediately + confirm snackbar "Recents cleared and won't be saved." |
| Cache clear while viewing | Current file stays in memory; next open re-copies from source |
| Language override to unsupported-by-system scripts | Falls back to English strings; never blank labels |
| First run | All defaults above ship pre-set; settings untouched by onboarding |

## 4. Storage implementation note

Settings live in a single local key-value store (Tauri store plugin / JSON in app-private storage). No settings sync anywhere — there is no account to sync to, by design. Export/import of settings is a **non-goal** (complexity > value for a viewer).

---

*Next: [09 · Interaction & States](09-interactions.md) — how everything responds when things go right and wrong.*
