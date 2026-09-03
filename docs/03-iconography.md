# 03 · Iconography & Brand Marks

> One icon language everywhere: rounded, ink-drawn, quietly distinctive. The format glyph family is Paperwren's signature — nobody else has it.

---

## 1. UI icon language

**Base set: [Lucide](https://lucide.dev)** (ISC license — free, permissive, 1,500+ icons, consistent 24 px grid).

Every app needs ~45 UI icons (nav, toolbar, settings, player controls). Lucide covers them; don't mix a second set — visual consistency beats variety.

### Style contract (applies to every icon, ours or Lucide's)

| Property | Spec |
|----------|------|
| Grid | 24 × 24 dp, 2 px padding safe zone |
| Stroke | 1.75 px at 24 dp (Lucide default 2 px, thinned for finesse) |
| Caps & joins | **Round** caps, round joins |
| Corners | Soft radii only — no sharp angles anywhere |
| Fill | Never filled, except the format glyph family (§2) |
| Color | `ink-2` default; `ink-1` when active; `on-accent` on accent fills |
| Hit area | Icon 24 dp inside a 48 dp touch target |

**Icons we design in-house** (Lucide has no equivalent that fits): the 12 format glyphs (§2) and the logo marks (§3).

### Core UI icon list (approved names)

`folder-open` · `clock` (recents) · `pin` · `search` · `x` · `chevron-left/right/down` · `more-horizontal` · `sun` / `moon` / `monitor` (theme) · `sliders-horizontal` (settings) · `list` (outline) · `bookmark` · `zoom-in` / `zoom-out` · `fit-screen` · `rotate-cw` · `text` (text size) · `copy` · `share` · `info` · `shield` (privacy) · `trash` · `layers` (sheets) · `grid` (thumbnails) · `eye-off` (hide in switcher) · `sparkles` (supporter)

## 2. The format glyph family — Paperwren's signature ★

The most repeated visual in the app. Instead of generic file icons, every format gets a **crafted glyph**: a folded-sheet silhouette holding a minimal, geometric motif that hints at the content.

### Construction rules

1. **Canvas:** 24 × 24, sheet silhouette = rounded rect (r=3) with the top-right corner **folded** (a 7-unit 45° fold) — the "folded page" is our brand motif, echoing the launcher icon.
2. **Motif:** one 2 px ink motif centered inside, drawn from a fixed vocabulary (below). Max one motif per glyph — restraint reads as premium.
3. **Presentation:** glyph in `ink-1` on the format's **container color** in a `radius-s` badge (doc 02 §2.4). Dark mode: glyph in format-tint light color on dark container.
4. **No letters.** Never "PDF" text inside the icon — the color + motif system carries recognition. (Text badges are a WPS cliché.)

| Format | Motif | Rationale |
|--------|-------|-----------|
| **PDF** | Horizon line + mountain peak + small sun dot (lucide `image`-style landscape, miniaturized) | PDF = finalized, "printable" page; universally read as "document" |
| **Word/DOCX** | Three descending-length text lines (last line 40% width) | Text flow |
| **Excel/XLSX** | 2×2 mini grid (cells), top-left cell filled | Grid = spreadsheet |
| **PowerPoint/PPTX** | Right-pointing triangle (play) + baseline | "Presenting" |
| **CSV** | Grid + one comma in the free cell | CSV's comma |
| **ODF (odt/ods/odp)** | Sheet with circle motif (the O of OpenDocument) | Family resemblance |
| **TXT** | Sheet only, no motif — a plain page | Plain text needs no decoration |
| **HTML/EPUB** | Angle brackets / book spine | — |
| **Image** | Mountain-sun motif (larger, unfilled) | — |
| **Unknown/binary** | Sheet with "?" dot-line | Never a scary glyph |

**State variants:** normal · `pinned` (adds 10 dp ember pin at bottom-left of badge) · `dimmed` (55% opacity, for missing-file entries) · `large` (48 dp, onboarding & empty states).

## 3. The launcher icon — "The Fanned Stack" ★

### Concept

Three document sheets **fanned like a hand of cards** — one PDF-red, one denim, one fern (the format colors) — with the top sheet showing the folded corner. Reads instantly as "many formats, one place." Warm paper background keeps it calm among loud Play Store icons.

### Geometry (108 dp adaptive canvas)

- **Background layer:** `ember-50` → `#FAE4DA` subtle radial (center-top light), flat fill fallback. No pattern, no text.
- **Foreground layer:** three 56×72 dp rounded sheets (r=10), rotated **−12° / 0° / +12°**, stacked bottom-left → top-right, overlapping by 30%:
  - Bottom: fern `#3F9463` at 85% opacity
  - Middle: denim `#3B6BC7` at 85%
  - Top: ember `#D95430` solid, with its top-right corner folded (a lighter `ember-300` triangle fold) and a 2 dp paper-colored inset border for depth
- **Monochrome layer (Android 13 themed icons):** the fanned stack as a single-color silhouette — this must look good since it's what themed-icon users see.
- **Legacy square/round:** center the 72 dp mark on the ember-50 field with 16 dp padding.

### Wordmark & in-app logo

- **Wordmark:** "Paperwren" set in **Fraunces SemiBold** with tight tracking (−2%), one word, capital P; the two "paper" tones may tint the letters — `ink-1` for "Paper", ember for "wren". Used on welcome screen and About only.
- **In-app glyph:** single folded-sheet (the top sheet alone) in ember — used in the toolbar of the About screen and snackbar confirmations.

## 4. Illustration style (empty states & onboarding)

Hand-in-hand with the "Paper & Ink" system; these make the app feel authored, not generated.

| Rule | Spec |
|------|------|
| Technique | Line art, 2 dp `ink-1` strokes at 90% opacity, round caps — same language as the icons |
| Accents | Exactly one format color per illustration, as a flat shape (e.g., an ember sheet) |
| Texture | Optional 4%-opacity paper grain overlay on illustration area only |
| The wren ★ | One character only, one context only: a tiny wren (60–80 dp, same line-art style, ember breast) **perched on** the focal object — the stack of sheets, the folder, the reading lamp. It appears in onboarding and empty states to embody "feather-light"; it never appears in UI chrome, toolbars, dialogs, or error states. Paperwren is a tool first; the wren is a quiet signature, not a mascot show |
| Composition | Single focal object, centered, 25% of the container height; generous whitespace |
| Motion | One gentle idle animation (doc 04): a sheet drifting ±2 dp, 4 s ease loop — skipped in reduced-motion |

## 5. Licensing & asset checklist

| Asset | Source | License | Action at integration |
|-------|--------|---------|----------------------|
| Lucide icons | lucide.dev | ISC | Verify at add-time; include attribution in licenses screen |
| Manrope, Fraunces | Google Fonts | OFL | Subset; include license files |
| Format glyphs, launcher, illustrations | In-house | Project-owned | Export SVG source in `assets/brand/`, versioned |

**Export rules:** every icon ships as SVG, name-kebab (`glyph-pdf.svg`), `currentColor` for strokes; launcher exports per Android adaptive-icon spec (foreground 108 dp safe zone, background, monochrome).

---

*Next: [04 · Motion & Animation](04-motion.md) — how Paperwren moves.*
