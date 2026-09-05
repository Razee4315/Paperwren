# docs/14 audit — implementation progress

Working checklist for `docs/14-viewer-engineering-audit-glm-handoff.md`.
Baseline: `604b7ea1aaa496f1c151d6f3380cee1ffb105f6f` (v0.9.14).
Update this file at the end of every slice so work can resume without restarting.

Statuses: Not started / In progress / Implemented; verification pending / Verified / Blocked (reason).

## Current slice / next action

- Completed slice: 7 — all slices complete. Final report: `docs/14-implementation-report.md`.
- Next action: Android device verification of the pending items in the report's
  "Browser/device verification still pending" section (blocked on hardware availability
  in this environment; nothing further to implement in this pass).


## Slice 4 evidence (2026-09-05)

- Persistence v2 **Implemented; unit-verified**: FilePosition is now a versioned
  discriminated union (pdf/docx/sheet) in types.ts; cleanPosition validates v2 field-by-field
  (integer pageIndex, finite numbers, fractions clamped to 0..1, known kinds/modes/rotations)
  and still decodes the legacy union; RecentsContext.updatePosition REPLACES the payload
  instead of shallow-merging. 5 new tests cover v2 round-trip, sheet payloads, invalid
  rejection, clamping, and legacy decode.
- PDF-06 **Implemented**: v2 pdf snapshots written from committed refs (canonical anchor of
  the viewport-center point, mode mapped none->manual, actual scale, user rotation);
  restore applies mode/scale/rotation and re-positions through the SAME anchored-transaction
  finalizer used by zoom; legacy fallback = page top (saved zoom = manual mode) or ratio;
  writes suppressed until restore finished; pending writes flush on unmount and on
  visibilitychange-hidden (idempotent).
- DOC-02 **Implemented; browser-verified**: fit computed from the WIDEST rendered section
  (one document scale); manual zoom mode (buttons, 1.25 ladder, 0.1..4) with reading-point
  preservation through a pending-correction pre-paint realignment; refit only in fit mode;
  explicit fit-width re-resolves the honest fit on demand. e2e docx-lifecycle.spec.ts:
  narrow-page fixture fits at exactly 1.0000 and reaches ready (loading note gone at 100%);
  manual zoom 1.25 survives a 390px resize; fit-width then resolves 0.9421 = (390-32)/380.
- XLS-02 rest **Implemented**: per-sheet scroll/selection state saved live and restored in
  a layout effect after the new surface commits, synced from applied clamped offsets.
- SH-02 **Implemented**: idle autohide pauses while overlays are open, a load is running, or
  keyboard focus sits inside the chrome (chrome re-shows on hold); hidden bars become
  inert (removed from tab order); content tap-to-toggle is mouse-only; PDF touch taps own a
  validated single-tap toggle through the gesture controller (double-tap zoom cancels it);
  spreadsheet/DOCX touches never toggle chrome.
- SH-03 **Implemented**: safe-area bottom padding owned once by the shell (PDF ReaderStatus
  double-padding removed); bars get landscape left/right safe-area padding; viewers without
  a bottom bar reserve the raw inset via --viewer-bottom-reserve; xlsx cell details sheet
  registered with stable id xlsx-cell-details (system Back dismisses it); shared Sheet now
  traps Tab focus inside the panel and restores focus to the opener.
- Files: types.ts, recents.ts (+tests), RecentsContext.tsx, PdfViewer.tsx, DocxViewer.tsx,
  XlsxViewer.tsx, ViewerShell.tsx, Sheet.tsx, Home.tsx, make-viewer-fixtures.mjs,
  fixtures/viewer-regressions/narrow-fit.docx, tests/e2e/docx-lifecycle.spec.ts.
- Results: vitest 120/120, build OK, e2e 15/15.

## Slice 2 evidence (2026-09-05)

- PDF-01 **Implemented; browser-verified**: explicit zoom transaction (canonical page-local
  anchor captured pre-transform; preview transform origin = anchor; commit clears preview
  THEN measures final rects THEN applies anchored scroll in one pre-paint layout effect;
  no-op/clamped transactions finalize via txNonce). `overflow-anchor: none` on the scroller.
  e2e `pdf-zoom.spec.ts`: toolbar zoom in x2 and out x2 keeps the focal content point within
  2 CSS px of the viewport center; no residual transform after commit.
- PDF-02 **Implemented**: fit modes resolve honest per-page absolute scales; manual zoom is
  one absolute scale; conversion preserves exact starting scale (no rounding/clamping);
  manual floor = min(0.1, smallest fit scale) so sub-0.5 fits stay reachable; multiplicative
  1.25 step ladder; zoom buttons disable at actual bounds; status pill shows real percentage.
  Unit tests cover 1200pt page into 344px (fit 0.287 preserved), mixed sizes, bounds.
