# 02 · Design System — "Paper & Ink"

> Paperwren's design language. Warm like paper, precise like ink. Professional, never boring, never loud.

---

## 1. Design concept

Every office app is either corporate-cold (blue, grey, white) or ad-App-clownish (orange banners, red badges). Paperwren goes the other way: **the app should feel like a well-made paper notebook.**

- **Paper** — surfaces are warm off-whites, not sterile white. Dark mode is "midnight ink," a warm near-black, never pure #000 blue-black.
- **Ink** — text is a warm black; the single accent color, **Ember** (a terracotta), is used sparingly and confidently, like a good pen.
- **Craft details** — a display serif (Fraunces) appears only in welcome moments and empty states, like the embossed name on a notebook cover. Progress bars draw like a line of ink. Nothing blinks, bounces, or begs.

**Moodboard in words:** Moleskine notebook · well-set book typography · a quiet reading room · one good fountain pen.

## 2. Color system

Two full themes: **Paper** (light) and **Midnight Ink** (dark). All tokens ship as CSS variables; both themes are first-class, never an afterthought.

### 2.1 Brand ramp — Ember (terracotta)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `ember-50` | `#FDF3EF` | `#2A1710` | Accent-tinted backgrounds |
| `ember-100` | `#FAE4DA` | `#3A1F15` | Accent container |
| `ember-300` | `#F0A184` | `#F49B7E` | Decorative |
| `ember-500` | **`#D95430`** | **`#F06A45`** | **Primary accent** — FAB, active states, links, sliders |
| `ember-600` | `#C24322` | `#D95430` | Accent text on paper (AA-safe) · pressed |
| `ember-700` | `#9E3517` | `#B24626` | Deep accent, focus rings |
| `ember-800` | `#7C2A12` | `#8C3418` | — |
| `ember-900` | `#5C1F0E` | `#6B2712` | — |

Contrast notes: `ember-600` on `bg` ≥ 4.5:1 (AA body text). White text on `ember-500` is used only at ≥ 14 sp bold / large text (AA-large). Small text on accent uses `ember-900` container pairing instead.

### 2.2 Semantic surfaces & text

| Token | Paper (light) | Midnight (dark) | Usage |
|-------|---------------|-----------------|-------|
| `bg` | `#FAF7F2` | `#161310` | App background (warm paper) |
| `surface` | `#FFFFFF` | `#201C17` | Cards, sheets, toolbars |
| `surface-2` | `#F1ECE3` | `#2A251E` | Recessed areas, chips, sliders' track |
| `surface-3` | `#E9E2D4` | `#342E25` | Hover/pressed on surface-2 |
| `border` | `#E5DDCD` | `#3B342A` | Hairlines, dividers, card outlines |
| `ink-1` | `#211B15` | `#F2EDE4` | Primary text |
| `ink-2` | `#5E564A` | `#BCB2A3` | Secondary text, icons |
| `ink-3` | `#8F8574` | `#83796A` | Placeholder, timestamps, disabled |
| `on-accent` | `#FFFFFF` | `#FFF6F1` | Text/icons on accent fills |

### 2.3 Status colors

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `success` | `#3D8F5F` | `#63B583` | Open-complete toasts |
| `warning` | `#E8A13A` | `#F0B45C` | Large-file caution banner |
| `danger` | `#CC4433` | `#E86A5A` | Errors, destructive actions |
| `info` | `#4A7DC4` | `#7FA7DB` | Neutral tips |

### 2.4 Format colors (the recognition system)

Each file format owns a hue used in badges, recents icons, onboarding, and viewer toolbars. This doubles as wayfinding: users learn "red = PDF" within a day.

| Format | Base | Container (light) | Container (dark) |
|--------|------|--------------------|-------------------|
| **PDF** | `ember-500 #D95430` | `#FAE4DA` | `#3A1F15` |
| **Word (DOCX)** | `#3B6BC7` denim | `#E1E9F8` | `#17263F` |
| **Excel (XLSX)** | `#3F9463` fern | `#DFF2E6` | `#12291C` |
| **Slides (PPTX)** | `#E8A13A` amber | `#FBEDD4` | `#332711` |
| Generic/text | `ink-3` | `surface-2` | `surface-2` |

Rule: format color appears **only** on the format badge/glyph and thin highlights (active tab underline, progress fill). Never as large surfaces — keeps the app calm.

### 2.5 OLED black mode

A settings variant of dark theme (`Pure black` toggle) swaps `bg → #000000`, `surface → #0C0A08`, keeps all text tokens. For AMOLED battery + late-night readers.

### 2.6 Dynamic color (Android 12+)

A settings toggle (default **off**): generate the palette from the user's wallpaper via Material You. When on, it re-maps accent + surfaces; format colors stay fixed for recognition.

## 3. Typography

| Role | Font | License | Notes |
|------|------|---------|-------|
| **UI + reading** | **Manrope** (variable) | OFL | Geometric-humanist, superb tabular numerals for spreadsheets |
| **Display moments** | **Fraunces** (variable) | OFL | Warm serif — welcome screen, empty states, section intros only |

**Bundle strategy:** subset both fonts to Latin + Cyrillic + Greek woff2 (~35 KB and ~25 KB); use `font-display: swap`. Never fetch fonts remotely.

### Type scale (sp / line-height)

