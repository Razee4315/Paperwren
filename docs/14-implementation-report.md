# docs/14 audit — implementation report

Implementation of `docs/14-viewer-engineering-audit-glm-handoff.md` against the current
Paperwren source (baseline `604b7ea1aaa496f1c151d6f3380cee1ffb105f6f`, v0.9.14).
Working notes per slice: `docs/14-implementation-progress.md`.

## Verification results (final)

| Command | Result |
|---|---|
| `npm test` | **130 tests in 13 files, all passing** (baseline: 84 in 11) |
| `npm run build` | passes (tsc + vite; xlsx parse now in a worker chunk) |
| `npm run lint` | 7 diagnostics, **all pre-existing** (baseline had 9; see below) |
| `npx playwright test` | **20 tests, all passing** (9 pre-existing harness specs + 11 new) |

Remaining lint diagnostics, verified pre-existing at the baseline via `git stash`
comparison: `scripts/patch-android-openwith.mjs` (3× useTemplate),
`src/lib/__tests__/text.test.ts` (useTemplate), `src/screens/viewer/ViewerScreen.tsx:103`
(useExhaustiveDependencies). No repo-wide autofix was run; `biome check --write` was
applied only to files this work created or touched.

## Finding status

| ID | Priority | Status | Evidence |
|---|---|---|---|
| PDF-01 | P0 | Implemented; browser-verified | Zoom transaction: canonical anchor captured pre-transform; preview transform origin = anchor; commit clears preview THEN measures final layout THEN applies anchored scroll, all in one pre-paint layout effect; no-op/clamped transactions finalize via `txNonce`; `overflow-anchor: none`. e2e: toolbar zoom in×2/out×2 keeps focal point within 2 CSS px of viewport center; no residual transform. |
| PDF-02 | P0 | Implemented; browser-verified | Fit modes resolve honest per-page absolute scales; manual = one absolute scale, exact conversion (no rounding/clamping); floor = min(0.1, smallest fit scale); multiplicative 1.25 ladder; bounds-disable buttons; pill shows real %. e2e: 1200pt-wide page converts fit→manual at 32% (old clamp would show 50%); unit tests for 344px/1200pt conversion. |
| PDF-03 | P0 | Implemented; unit-verified | `documentGestures.ts` state machine (idle/pending/panning/pinching), 13 unit tests: tap travel/duration, long-press breaks double-tap history, pinch-then-lift never taps, extra fingers ignored, pointercancel never taps, surviving finger becomes pan. Viewer uses `touch-action: none` + custom pan with inertia (exp decay, bounds-aware), rAF-throttled pinch preview, non-passive Ctrl+wheel, double-tap beats delayed chrome toggle (e2e). |
| PDF-04 | P1 | Implemented; browser-verified | `useViewerViewport` measures usable area between real chrome insets; fit-page fits between bars; resize/metadata re-anchor via the stable reading anchor through the shared finalizer; metadata publishes priority pages first (1 + restored + current), then batches of 12 with per-page fallback. Rotation e2e covers re-anchoring. |
| PDF-05 | P1 | Implemented; browser-verified | Metadata reads unrotated boxes (`getViewport({scale:1, rotation:0})`) + intrinsic `page.rotate`; total rotation = (intrinsic+user)%360 used by placeholders, rasters, thumbnails; anchors are canonical unrotated ratios converted at finalize. e2e: rotate keeps reading point within 2px, page box swaps, thumbnails match. |
| PDF-06 | P1 | Implemented; unit-verified | v2 pdf positions (canonical page point, viewport fractions, mode, actual scale, rotation) written from committed refs; restore applies mode/scale/rotation and re-positions through the same anchored finalizer; legacy fallback = page top (saved zoom = manual) or ratio; writes suppressed until restore finished; flush on unmount + background (idempotent). Persistence round-trips covered by recents tests. |
| PDF-07 | P1 | Implemented | Per-attempt load generations; StrictMode replay and close-while-loading destroy the pending loading task; stale resolved docs destroyed, never published; every attempt parses its own copy of the bytes (no detached-buffer reuse); password retry prefers fresh bytes, falls back to the still-valid stored copy, otherwise a recoverable read error; render registry `{generation, task}` with owner-only deletion; demand re-enqueued in `finally`; non-cancelled failures show a per-page Retry overlay. |
| PDF-08 | P1 | Implemented (device memory pending) | `computeOutputScale` budgets from rounded raster dims, no 0.25 floor, 8192px per-edge cap; aggregate raster byte accounting (w·h·4, peak, reset per doc); canvases release outside the 600px margin; thumbnails through a 2-slot semaphore with viewport retention + accessible labels; current-page tracking via prefix geometry + binary search (no per-page rect reads per scroll). |
| PDF-09 | P2 | Implemented; browser-verified | Search builds a normalized per-page index with a per-character map back to (item, offset) using hasEOL — no unconditional spaces; ALL matches counted, rendered list bounded at 200 with an explicit label; per-document cache with in-flight dedupe; image-only/errored pages disclosed; result click closes the sheet, scrolls to the ACTUAL match with a rotation-aware highlight overlay, and next/prev controls operate over the visible document; selectable text layer via pdf.js TextLayer (CSS-scoped) + read-only link annotations (internal dest → navigate, external → new tab, noopener); outline numeric destinations resolve directly. e2e: counts > 5, active highlight visible, next moves it, text layer selectable. |
| XLS-01 | P0 | Implemented; browser-verified | Single two-axis scroller; sticky full-surface header (no JS transform), sticky rail, sticky corner, shared offsets, border-box cells. e2e measures real header/cell edges at scrollLeft 0/1/47/48/95/193/640 + far right + after resize, within 1 CSS px; test sensitivity proven with a +7px sabotage. |
| XLS-02 | P1 | Implemented; browser-verified | HEADER_HEIGHT/ROW_LABEL_WIDTH constants everywhere; body-local window math with sticky overlays subtracted; full-width border-box grid lines; per-sheet scroll/selection state saved live and restored after the surface commits, synced from clamped offsets. |
| XLS-03 | P1 | Implemented; browser-verified | Merges retained as validated ranges (never per-coordinate); one anchor box per visible merge spanning the rectangle, interiors unmounted; hit-test/selection/copy resolve to the anchor; widths flow from the same offsets; merge whose anchor is offscreen still renders. e2e: merge box edges match covered column/row edges within 1px. |
| XLS-04 | P1 | Implemented (community-style limits documented) | Hidden rows/cols mapped out with origin arrays (rail shows original numbers, headers original letters); row heights via prefix sums (binary-search windowing); one width conversion (wpx → wch*7+5 → default); formatted cached values, distinct error codes (#DIV/0! etc.), formulas without cached results flagged "No cached result" instead of undefined; hidden sheets never the initial tab (labelled, italic); precise truncation notices; empty workbooks terminal; cell styles (fonts/fills/align) deliberately not invented (SheetJS Community has no style engine). |
| XLS-05 | P1 | Implemented | Parsing in `xlsxParseWorker.ts` + typed `workbookModel.ts` (no `window.__PAPERWREN_XLSX`); buffer transferred as a copy; worker terminated on close/change; bounds: 400k populated cells, 200k merge expansion, 5k merges; actionable too-large state; plain JSON payload rebuilt sparse. |
| XLS-06 | P1 | Implemented; browser-verified | Single tap selects and shows a cell strip (address + value + Details); Enter opens details, Escape closes; resize is one captured pointer session (cancel-safe, other fingers ignored) plus an accessible Column-width action; copy is awaited with snackbar feedback, details stay open on failure; `id="xlsx-cell-details"` registered for system Back; grid semantics with aria-rowcount/colcount/activedescendant, per-cell labels with original addresses; keyboard arrows move the selection with scroll-into-view; Home FAB no longer pokes through the viewer (z-order). |
| DOC-01 | P1 | Implemented; browser-verified | Explicit loading/ready/error; ready requires current-generation render + measurement; zero rendered sections = honest error; loading never inferred from fitZoom===1. e2e: 100%-fit document reaches ready (loading note gone at exactly 1.0000). |
| DOC-02 | P1 | Implemented; browser-verified | Fit from the WIDEST section; manual zoom (1.25 ladder, 0.1–4) preserved across resize; refit only in fit mode; reading point preserved via pending-correction pre-paint realignment; explicit fit-width re-resolves honestly. e2e: 1.25 survives a viewport change; fit-width then resolves (390−32)/380 = 0.9421. |
| DOC-03 | P1 | Implemented | Per-generation staging container with renderer-owned styles (styleContainer), stale output discarded whole; error callbacks guarded; debounce timer cleared and latest position flushed on unmount/background; remember-position gates save AND restore; shared `FilePosition` (FilePositionLike removed); `__PAPERWREN_DOCX_FAIL__` removed; base64 images documented (profiling before any switch). |
| DOC-04 | P2 | Implemented; browser-verified | Page indicator pill + jump sheet; search builds a text-node index, finds all matches (capped at 5000, disclosed), highlights via the CSS Custom Highlight API (non-destructive — no innerHTML rewriting), navigates the active match with next/prev over the visible document; selection/copy untouched. Heading outline deliberately not added: docx-preview does not emit reliable semantic headings. e2e: search + nav + pill. |
| SH-01 | P0 | Implemented; browser-verified | Tiers by measured viewport width: <384 shows Back/filename/Search/More; ≥384 adds zoom; ≥560 adds fit; zoom/fit always in the tools sheet. e2e at 320/412/800 with a long filename, no horizontal overflow, tools-sheet zoom works. |
| SH-02 | P1 | Implemented | Content tap-to-toggle is opt-in (PDF only; mouse via shell, touch via its gesture controller); spreadsheet/DOCX taps never toggle; idle autohide pauses while overlays are open, a load runs, or focus is inside the chrome (re-shows on hold); hidden bars become inert (out of tab order). |
| SH-03 | P1 | Implemented | Safe-area bottom padding owned once by the shell; landscape left/right insets on bars; `--viewer-bottom-reserve` for bar-less viewers; stable overlay IDs (incl. `xlsx-cell-details`); shared Sheet traps Tab focus and restores focus to the opener; Back with stacked sheets covered by existing smoke tests. |

## Browser/device verification still pending

Environment used: Chromium (headless shell 153) via Playwright at 320×700, 412×915, 800×900.
No Android device, emulator, or WebView was available in this environment, so the
following require device verification and are NOT claimed as passed:

- Real touch pinch-zoom (pointer streams with two simultaneous fingers), fling inertia feel,
  and `touch-action: none` interaction with TalkBack.
- `pointercancel` from native gesture interception (the state machine is unit-tested; the
  browser cannot reproduce Android's native arbitration).
- Software keyboard behavior during search sheets; clipboard failure paths (permission
  dialogs); safe-area insets with real cutouts in landscape.
- p95 frame-time targets (proposed, not measured — no device; no performance claim made).
- CSS Custom Highlight API behavior on the shipped WebView version (desktop Chromium
  verified; Android WebView requires confirmation; without it DOCX navigation still works,
  only visual highlighting is absent).
- CSS `zoom` on supported Android WebViews (retained as the DOCX scale mechanism, flagged
  by the audit for verification before keeping it).
- Peek memory/first-paint measurements on midrange hardware.

## Known renderer limitations / incomplete work

- PDF: character-level highlight rects approximate glyph advances within a text item
  (pdf.js reports item boxes, not per-glyph positions); visually accurate but not
  glyph-exact. Cross-item word spaces that exist only as positioning gaps (no space
  character, no EOL) are not matched by search.
- XLSX: SheetJS Community provides no cell-style engine — bold/italic/alignment/fills are
  a documented neutral fallback; charts/images/conditional formatting/freeze panes are not
  rendered; column widths clamp to 48–320px by design; supported range caps (1M rows, 500
  columns) are disclosed in a persistent notice rather than silently truncated.
- DOCX: fidelity is docx-preview's; no claim of Word pagination parity. Headings are not
  reliably extractable (no semantic heading elements), so there is no heading outline.
  `ignoreLastRenderedPageBreak: false` is unchanged pending a fidelity corpus comparison.
- DOCX pinch zoom is not implemented (buttons + fit only); adding custom gestures there
  should reuse `documentGestures.ts`.
- Sheet focus trap is a Tab-cycle, not a full roving-trap dialog implementation.
- PDF user rotation is session state; it is persisted (v2) but the toolbar offers only
  clockwise rotation.

## Files changed (implementations)

- `src/lib/pdfLayout.ts` — geometry model, canonical anchors, rotation math, raster budgets
- `src/lib/sheetLayout.ts` — body-local window math, variable row heights
- `src/lib/workbookModel.ts` — worker-owned parsing: merges, hidden rows/cols, heights,
  error codes, uncached formulas, limits
- `src/lib/xlsxParseWorker.ts` — parse worker
- `src/lib/types.ts`, `src/lib/recents.ts`, `src/state/RecentsContext.tsx` — v2 positions
- `src/screens/viewer/PdfViewer.tsx` — transactions, gestures, layers, persistence, loading
- `src/screens/viewer/documentGestures.ts` — gesture state machine
- `src/screens/viewer/useViewerViewport.ts` — usable-viewport contract
- `src/screens/viewer/PdfSearchSheet.tsx` — offset-mapped search
- `src/screens/viewer/DocxViewer.tsx` — lifecycle, fit/zoom, reading tools
- `src/screens/viewer/docxSearch.ts` — DOCX text index + non-destructive highlighting
- `src/screens/viewer/XlsxViewer.tsx` — grid geometry, merges, cell UX
- `src/screens/viewer/ViewerShell.tsx` — responsive chrome, SH-02/03 ownership
- `src/components/ui/Sheet.tsx` — focus trap
- `src/screens/Home.tsx` — position union consumption

## Tests added

- `src/lib/__tests__/pdfLayout.test.ts` (rewritten), `pdfAnchors.test.ts` (rewritten),
  `sheetLayout.test.ts` (extended), `workbookModel.test.ts` (new),
  `recents.test.ts` (v2 positions), `src/screens/viewer/documentGestures.test.ts` (new)
- `tests/e2e/grid-alignment.spec.ts`, `narrow-toolbar.spec.ts`, `pdf-zoom.spec.ts`,
  `docx-lifecycle.spec.ts`, `xlsx-merges.spec.ts`, `search-tools.spec.ts`
- Fixtures: `fixtures/viewer-regressions/` via `scripts/make-viewer-fixtures.mjs`
  (grid-align.xlsx, merges.xlsx, narrow-fit.docx, wide-fit.pdf + manifest)
- Runner note: `@playwright/test` is installed `--no-save` per the existing
  playwright.config.ts instructions; the webServer now runs vite directly with a pinned
  host to kill a first-test connection race.
