# Motion and interaction spec

Status: **in force** (implemented 2026-11-16 on `px/main`, items 6.1 to 6.5). The tokens, the exit mechanism, the delayed loader and the reduced-motion helper described here exist in the code. Section 7 lists what was done and what was deferred, with the reason. Where a table below says "Change", that is the rule new work follows; the few places the code does not yet follow it are named in section 7.

The app's look is flat and calm (`src/styles/global.css`, header). Motion follows the same idea: short, one-shot, and only where it explains what changed.

## 1. Tokens

Tokens live in `src/styles/global.css` (`:root`) and are listed with the rest of the design tokens in [docs/tokens.md](docs/tokens.md). Shared keyframes live in `src/styles/motion.css`.

### Duration

| Token | Value | Status | Use |
|---|---|---|---|
| `--t-instant` | 80 ms | added in 6.1 (was hard-coded in 3 places) | Bars and veil during a full-screen change; pressed feedback |
| `--t-fast` | 120 ms | exists | Hover, pressed, focus, colour changes, menus, desktop screens, every exit |
| `--t-med` | 180 ms | exists | Dialog, toast, phone screen enter, chrome hide/show, switch thumb |
| `--t-slow` | 240 ms | exists | Bottom sheet, wide dialog, scanner and tool previews, slide change |
| `--t-progress` | 320 ms | added in 6.1 (was hard-coded in 3 places) | Progress that follows real work (the OCR sweep and track). Linear only |

No UI transition is longer than 240 ms. Only progress indicators and busy loops may be longer.

### Easing

| Token | Value | Status | Use |
|---|---|---|---|
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | exists | Standard, and every enter |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | added in 6.1 | Every exit (starts at once, leaves quickly) |
| `linear` | keyword | exists | Spinners and progress that follows real work |

The old `--ease-out` token had the same value as `--ease`; it was a duplicate and was removed in 6.1. Use `--ease`. No springs: none of the current motion needs one, and a spring needs JavaScript per frame.

## 2. Rules

1. **Animate only `transform` and `opacity`.** Colour changes on small controls (`background-color`, `color`, `border-color`) are allowed at `--t-fast` because they repaint a small area. Layout properties (`width`, `height`, `top`, `left`, `margin`) are not animated. The exceptions that remain are listed in section 5.
2. **Screen-level entrances animate `transform` only, never `opacity`.** An opacity keyframe can freeze at 0 in Android WebView when the system picker pauses the page (`src/styles/motion.css`, header). Desktop screens may fade.
3. **Motion never blocks input.** No handler waits for an animation to end. A second action during an animation takes effect at once.
4. **Exits are faster than enters:** `--t-fast` with `--ease-exit`, whatever the enter used.
5. **Motion explains a change.** Where something came from, where it went, what is busy. No decorative or looping motion on an idle screen.
6. **Infinite animations are busy indicators only.** They animate `transform` or `opacity`, exist only while the work runs, and are removed from the DOM when it ends.
7. **Feedback within 100 ms.** Every press shows a pressed state at once. A wait that may pass 150 to 300 ms shows a loader only after a 200 ms delay (the `ScreenLoading` pattern in `src/ui/Misc.tsx`), in space that is already reserved, so fast loads do not flicker and nothing shifts.
8. **Reduced motion.** `prefers-reduced-motion: reduce` already cuts every CSS animation and transition to 1 ms (`src/styles/global.css:467`). The feedback stays (the state still changes); only the travel goes. JavaScript-driven motion must check the preference itself: smooth scrolling uses `behavior: "auto"`, and frame-interpolated motion jumps to its end state.
9. **Implementation.** CSS transitions and keyframes first. The Web Animations API where a value is only known at run time. No animation library.
   - **Exits** use `useExitPresence` (`src/lib/useExitPresence.ts`). When the element unmounts, the hook clones it and leaves the clone in place for `--t-fast`. The clone is `inert` and `aria-hidden`, has its ids and `data-testid` removed, and its descendants are taken out of the Tab order (also in browsers without `inert`). The real element is gone at once, so focus returns to the opener and input reaches the app immediately. The visual copy is removed on `animationend`, with a timeout as a fallback.
   - **Why a copy and not "keep the element until the animation ends".** Keeping the real element would keep its focus, its handlers and its place in the Tab order, and it would hold the app's `inert` state on for 120 ms. That is rule 3 broken: motion would block input. A copy cannot take focus or events.
   - The hook skips the copy when the page is hidden, when reduced motion is on, and when the element holds a `canvas` (`cloneNode` does not copy canvas pixels, so the copy would be blank).
   - **Loaders** use `useDelayed` (`src/lib/useDelayed.ts`): it turns `true` only after the wait has lasted 200 ms (default). Fast loads show nothing. The loader's space is reserved so it does not shift the layout when it appears (Folder list).
   - **Scripted scrolling** calls `scrollBehavior()` from `src/lib/motion.ts`, which returns `"auto"` under `prefers-reduced-motion: reduce` and `"smooth"` otherwise. Never write `behavior: "smooth"` directly.