| Token | Size | Font | Weight | Usage |
|-------|------|------|--------|-------|
| `display` | 32 / 38 | Fraunces | SemiBold 600 | Welcome headline, onboarding |
| `title-l` | 24 / 30 | Manrope | Bold 700 | Screen titles |
| `title-m` | 19 / 25 | Manrope | Bold 700 | Section headers, sheet titles |
| `title-s` | 16 / 22 | Manrope | SemiBold 600 | List item titles |
| `body` | 15 / 22 | Manrope | Regular 400 | Default body |
| `body-strong` | 15 / 22 | Manrope | SemiBold 600 | Emphasized body, buttons |
| `small` | 13 / 18 | Manrope | Regular 400 | Metadata, secondary |
| `caption` | 11 / 14 | Manrope | Medium 500 | Chips, badges, page counters |
| `mono-num` | any | Manrope `tnum` | — | Page numbers, sizes, cell values — always tabular figures |

Rules: reading content (DOCX) scales with user text-size setting up to 200%; UI chrome does not. Never use Fraunces for buttons, menus, or body text — scarcity keeps it special.

## 4. Spacing, grid & touch

- **Base unit: 4 dp.** Spacing tokens: `4, 8, 12, 16, 20, 24, 32, 40, 48`.
- Screen margins: 16 dp on phones; list content max-width 640 dp centered on tablets.
- **Minimum touch target: 48 × 48 dp** (non-negotiable, a11y).
- List rows: 56–72 dp tall, 16 dp inner padding, thumbnail 40 dp.
- Toolbar height: 56 dp (+ status bar inset). Bottom sheet handle: 32×4 dp pill.

## 5. Shape & elevation

| Token | Radius | Usage |
|-------|--------|-------|
| `radius-s` | 8 dp | Chips, badges, thumbnails |
| `radius-m` | 12 dp | Buttons, inputs, small cards |
| `radius-l` | 16 dp | Cards, dialogs |
| `radius-xl` | 20 dp | Bottom sheets (top corners), large cards |
| `radius-full` | 999 dp | FAB, pills, avatars |

Elevation is soft and warm (never pure-black shadows):

| Level | Shadow (light) | Dark mode treatment |
|-------|----------------|---------------------|
| 1 — cards | `0 1 3 rgba(60,42,20,.08), 0 4 12 rgba(60,42,20,.06)` | Surface lightens one step, no shadow |
| 2 — sheets/toolbar | `0 -2 12 rgba(60,42,20,.10)` (upward) | Border top hairline + surface step |
| 3 — dialogs/FAB | `0 6 24 rgba(60,42,20,.14)` | Border + surface step |

## 6. Component inventory

Implement once, use everywhere. Each lists its defining behavior; visual specs follow the tokens above.

| Component | Key behaviors |
|-----------|---------------|
| **Buttons** — filled (accent), tonal (ember-100), ghost (text-only), destructive | Press: scale 0.97 + tint `surface-3`, 120 ms. Height 44 dp. Loading state swaps label → 16 dp spinner, keeps width. |
| **FAB** | 56 dp, ember fill, ink-on-accent icon. Scrolls out of view downward, returns on upward scroll (56 dp translate, 220 ms). Long-press → tooltip "Open a file". |
| **File card / row** | 40 dp format glyph (see doc 03), name, `small` metadata line (size · date), chevron-less. Press: surface-2 tint. Selected (pin): pin glyph in ember. |
| **Format badge** | 8 dp-radius rounded square in format-container with format glyph. The app's most repeated visual element — spec'd fully in doc 03. |
| **Bottom sheet** | Drag handle; dismiss on drag-down > 96 dp or scrim tap; content scrolls under status bar; radius-xl top. |
| **Toolbar (viewer)** | Translucent `surface` at 92% opacity + blur fallback; auto-hides (doc 04). |
| **Slider (page scrubber)** | Thin 4 dp track `surface-2`, ember fill, 20 dp ember thumb that grows to 24 dp while dragging; live `caption` page counter bubble. |
| **Dialog** | radius-l, title `title-m`, actions right-aligned ghost buttons; destructive in `danger`, never filled-red. |
| **Banner** | Full-width `ember-50`/`surface-2` strip with 20 dp icon; for password, file-changed, large-file cautions. |
| **Snackbar** | `ink-1` bg, `bg` text, radius-m, optional action in ember-300; 4 s duration, swipe to dismiss. |
| **Progress — "ink underline"** | 3 dp bar under the toolbar; fill draws left→right in ember with the "ink draw" easing (doc 04). Replaces all spinners. |
| **Skeleton** | `surface-2` blocks with 8% ember shimmer sweep, 1.4 s loop; only used where content appears > 300 ms. |
| **Text field** | Filled style: `surface-2`, radius-m, ember-700 focus underline. Used for PDF password, search. |
| **Toggle** | 52×32 dp; on = ember track; thumb `surface`. |
| **Tooltip** | `ink-1` bg, `caption` size, 6 dp offset, auto-show on long-press of icon-only controls. |

## 7. Theming implementation contract

- Every color above ships as a CSS variable: `--bg`, `--surface`, `--ink-1`, `--accent`, … Theme switch = one class (`data-theme="dark"`) — **components never hardcode colors.**
- Status bar & nav bar are drawn edge-to-edge; chrome tint follows `bg` (dark icons on Paper, light on Midnight).
- All specs must pass WCAG AA (4.5:1 body, 3:1 large text/icons). Verified pairs are annotated in §2; any new pairing needs a ratio check before merge.

## 8. Do / Don't

| ✅ Do | ❌ Don't |
|-------|----------|
| One accent color, used sparingly | Gradients on controls, rainbow section colors |
| Warm shadows, generous whitespace | Pure black/white, harsh drop shadows |
| Ink-draw progress, calm fades | Spinners everywhere, pulsing "loading" text |
| Format colors as badges | Format colors as backgrounds/banners |
| Fraunces at welcome moments | Fraunces on buttons or body text |

---

*Next: [03 · Iconography & Brand Marks](03-iconography.md) — the unique icon pack, format glyphs, and the launcher icon.*
