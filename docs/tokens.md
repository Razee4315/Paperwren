# Design tokens

Every colour, timing and size the interface uses comes from `src/styles/global.css`. Components read variables; they do not carry their own values. This file lists the variables, what each is for, and the rule each one meets, so a new screen can pick from it.

The colour tables below were generated from the CSS, not typed by hand. If a value in the CSS changes, regenerate the table.

Contents: [themes](#themes), [colours](#colours), [contrast rules](#contrast-rules), [motion](#motion), [radii, size and spacing](#radii-size-and-spacing), [shadows](#shadows), [forced colours](#forced-colours).

## Themes

A theme is one attribute: `data-theme` on the element that should wear it. It is not tied to `:root`, so Settings and the welcome screen can show a live preview by putting the attribute on a small element. Five themes exist:

| Name in the app | `data-theme` | Scheme | Note |
|---|---|---|---|
| Paper | `light` (also the `:root` default) | light | Warm off-white, pine-teal accent, textured page background |
| Sand | `sepia` | light | Low blue light, terracotta accent, textured |
| Ink | `dark` | dark | Soft charcoal, mint accent, textured |
| Plain light | `plain-light` | light | Neutral greys, no texture |
| Plain dark | `plain-dark` | dark | Near black, no texture |

`theme: "system"` is the default and resolves to the plain pair by the device's colour scheme. On desktop the shell reads the stored theme before the window is shown and colours the window with that theme's `--bg`; the page also sets `data-theme` from a hint in `localStorage` before first paint (`index.html`, key `paperwren.theme-hint`). So a new theme needs its `--bg` known to `src-tauri/src/placement.rs` as well as to the CSS.

## Colours

Each theme block defines the same 41 variables. A theme must define all of them.

### Surfaces and lines
| Token | Paper (`light`) | Sand (`sepia`) | Ink (`dark`) | Plain light | Plain dark | Use and rule |
|---|---|---|---|---|---|---|
| `--bg` | `#f3f1ec` | `#ede3d0` | `#16181b` | `#ffffff` | `#0e0e10` | Page and app background. Text tokens are read against it. |
| `--surface` | `#fbfaf7` | `#f6eedf` | `#1f2226` | `#ffffff` | `#18181b` | Cards, sheets, dialogs, bars. |
| `--surface-2` | `#ece9e2` | `#e5d9c2` | `#272b30` | `#f3f3f4` | `#222226` | Inset fills, hover fills, segmented tracks. |
| `--surface-3` | `#dfdbd2` | `#d9c9ad` | `#32373d` | `#e6e6e8` | `#2d2d32` | Pressed fills, the deepest inset. |
| `--canvas` | `#e7e4dd` | `#e0d3ba` | `#111315` | `#ececee` | `#0a0a0b` | The area behind a document page. |
| `--line` | `#e2ded5` | `#dccdb2` | `#2b2f34` | `#e4e4e7` | `#26262a` | Decorative hairlines and dividers only. Not a control boundary: it is below 3:1 on purpose. |
| `--line-strong` | `#cbc6bb` | `#c6b396` | `#3d4349` | `#cfcfd4` | `#3a3a40` | Emphasised dividers and rings that are not the only edge of a control. Below 3:1. |
| `--line-control` | `#77746d` | `#756956` | `#92969a` | `#828285` | `#88888c` | Boundary of anything that is a control (field, switch, chip, segmented control, scrollbar thumb). 3:1 or more against bg, surface, surface-2, surface-3, canvas and accent-soft (WCAG 1.4.11). |
| `--scrim` | `rgba(35, 34, 31, 0.36)` | `rgba(58, 46, 34, 0.36)` | `rgba(0, 0, 0, 0.55)` | `rgba(0, 0, 0, 0.32)` | `rgba(0, 0, 0, 0.6)` | The veil behind a dialog or sheet. |

### Text
| Token | Paper (`light`) | Sand (`sepia`) | Ink (`dark`) | Plain light | Plain dark | Use and rule |
|---|---|---|---|---|---|---|
| `--text` | `#23221f` | `#3a2e22` | `#e6e2da` | `#18181b` | `#f2f2f3` | Body text. 4.5:1 or more on every surface. |
| `--text-2` | `#4f4d47` | `#4c3f32` | `#b6b2aa` | `#46464d` | `#b5b5bd` | Secondary text. 4.5:1 or more on every surface. |
| `--text-3` | `#5d5b55` | `#5e5244` | `#a3a19b` | `#56565e` | `#a1a1a9` | Counts, hints, captions. 4.5:1 or more on every surface, including surface-3. Never dimmed with `opacity` (that undoes the ratio); use this token. |

### Accent and brand
| Token | Paper (`light`) | Sand (`sepia`) | Ink (`dark`) | Plain light | Plain dark | Use and rule |
|---|---|---|---|---|---|---|
| `--accent` | `#296a62` | `#884227` | `#7cc2b4` | `#2b6e66` | `#7cc2b4` | Links, selected state, primary fill, focus. 4.5:1 or more as text on bg, surface, surface-2, surface-3, canvas and accent-soft. |
| `--accent-hover` | `#225a53` | `#8a4226` | `#98d2c6` | `#225a53` | `#98d2c6` | Hover and pressed fill of the accent. |
| `--accent-soft` | `#dcebe7` | `#eed8c6` | `#1f3531` | `#e2efec` | `#1c302c` | Tinted fill behind accent text. |
| `--on-accent` | `#ffffff` | `#fff8ef` | `#10201d` | `#ffffff` | `#0c1c19` | Text and icons on `--accent` and `--accent-hover`. 4.5:1 or more. |
| `--brand-beak` | `#e07a4f` | `#d98a2b` | `#eba27c` | `#e07a4f` | `#eba27c` | Logo only. |
| `--brand-eye` | `#23221f` | `#3a2e22` | `#16181b` | `#18181b` | `#0e0e10` | Logo only. |
| `--brand-dark` | `#1f5750` | `#843f23` | `#5aa596` | `#1f5750` | `#5aa596` | Logo only. |
| `--brand-belly` | `#8fbcb3` | `#dca283` | `#c6e6de` | `#8fbcb3` | `#c6e6de` | Logo only. |

### State
| Token | Paper (`light`) | Sand (`sepia`) | Ink (`dark`) | Plain light | Plain dark | Use and rule |
|---|---|---|---|---|---|---|
| `--danger` | `#9f3020` | `#8c2919` | `#f59381` | `#aa3423` | `#ec8a78` | Error text and destructive buttons. 4.5:1 or more on every surface; its 10% tint also holds 4.5:1 for text over it. |
| `--success` | `#256d48` | `#3b5f2c` | `#74c095` | `#23704a` | `#74c095` | Success text. 4.5:1 or more on every surface. |
| `--highlight` | `rgba(240, 196, 64, 0.5)` | `rgba(226, 170, 60, 0.45)` | `rgba(232, 190, 80, 0.35)` | `rgba(240, 196, 64, 0.5)` | `rgba(232, 190, 80, 0.35)` | Search hits and text highlights in documents. Not checked against text (document content). |
| `--highlight-active` | `rgba(224, 122, 79, 0.55)` | `rgba(196, 96, 50, 0.5)` | `rgba(235, 162, 124, 0.5)` | `rgba(224, 122, 79, 0.55)` | `rgba(235, 162, 124, 0.5)` | The current search hit. Not checked against text. |

### File formats
| Token | Paper (`light`) | Sand (`sepia`) | Ink (`dark`) | Plain light | Plain dark | Use and rule |
|---|---|---|---|---|---|---|
| `--fmt-pdf` | `#ca4d37` | `#bb4e34` | `#e8846f` | `#ca4d37` | `#e8846f` | File icon fill for PDF. 3:1 or more as a UI shape, and the lettering `--on-format` holds 4.5:1 on it. |
| `--fmt-doc` | `#3c6db4` | `#46679c` | `#82a6e0` | `#3c6db4` | `#82a6e0` | File icon fill for word-processor documents. Same rule. |
| `--fmt-sheet` | `#2b8657` | `#4c7c37` | `#74c095` | `#2b8657` | `#74c095` | File icon fill for spreadsheets. Same rule. |
| `--fmt-slides` | `#af6400` | `#a56005` | `#e6b25e` | `#af6400` | `#e6b25e` | File icon fill for presentations. Same rule. |
| `--fmt-text` | `#7d65b0` | `#7f5f96` | `#ac99d9` | `#7d65b0` | `#ac99d9` | File icon fill for text files. Same rule. |
| `--fmt-image` | `#b3567f` | `#a65870` | `#e39bbd` | `#b3567f` | `#e39bbd` | File icon fill for pictures. Same rule. |
| `--on-format` | `#ffffff` | `#ffffff` | `#16181b` | `#ffffff` | `#16181b` | Lettering on a format icon. 4.5:1 or more on every format fill. It is not white in the dark themes, where the fills are light. |

### Source code and JSON (`Text.module.css` reads these)
| Token | Paper (`light`) | Sand (`sepia`) | Ink (`dark`) | Plain light | Plain dark | Use and rule |
|---|---|---|---|---|---|---|
| `--code-keyword` | `#8f3f71` | `#8a3b5c` | `#e39ac3` | `#8f3f71` | `#e39ac3` | Keywords. 4.5:1 or more on the source background. |
| `--code-string` | `#2b6e2f` | `#4f6b1f` | `#9fd28e` | `#2b6e2f` | `#9fd28e` | Strings. Same. |
| `--code-number` | `#9a5b00` | `#9a4f12` | `#f0b968` | `#9a5b00` | `#f0b968` | Numbers. Same. |
| `--code-comment` | `#706e68` | `#716455` | `#93908a` | `#706e68` | `#93908a` | Comments. 4.5:1 or more on the source background (it was 2.83 to 4.04 in the light, sepia and dark themes before). |
| `--code-title` | `#1f5f8b` | `#2f5a7a` | `#8cc4ee` | `#1f5f8b` | `#8cc4ee` | Titles and function names. Same. |
| `--code-type` | `#6d4aa8` | `#6a4c8c` | `#c3a6f0` | `#6d4aa8` | `#c3a6f0` | Types. Same. |
| `--code-attr` | `#a4502e` | `#984929` | `#f0a07a` | `#a4502e` | `#f0a07a` | Attributes. Same. |
| `--code-meta` | `#5b5952` | `#6a5a47` | `#aaa69e` | `#5b5952` | `#aaa69e` | Meta and punctuation. Same. |
| `--code-add` | `#2b6e2f` | `#4f6b1f` | `#9fd28e` | `#2b6e2f` | `#9fd28e` | Added line in a diff. Same. |
| `--code-del` | `#b0312c` | `#b0312c` | `#f08a85` | `#b0312c` | `#f08a85` | Removed line in a diff. Same. |

The brand tokens only draw the logo. Do not use them for interface colour.

## Contrast rules

These are the rules the tokens meet. A new colour must meet the rule for the job it does. Ratios use WCAG relative luminance. The figures come from `audit/px/REPORT-ui-standards.md` (item 5.1) and are the minimum across the surfaces named.

| Job | Rule | WCAG |
|---|---|---|
| Text, on a surface | 4.5:1 | 1.4.3 |
| Boundary of a control, icon that carries meaning, focus ring | 3:1 against what is behind it | 1.4.11 |
| Decorative hairline between regions | none (`--line`, `--line-strong`) | |
| Dimming text | never with `opacity`; pick `--text-3` | 1.4.3 |

Minimum ratios after item 5.1, with the value before in brackets where it changed. "Surfaces" are bg, surface, surface-2, surface-3, canvas and accent-soft.

| Token | Paper | Sand | Ink | Plain light | Plain dark |
|---|---|---|---|---|---|
| `--danger` as text | 5.21 (3.72) | 5.28 (3.64) | 5.36 (4.84) | 5.22 (4.12) | 5.53 |
| `--success` as text | 4.52 (4.06) | 4.51 (3.97) | 5.55 | 4.83 | 6.34 |
| `--accent` as text | 4.56 (4.31) | 4.52 (4.01) | 5.85 | 4.78 | 6.68 |
| `--line-control` | 3.38 (1.23) | 3.30 (1.25) | 4.03 (1.20) | 3.07 (1.25) | 3.88 (1.21) |
| `--on-format` on every format fill | 4.52 (3.01) | 4.91 (3.49) | 6.74 (1.93) | 4.52 (3.01) | 6.74 (1.93) |
| `--code-comment` on the source background | 4.52 (3.18) | 4.51 (2.83) | 5.59 (4.04) | 5.10 (3.59) | 6.06 (5.37) |
| `--danger` at 10% over a surface, as a tint behind text | 4.51 (3.29) | 4.56 (3.23) | 4.51 (4.14) | 4.51 (3.62) | 4.69 |

The other `--code-*` colours are checked the same way; the report lists only the comment colour, because it was the worst one.

Other rules that go with the colours:

- Scrollbar thumbs use `--line-control`.
- A disabled or inactive element is shown with a real colour from the tables, not with `opacity`.
- Counts and the "unavailable" row on Home, and the inactive pane header, use `--text-3` at full strength.
- Source-code colours are defined per theme in `global.css`; `Text.module.css` no longer overrides them, so the plain themes inherit correct ones.

## Motion

Full spec: [MOTION.md](../MOTION.md).

| Token | Value | Use |
|---|---|---|
| `--t-instant` | 80ms | Bars and veil during a full-screen change; pressed feedback |
| `--t-fast` | 120ms | Hover, pressed, focus, colour changes, menus, desktop screens, every exit |
| `--t-med` | 180ms | Dialog, toast, phone screen enter, chrome hide and show, switch thumb |
| `--t-slow` | 240ms | Bottom sheet, wide dialog, previews, slide change |
| `--t-progress` | 320ms | Progress that follows real work (OCR sweep and track). Linear only |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | Standard, and every enter |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Every exit |

No UI transition is longer than `--t-slow`. Animate `transform` and `opacity` only (small colour changes at `--t-fast` are allowed). Script that needs a duration reads the token from the element and keeps the same number as its fallback.

## Radii, size and spacing

| Token | Phone | Desktop (`html.desktop`) | Use |
|---|---|---|---|
| `--r-s` | 8px | 5px | Small controls, chips |
| `--r-m` | 12px | 7px | Fields, buttons, rows |
| `--r-l` | 16px | 9px | Cards, menus |
| `--r-xl` | 22px | 12px | Dialogs, sheets |

Desktop radii are tighter on purpose: big radii read as a phone app on a desk. The "Use" column is the intended use; the CSS does not enforce it.

| Token | Phone | Desktop | Use |
|---|---|---|---|
| `--bar-h` | 56px | 44px | Height of a screen's top bar |
| `--icon-btn` | 44px | 36px | An icon button: a finger's width on a phone, a pointer's on a desk |
| `--content-max` | 720px | 720px | Reading column |
| `--win-controls` | 0px | 138px with `html.frame` | Room for the window buttons the app draws (Windows) |
| `--win-lights` | 0px | 76px with `html.lights` | Room for a Mac's three buttons; 0 in full screen |
| `--tab-strip` | 0px | the bar height when several documents are open | Height of the tab row |
| `--safe-top`, `--safe-bottom`, `--safe-left`, `--safe-right` | device | device | Safe-area insets; the Android shell fills `--native-inset-*` because many WebViews report none |

Type: `--font` is Manrope Variable with system fallbacks, `--mono` is the system monospace. Body text is 15px on a phone and 14px on desktop.

**What does not exist yet.** There is no spacing scale, no type-size scale and no `z-index` scale. The audit counted 37 font sizes and 20 distinct `z-index` values. Adding scales is "big move H" in `audit/px/PLAN.md`, left for a later pass. Until then, reuse a value that already exists nearby rather than adding another.

## Shadows

The owner's decision: **floating layers may lift with a shadow; nothing else may.** Floating layers are dialogs, menus, toasts and popovers: things that sit above the page and can be dismissed. Everything else separates by tone and hairline.

| Token | Value | Use |
|---|---|---|
| `--shadow-1` | `none` | Flat surface |
| `--shadow-2` | `0 0 0 1px var(--line)` | Hairline ring: pages, cards, previews |
| `--shadow-3` | `0 0 0 1px var(--line-strong)` | Stronger ring: the active tab |

There is no token for a floating layer's lift yet. Today the dialogs and menus in `src/ui/Overlay.module.css` write their own blur shadows (`0 16px 48px`, `0 24px 64px` and `0 8px 24px` over black at 18 to 22%). The rule allows those. A few small shadows on elements that are not floating layers (chips and handles in `Tools.module.css` and `Scan.module.css`) predate the rule; they have not been removed or audited.

The header comment in `global.css` still says "no gradients, blur or drop shadows". It describes the earlier rule and needs a one-line update to match the decision above.

## Forced colours

Under `@media (forced-colors: active)` (a Windows contrast theme) one block in `global.css` maps every colour token to a system colour: surfaces to `Canvas`, text to `CanvasText`, accent to `Highlight`, borders to `ButtonText`, disabled text to `GrayText`, and the format and code colours to `ButtonText` or `CanvasText`. Selected, pressed and current states get their own fill (`Highlight` with `HighlightText`) and a keyboard ring, because a selected state that was only a tint would vanish. Component stylesheets add their own forced-colors rules for pseudo-elements (switch tracks and thumbs, segmented controls, tab strip, welcome dots). A new component whose selected state is only a colour, or a ring made of `box-shadow`, needs a forced-colors rule too.