10. **Tokens only.** No raw durations or easings in a CSS module or in TSX (the PDF module was converted in `d4be09c`). A JavaScript completion timer that must match a CSS duration keeps the same number as its default. Direct manipulation (dragging a sheet, a divider, a tab) follows the pointer with no transition.

## 3. Budget

Every animation must hold 60 fps (no frame gap over 20 ms) with the page's main thread throttled 6x. An animation that cannot is simplified or removed; it is not kept and excused. The baseline numbers and the result for each animation are recorded in `PERFORMANCE.md`.

## 4. Per-component table

The "Change" column is the rule. An empty cell means the current behaviour is the rule. The first four tables were written against commit `cb02348`; section 7 says which "Change" entries are not in the code yet.

### Shared kit (`src/ui`)

| Element | Trigger | Animation | Duration | Easing | Change |
|---|---|---|---|---|---|
| Button, IconButton | hover, press | background colour; scale on press (touch) | `--t-fast` | `--ease` | Desktop secondary, ghost and danger buttons get a pressed fill (no scale) |
| Switch | toggle | track colour; thumb slides (transform) | `--t-fast` / `--t-med` | `--ease` | Add hover and pressed states |
| Theme picker | select | ring (box-shadow) | `--t-fast` | `--ease` | Add hover and pressed states |
| Scrim | open | fade in | `--t-fast` | `--ease` | Exit: fade out, `--t-fast`, `--ease-exit` |
| Bottom sheet (touch) | open | slides up (transform) | `--t-slow` | `--ease` | Exit: slides down, `--t-fast`, `--ease-exit`. A short drag that is let go returns with a `--t-fast` transform instead of snapping |
| Menu (desktop) | open | fade in | `--t-fast` | `--ease` | Exit: fade out, `--t-fast`, `--ease-exit` |
| Dialog | open | rise 6 px and fade (phone); fade (desktop); pop 14 px (wide) | `--t-med` / `--t-fast` / `--t-slow` | `--ease` | Exit: fade out, `--t-fast`, `--ease-exit` |
| Toast | show | rise 6 px and fade | `--t-med` | `--ease` | Exit: fade out, `--t-fast`, `--ease-exit` |
| Drop hint | drag over | fade in | `--t-fast` | `--ease` | |
| Screen loader | 200 ms after a wait starts | slides in from the side | `--t-med` | `--ease` | |
| Page loader bar | while loading | bar slides (transform), infinite | 1.4 s | `--ease` | |
| Note field | focus | border and ring | `--t-fast` | `--ease` | |
| Window buttons (Windows) | hover | background and colour | `--t-fast` | `--ease` | Add a pressed state |
| Window buttons, tab strip, bars | full-screen change | fade | 120 ms, or 80 ms while bars are held | `--ease` | Use `--t-fast` and `--t-instant` |

