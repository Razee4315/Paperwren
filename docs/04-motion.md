# 04 · Motion & Animation

> Motion in Paperwren is like good penmanship: quick, confident, and never showing off. Everything answers within 100 ms; nothing blocks input longer than 300 ms.

---

## 1. Motion principles

1. **Fast first.** Motion decorates state changes; it never delays them. Perceived speed beats beauty if they ever conflict.
2. **Paper physics.** Elements slide and settle like light card stock — short travels, gentle deceleration, no cartoonish squash-and-stretch.
3. **Continuity.** A file card *becomes* the viewer; sheets rise from where they'll live. The user should never wonder where something came from.
4. **Calm by default.** Idle animations exist only in illustrations; chrome never pulses, wiggles, or begs.
5. **Respect the system.** Android's "Remove animations" setting is honored globally (§7).

## 2. Motion tokens

### Durations

| Token | ms | Usage |
|-------|----|-------|
| `dur-instant` | 100 | Press feedback, ripples, chrome hover/tap tint |
| `dur-fast` | 180 | Chrome show/hide, checkbox/toggle, snackbar |
| `dur-standard` | 240 | Sheets, dialogs, page transitions, FAB |
| `dur-expressive` | 340 | Container transform (file→viewer), onboarding slides |
| `dur-settle` | 480 | Cold-start unfold; long slides only |

### Easing curves

| Token | Curve | Feel / usage |
|-------|-------|--------------|
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default — smooth in, smooth out |
| `ease-enter` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Fast start, soft landing — things arriving on screen |
| `ease-exit` | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Quick confident leave |
| `spring-paper` | spring, stiffness 320, damping 0.88 (≈4% overshoot) | Scrubber thumb, double-tap zoom, FAB morph |

Rules: one easing per transition (no chaining); transforms & opacity only in the WebView — animating layout properties is a bug.

## 3. Transition catalog

### 3.1 Cold start — "The Unfold"
The launcher mark's top sheet rotates from −12° to 0° while the wordmark fades up 8 dp — total ≤ 480 ms, then straight to content (or onboarding, first run only). If the app opens into a file (via "open with"), **skip the brand animation entirely** — the file is the star.

### 3.2 File → Viewer — container transform ★ (the hero transition)
The tapped file card expands its bounds to full screen (`dur-expressive`, `ease-enter`); the format badge crosses-fades into the viewer toolbar icon; card text fades out at 40%; viewer content fades in at 70% of the way. Reverse plays on back (system back gesture and toolbar back **both** reverse it). This one transition makes the app feel expensive.

### 3.3 Chrome show/hide (viewer)
Tap center → top toolbar and bottom scrubber slide in (toolbar from −100%, scrubber from +100%, `dur-fast`, `ease-enter`, scrim 20%). Second tap reverses with `ease-exit`. Auto-hide after 2.5 s of no interaction *only while reading* (not while a sheet/dialog is open).

### 3.4 Sheets & dialogs
Bottom sheets translate up from parent edge (`dur-standard`, `ease-enter`) with scrim fade 0→40%. Drag-to-dismiss follows the finger 1:1, then either settles back (spring-paper) or flies out with `ease-exit` if past 96 dp / 25% velocity.

### 3.5 Onboarding
Slides crossfade with 16 dp upward drift + **parallax**: illustration moves at 0.6× the page-indicator speed (`dur-expressive`). Dots fill in ember; active dot stretches into a 16 dp pill.

### 3.6 Tab & mode switches
Viewer modes (thumbnails/outline) crossfade 140 ms with 6 dp horizontal drift. Settings subpages slide in from the right 12 dp + fade (dur-fast).

### 3.7 Pull-to-refresh — "The Curl"
Recents list: overscroll drags a folded-corner sheet shape down 0→56 dp (resistance 0.4 after 24 dp). Release triggers the sheet "uncurling" while the ink-underline progress runs. (Storage browser, v1.1.)

### 3.8 Page navigation (PDF)
Continuous vertical scroll (native feel). In fit-page mode, horizontal swipe pages with a 24 dp parallax offset between outgoing/incoming pages — **no page-curl effect** (gimmick tax: slow, battery-hungry, reads as unserious).

### 3.9 Zoom
Double-tap: scale from current to target with `spring-paper` (240 ms), anchored at tap point. Pinch: 1:1 with fingers, clamps 25%–500%, rubber-band 8% past limits.

## 4. Micro-interactions

| Control | Response |
|---------|----------|
| Any pressable | Scale 0.97 + `surface-3` tint, `dur-instant`; restore on release |
| FAB tap | Icon cross-fades to progress ring; after open, morphs back (spring-paper) |
| Pin a recent | Pin glyph pops 1.0→1.15→1.0 (spring-paper) + light haptic tick |
| Toggle | Thumb slides `dur-fast`; track fills ember; haptic tick on |
| Scrub pages | Thumb grows 20→24 dp; live page bubble follows; haptic tick every 5 pages |
| Copy text | Selection handles fade; snackbar "Copied" + tick |
| Clear recents | Rows slide left + collapse 48→0 dp, staggered 30 ms; snackbar with Undo |
| Search hits | Matches highlight with ember underline that draws in (ink-underline easing) |
| Toggle chrome / theme | Crossfade `dur-fast` — never a hard flash |
| Pull farther than refresh | Rubber-band + the folded-corner sheet tilts 3°, hinting the gesture |

## 5. Progress philosophy — "Ink underline" ★

**No spinners.** Any wait longer than 300 ms shows a 3 dp ember bar drawing left→right under the toolbar (determinate when the format parser reports progress — PDF pages, sheet index; indeterminate as a slow draw loop otherwise). Skeletons (doc 02 §6) for list/grid content. The wait state should feel like someone writing, not a machine spinning.

## 6. Haptics

| Event | Haptic |
|-------|--------|
| Toggle on/off, pin, copy | Light tick |
| Page-settle in fit-page swipe | Very light tick |
| Scrubber crossing page marks | Light tick |
| Errors (dialog appears) | None — errors don't buzz |
| Scrolling, typing | None |

All haptics respect the system haptics setting; intensity set at the lightest standard level.

## 7. Reduced motion (mandatory)

When Android "Remove animations" is on (or `prefers-reduced-motion`):
- All translations/scales/springs → 100 ms opacity crossfades.
- Container transform → simple fade.
- Illustration idle loops → static first frame.
- Content still appears **instantly** — reduced motion never means slower app.

## 8. Performance rules

- 60 fps floor on the reference low-end device; if a transition can't hold it, simplify the transition, not the framerate.
- Animate only `transform`/`opacity` in the WebView; `will-change` applied only during the animation, then removed.
- Viewer chrome animations are pure compositor work — PDF rendering continues untouched during chrome motion.
- No JS-driven per-frame animation loops except the ink-underline (CSS-driven) and skeleton shimmer (CSS).

---

*Next: [05 · Screen Inventory & Navigation](05-screens.md) — every screen, counted and mapped.*