- PDF-03 **Implemented; unit-verified**: `documentGestures.ts` state machine
  (idle/pending/panning/pinching) with 13 unit tests: tap travel/duration, long-press breaks
  double-tap history, pinch-then-lift never taps, extra fingers ignored, pointercancel never
  taps and clears history, surviving finger becomes pan. PdfViewer wires it with
  `touch-action: none`, custom pan + inertia (exponential decay, bounds-aware), rAF-throttled
  pinch preview, Ctrl+wheel via native non-passive listener (e2e: wheel zoom anchored at
  cursor), double-tap zoom beats delayed single-tap chrome toggle (e2e with touch).
- PDF-04 **Implemented; browser-verified**: `useViewerViewport` measures usable area
  (client size minus effective paddings = real chrome insets); fit-page fits between bars;
  resize/metadata corrections capture the stable reading anchor (kept from scroll state)
  and re-anchor via the shared transaction finalizer; metadata publishes priority pages
  first (1 + restored + current) then batches of 12 with per-page failure fallback.
  Rotation e2e also covers resize-related re-anchoring paths.
- PDF-05 **Implemented; browser-verified**: metadata reads unrotated boxes
  (`getViewport({scale:1, rotation:0})`) + intrinsic `page.rotate`; total rotation =
  (intrinsic + user) % 360 used consistently by placeholder boxes, rasters, thumbnails;
  anchors are canonical unrotated ratios converted at finalize time; rotate keeps the
  reading point within 2px and swaps page box orientation (e2e).
- Files: pdfLayout.ts (+tests), documentGestures.ts (+tests), useViewerViewport.ts,
  PdfViewer.tsx, ViewerShell.tsx (toggleChrome, mouse-only content toggle), pdfAnchors.test.ts.
- Results: vitest 108/108, build OK, e2e 13/13 (incl. 4 new pdf-zoom specs).

## Slice 3 evidence (2026-09-05)

- PDF-07 **Implemented**: per-attempt load generations (StrictMode replay and
  close-while-loading destroy the pending loading task; stale resolved docs are destroyed,
  never published); each attempt parses its own COPY of the bytes so no attempt can hand a
  detached buffer to pdf.js; password retry prefers fresh bytes from the backend and falls
  back to the still-valid stored copy, surfacing a recoverable read error otherwise (never
  detached bytes); render registry entries carry {generation, task} and only the owning task
  deletes its entry; demand arriving while a cancelled task settles is re-enqueued in
  `finally`; render failures that are not cancellations show a per-page Retry overlay
  (`pdf-page-retry-N`) instead of a white page.
- PDF-08 **Implemented (partial)**: `computeOutputScale` now budgets from ROUNDED raster
  dimensions, removes the 0.25 floor that could exceed the 12M pixel cap, and adds an 8192px
  per-edge cap; aggregate raster byte accounting (w*h*4, peak tracked, reset per document);
  canvases release when pages exit the 600px margin; thumbnail renders go through a 2-slot
  semaphore, tiles outside the viewport release their raster and re-render on re-entry,
  tiles carry accessible page labels. Still open: device memory measurement (pending device).
- DOC-01 **Implemented**: explicit loading/ready/error status; ready only after current-
  generation render + section measurement; zero rendered sections = honest error state, not
  eternal loading; loading no longer inferred from fitZoom === 1.
- DOC-03 **Implemented**: each generation renders into its own staging container with
  renderer-owned styles (styleContainer = staging) and attaches only if still current;
  stale output discarded whole; debounce timer cleared and latest position flushed on
  unmount; remember_position gates save AND restore; `FilePositionLike` replaced by shared
  `FilePosition`; `window.__PAPERWREN_DOCX_FAIL__` removed; object-URL note documented
  (base64 in use; profiling before switching).
- XLS-05 **Implemented**: parsing moved to `src/lib/xlsxParseWorker.ts` +
  `src/lib/workbookModel.ts` (typed module receiving the SheetJS API directly;
  `window.__PAPERWREN_XLSX` removed); the buffer is transferred as a copy; the worker is
  terminated on close/change; bounded limits (400k populated cells, 200k merge expansion,
  5000 merges) with an actionable "too large" terminal state; empty workbooks get an
  honest terminal state; plain JSON payload rebuilt into a sparse Map on the UI thread.
- Files: PdfViewer.tsx, DocxViewer.tsx, XlsxViewer.tsx, workbookModel.ts (+tests,
  7 new), xlsxParseWorker.ts, pdfLayout.ts.
- Results: vitest 115/115, build OK, e2e 13/13; main bundle shed the xlsx parse
  (worker chunk `xlsxParseWorker-*.js` emitted).

## Slice 1 evidence (2026-09-05)

- XLS-01 **Implemented; browser-verified**: single two-axis scroller; sticky full-surface
  header (no JS transform), sticky left rail, sticky corner, shared column offsets,
  border-box cells. `tests/e2e/grid-alignment.spec.ts` measures real header/cell edges at
  scrollLeft 0/1/47/48/95/193/640 + far right + after a column resize: all within 1 CSS px.
  Test sensitivity proven by sabotaging header x with +7px (test failed), then reverting.