### Screens

| Element | Trigger | Animation | Duration | Easing | Change |
|---|---|---|---|---|---|
| Viewer (phone) | open | rises 12 px (transform only) | `--t-med` | `--ease` | |
| Settings, Notes, Tools (phone) | open | slides 24 px from the side (transform only) | `--t-med` | `--ease` | |
| Any screen (desktop) | open | fade in (Notes: none) | `--t-fast` | `--ease` | Notes gets the same fade as the others |
| Read text screen | open | fade in | `--t-med` | `--ease` | |
| Onboarding scene and copy | step change | fade in | `--t-slow` | `--ease` | |
| Onboarding dots | step change | width and colour | `--t-med` | `--ease` | Layout property: see section 5 |
| Body background | theme change | background colour | `--t-med` | `--ease` | |

### Home, Settings, tab strip

| Element | Trigger | Animation | Duration | Easing | Change |
|---|---|---|---|---|---|
| Rows, chips, places, open button, FAB | hover, press | background colour, colour | `--t-fast` | `--ease` | Add a distinct pressed state where hover and pressed share one fill |
| Search field | focus | border colour | `--t-fast` | `--ease` | |
| Settings section link, action row | hover | background colour, colour | `--t-fast` | `--ease` | |
| Settings segmented choice | select | thumb slides (transform); colour | `--t-med` | `--ease` | |
| Theme carousel arrow | click | smooth scroll | browser | browser | Must honour reduced motion |
| Tab (while dragging) | neighbours make room | transform | `--t-fast` | `--ease` | |
| Tab | open, close | none | | | No change proposed: a recording decides whether the jump is noticeable |

### Viewer

| Element | Trigger | Animation | Duration | Easing | Change |
|---|---|---|---|---|---|
| Top and bottom bars (phone, docked) | hide, show | `margin-top` / `margin-bottom` and opacity | `--t-med` | `--ease` | Layout property: see section 5 |
| Top and bottom bars (floating, page full screen) | hide, show | transform and opacity | `--t-med` | `--ease` | |
| HUD, scrubber, present bar | appear / fade away | opacity | `--t-fast` in, `--t-slow` out | `--ease` | Deliberate slow fade-out of a hint; kept as the one exception to rule 4 |
| Scrubber knob | held | width and colour | `--t-fast` | `--ease` | Layout property: see section 5 |
| Zoom value | change | colour | `--t-fast` | `--ease` | |
| Zoom (keys, buttons) | step | transform, then settle | 170 ms | `--ease` | Use `--t-med` |
| Pinch / gesture settle | release | transform | 220 ms | `--ease` | Use `--t-slow` |
| Ctrl + wheel zoom | wheel | transform | 90 ms | ease-out | Use `--t-instant` and `--ease` |
| Page turn (paged documents), tap to turn | wheel, key, tap | smooth scroll | browser | browser | Must honour reduced motion |
| Turn arrows | pointer near edge | opacity, background colour | 160 ms / 120 ms | ease-out | Use `--t-fast` and `--ease` |
| Note, file-changed bar, speech bar, trail, scan offer | appear | fade in | `--t-med` or 160 ms | `--ease` or ease-out | Use `--t-med` and `--ease` throughout |
| Selection toolbar (float bar) | text selected | rise 6 px and fade | 120 ms | ease-out | Use `--t-fast` and `--ease` |
| Colour swatch | hover | transform | 120 ms | ease-out | Use `--t-fast` and `--ease` |
| Mark pulse | jump to a mark | `filter: drop-shadow` pulse | 1.2 s | ease-out | Replace the filter with an opacity pulse on an outline (rule 1, and the flat-design rule) |
| JSON branch arrow | expand | rotate | 120 ms | ease | Use `--t-fast` and `--ease` |
| Split divider | hover | background colour, `width`, `left` | `--t-fast` | `--ease` | Layout property: see section 5 |
| Split divider | drag | follows the pointer, one update per frame | | | |
| Slide (presenting) | next, previous | slides 48 px and fades | `--t-slow` | `--ease` | |
| Swipe settle (presenting) | release | transform | 180 ms | ease-out | Use `--t-med` and `--ease` |
| Auto-scroll | user turns it on | scroll position per frame | user's speed | | Must stop while its document is not on show |
| 3D model | drag release | orbit coasts to rest | damping | | |

### Tools, scanner, Read text

| Element | Trigger | Animation | Duration | Easing | Change |
|---|---|---|---|---|---|
| Tool buttons, presets, shapes, ink dots | hover, press, select | colours `--t-med`; press scale `--t-fast` | | `--ease` | |
| Tool card, featured card, scanner tile border, crop and scan handles | hover | border colour, background, handle radius | `--t-fast` | browser `ease` | Add `--ease` |
| "Ways" selector | select | highlight slides (transform) | `--t-slow` | `--ease` | |
| File item, photo preview, stamp preview | added | settles from 106% and fades | `--t-slow` | `--ease` | |
| Scanner page tile | added | scales from 92% | `--t-slow` | `--ease` | |
| Scanner editor, handles, pill | open | rise / scale (transform) | `--t-slow` / `--t-med` | `--ease` | |
| Scanner corners | edges found | corners glide to the page | 420 ms | cubic ease-out | Longest UI motion in the app. Proposed: `--t-slow` |
| Scanner "working" bar, sweep, spinner | while busy | transform, infinite | 1.1 s / 1.6 s / 0.8 s | `--ease` / linear | |
| Read text: sweep and beam | page progress | `height` and `top` | 320 ms | linear | Layout property: see section 5 |
| Read text: beam looking | while finding lines | `top`, infinite | 1.6 s | ease-in-out | Layout property: see section 5 |
| Read text: progress track | page progress | transform | 320 ms | linear | Use `--t-progress` |
| Read text: found line box | line recognised | background, scale, opacity; staggered 40 ms, capped 900 ms | 700 ms | ease-out | Proposed: `--t-slow`, opacity and scale only |
| Read text: text line | line recognised | rises 12 px | 260 ms | `--ease` | Use `--t-slow` |
| Read text: placeholder lines | while reading | background colour, infinite | 1.4 s | ease-in-out | Proposed: opacity instead of background colour |

## 5. Breaks of rule 1: what was changed

Each of these animated a layout property. Status after item 6.4 is in the last column.

| Where | Property | Fix | Status |
|---|---|---|---|
| `Shell.module.css:26`, `:214`, `:360` (phone reading bars, docked) | `margin-top`, `margin-bottom`, `margin-inline-end` | Translate the bars (transform) and keep the document's box fixed, as the floating bars already do. This changes what the reader sees: the page no longer slides with the bar | Deferred: needs a phone to judge (see section 7) |
| `ReadText.module.css:105`, `:118`, `:124` (OCR sweep and beam) | `height`, `top` | `transform: scaleY` on the swept area and `translateY` on the beam | Done (6.4): `scaleY` and `translateY` |
| `Pane.module.css:47` (split divider) | `width`, `left` | `transform: scaleX` on the grip | Done (6.4): `scaleX` on the grip |
| `Shell.module.css:806` (scrubber knob) | `width` | `transform: scaleX` | Done (6.4): `scaleX` |
| `Onboarding.module.css:159` (dots) | `width` | `transform: scaleX`, or leave: three small elements, shown once | Done (6.4): `scaleX` |
| `global.css:595` (mark pulse) | `filter` | Opacity pulse on an outline | Done (6.4): a separate SVG outline pulses its opacity |
| `ReadText.module.css:386` (placeholder lines) | `background` (infinite) | Opacity | Done (6.4): opacity |

## 6. Gaps this spec closed