- XLS-02 (geometry half) **Implemented**: HEADER_HEIGHT/ROW_LABEL_WIDTH constants used
  everywhere; body-local visible-window math with sticky overlays subtracted
  (sheetLayout.ts); full-width borders via global border-box; sheet switch resets scroll
  offsets + window state in one transaction. Per-sheet persisted state = slice 4.
- SH-01 **Implemented; browser-verified**: `useViewportWidth` in ViewerShell (shared);
  PDF toolbar tiers: <384px shows Back/filename/Search/More; >=384 adds zoom; >=560 adds
  fit; zoom/fit always in tools sheet. `tests/e2e/narrow-toolbar.spec.ts` covers 320/412/800,
  long filename, no horizontal app overflow, tools-sheet zoom works.
- Files: sheetLayout.ts, sheetLayout.test.ts, XlsxViewer.tsx, ViewerShell.tsx, PdfViewer.tsx,
  playwright.config.ts, tests/e2e/{grid-alignment,narrow-toolbar}.spec.ts,
  scripts/make-viewer-fixtures.mjs, fixtures/viewer-regressions/*.
- Verification results: vitest 87/87; build OK; e2e 9/9 (grid alignment, narrow toolbar,
  smoke) after pinning webServer host + bypassing the npm wrapper (first-test
  ERR_CONNECTION_REFUSED flake). Test/run commands: `npm test`, `npm run build`,
  `npx playwright test` (needs `npm i --no-save @playwright/test` once).
- Lint: pre-existing failures reported separately at the end (patch-android-openwith.mjs,
  text.test.ts, ViewerScreen.tsx:103, ViewerShell.tsx:168, PdfViewer.tsx:547).

## Environment

- Commands: `npm test` (vitest run, jsdom), `npm run build` (tsc + vite), `npm run lint` (biome check).
- Browser harness: `tests/e2e` Playwright specs against `vite preview` (chromium 412x915).
  `@playwright/test` is installed `--no-save` (not a package.json dependency); browsers via
  `npx playwright install chromium`. Playwright was NOT installed in this checkout at start.
- Fixtures: `fixtures/` via `scripts/make-fixtures.mjs`. New viewer-regression fixtures go to
  `fixtures/viewer-regressions/` with a manifest.

## Slice 1 — XLS-01/02 + SH-01

| ID | Status | Files | Verification |
|---|---|---|---|
| XLS-01 | Not started | XlsxViewer.tsx, sheetLayout.ts | |
| XLS-02 (partial: border/header geometry) | Not started | XlsxViewer.tsx, sheetLayout.ts | |
| SH-01 | Not started | ViewerShell.tsx, PdfViewer.tsx | |

## Slice 2 — PDF core geometry

| ID | Status | Files | Verification |
|---|---|---|---|
| PDF-01 | Not started | PdfViewer.tsx, pdfLayout.ts | |
| PDF-02 | Not started | pdfLayout.ts, PdfViewer.tsx | |
| PDF-03 | Not started | PdfViewer.tsx | |
| PDF-04 | Not started | ViewerShell.tsx, PdfViewer.tsx | |
| PDF-05 | Not started | PdfViewer.tsx, pdfLayout.ts | |

## Slice 3 — async ownership

| ID | Status | Files | Verification |
|---|---|---|---|
| PDF-07 | Not started | PdfViewer.tsx | |
| PDF-08 | Not started | PdfViewer.tsx, pdfLayout.ts | |
| DOC-01 | Not started | DocxViewer.tsx | |
| DOC-03 | Not started | DocxViewer.tsx, ViewerScreen.tsx | |
| XLS-05 | Not started | XlsxViewer.tsx, worker module | |

## Slice 4 — persistence + shell

| ID | Status | Files | Verification |
|---|---|---|---|
| PDF-06 | Not started | PdfViewer.tsx, types.ts, recents.ts | |
| DOC-02 | Not started | DocxViewer.tsx | |
| XLS-02 (rest: per-sheet state) | Not started | XlsxViewer.tsx | |
| SH-02 | Not started | ViewerShell.tsx, viewers | |
| SH-03 | Not started | ViewerShell.tsx, viewers | |

## Slice 5 — spreadsheet meaning + cells

| ID | Status | Files | Verification |
|---|---|---|---|
| XLS-03 | Not started | XlsxViewer.tsx, worker | |
| XLS-04 | Not started | XlsxViewer.tsx, worker | |
| XLS-06 | Not started | XlsxViewer.tsx | |

## Slice 6 — reading tools

| ID | Status | Files | Verification |
|---|---|---|---|
| PDF-09 | Not started | PdfSearchSheet.tsx, PdfViewer.tsx | |
| DOC-04 | Not started | DocxViewer.tsx | |

## Slice 7 — final

- npm test / build / lint results: (pending)
- Device checks pending: all (no Android device in this environment; record explicitly)