| Gap | Where | Rule |
|---|---|---|
| No exit animation on sheet, menu, dialog, toast | `src/ui/Overlay.tsx:188`, `:498`, `:620` | 4, 9 |
| Sheet snaps back after a short drag | `src/ui/Overlay.tsx:219` | 3, 5 |
| Smooth scrolling ignores reduced motion | `paged.tsx:288`, `:320`; `hooks.ts:609`; `ReadText.tsx:297`, `:309`; `Settings.tsx:272` | 8 |
| Hard-coded durations and easings (about 25 declarations) | PdfView, Shell, TurnArrows, Text, ReadText, Scan, TabStrip, WindowControls modules; `hooks.ts`, `Present.tsx`, `ScanEditor.tsx` | 10 |
| Loader shown at once | `src/screens/home/FolderList.tsx:162` | 7 |
| Missing hover or pressed states | Switch, theme picker, desktop secondary buttons, window buttons, notes rows, several one-off controls (see the UX audit's state matrix) | 7 |
| Auto-scroll runs while its tab is hidden | `src/screens/viewer/ReadingControls.tsx:29` | 6 |

## 7. Implementation status (items 6.1 to 6.5)

Reports: `audit/px/REPORT-motion.md`. Commits are on `px/main`.

### Done

| Item | Commit | What |
|---|---|---|
| 6.1 tokens | `77e34a0`, `d4be09c` | `--t-instant`, `--t-progress` and `--ease-exit` added; duplicate easing removed; about 25 raw values moved to tokens, rounded (160 to 180, 260 to 240, 90 to 80 ms). PDF module converted separately |
| 6.2 reduced motion | `659c185` | `scrollBehavior()` used by all six scripted smooth-scroll sites (paged turns, tap-to-turn, OCR line sync, theme carousel). Settings section navigation already checked it |
| 6.3 exits | `c828a72`, `881e53a` | Menu, dialog and toast exit through `useExitPresence`. A short sheet drag now returns with a transform transition instead of snapping. Copies drop `data-testid` |
| 6.4 transforms | `bc0ae01` | OCR sweep and beam, split divider grip, scrubber knob, welcome dots on transform; placeholders and a separate mark outline on opacity; beam shadow and found-line background tween removed |
| 6.5 feedback | `2f2aeed` | Delayed non-modal status for notes and handoff jobs; folder loader after 200 ms with reserved space; invalid page drafts kept with a message; search shows loading, then results or "no match" guidance; hover and press gaps filled, hover rules gated by hover capability |

### Deferred, with the reason

| What | Why |
|---|---|
| **Sheet exit** (slide down and backdrop fade) | It failed the 6x budget. After simplifying it to opacity, a CDP trace still showed a 25.2 ms frame gap (limit 20 ms). Rule: an animation that cannot hold the budget is removed, not excused. Menu, dialog and toast exits shipped, but they have no complete 6x certification either; no blanket 60 fps claim is made |
| **Phone docked reading bars** (three `margin` transitions in `Shell.module.css`, including the wide-phone side rail) | Converting them changes what the reader sees (the page stops sliding with the bar). That cannot be judged without a phone |
| **Exit visual for dialogs that contain a canvas** | `cloneNode` does not copy canvas pixels. Their backdrop may still fade; the dialog itself leaves at once |
| Auto-scroll in a hidden tab | The baseline measured 0 frames and no scrolling in a hidden tab (finding P-13, refuted), so no code was changed |
| Scanner corner glide (420 ms) and animations outside the section 5 list | Left as they were; not in the item's scope |
| Native checks: Android Back with an exit in progress, focus return in a real WebView, physical hover and press in each real flow | Not available here; confirm in the release and phone builds (see `BEHAVIOR_NOTES.md`) |

### Budget evidence

A warmed OCR progress sample at 6x recorded 25 frame gaps, the largest 16.8 ms, none over 20 ms. This is one small sample. The 60 fps rule at 6x is **not** verified for every animation; the unsampled ones are listed as unverified, not as passed.
