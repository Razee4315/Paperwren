# Paperwren viewer engineering audit — implementation handoff for GLM

Audit date: 2026-09-05  
Baseline commit: `604b7ea1aaa496f1c151d6f3380cee1ffb105f6f`  
Package version: `0.9.14`  
Scope: PDF, XLSX/CSV, DOCX, and the shared viewer behavior that affects them.  
Method: source inspection and existing build/unit checks only. No app interaction, screenshots, competitor testing, or on-device reproduction was performed for this audit.

## 1. Instructions to the implementing agent

Act as the implementation engineer following this brief. Fix the root causes and add evidence for the behavior. Do not treat comments saying “audit fixed” as proof that an implementation works. Several current comments describe behavior the code does not actually deliver.

The user reports PDF zoom followed by a page readjustment and spreadsheet column letters that do not follow the cells. Both reports have strong corresponding defects in the current source. The exact frequency and appearance on Android still require device verification.

Read this document completely, inspect the referenced functions at the current revision, and execute the dependency order in section 10. Line numbers refer to the baseline above; locate symbols if they move. This document supersedes the viewer implementation directions in `docs/13-deep-ux-audit-and-remediation-plan.md` where they differ. Keep that earlier audit as historical context.

Preserve the product's offline, local-file, read-only purpose. The Adobe/Microsoft quality target here means dependable reading, fluid navigation, accurate geometry, usable search, accessible controls, and honest rendering limitations. It is an acceptance bar proposed for Paperwren, not a claim of current feature parity or an instruction to build a full Office editor. Cloud conversion, editing, OCR, signatures, and new paid engines are separate product work.

Do not rewrite all viewers in one patch. Do not change branding, the dashboard, native file ingestion, or release workflows to solve these viewer bugs. The audit starts with an unrelated untracked `scripts/debug-line.mjs`; preserve it. Do not push merely to share progress: the repository README describes a push-triggered release pipeline.

For every implementation slice, provide the finding IDs addressed, files changed, tests run, measured results, and any device checks still pending. Never label a manual check passed because a helper unit test passes.

## 2. Baseline and evidence levels

The existing `npm run build` passes. `npm test` passes all **84 tests in 11 files**. Existing PDF anchor tests use supplied rectangles; spreadsheet tests cover prefix offsets and visible ranges. They do not exercise CSS layout, transformed DOM measurement, Android gesture arbitration, or a rendered header and cell together. Green tests currently coexist with the reported bugs.

Evidence labels used below:

- **Confirmed source defect:** directly follows from the implementation. The mobile manifestation may still need reproduction.
- **Runtime risk:** source provides a credible failure path, but browser/device behavior or resource limits must be measured.
- **Capability gap:** deliberately missing functionality required for the proposed reading quality bar.

Primary inspected files: `PdfViewer.tsx`, `PdfSearchSheet.tsx`, `pdfTypes.ts`, `XlsxViewer.tsx`, `DocxViewer.tsx`, `ViewerShell.tsx`, `ViewerScreen.tsx`, `pdfLayout.ts`, `sheetLayout.ts`, `types.ts`, `recents.ts`, `RecentsContext.tsx`, `Sheet.tsx`, `IconButton.tsx`, the current helper tests, global CSS, and the installed renderer declarations/source where needed.

### Priority map

P0 means fix before presenting this as a dependable reader. P1 follows in the stabilization work. P2 is the next reading-quality increment, not permission to defer a correctness issue indefinitely.

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| PDF-01 | P0 | Pinch commit measures the still-transformed page | Confirmed source defect |
| PDF-02 | P0 | Zoom base uses page 1 and clamps away actual fit scale | Confirmed source defect |
| PDF-03 | P0 | Cancel/drag/pinch completion can become taps; pointer ownership ambiguous | Defect plus runtime risk |
| PDF-04 | P1 | Fit-page includes toolbar-covered height; resize/metadata lack anchors | Confirmed source defect |
| PDF-05 | P1 | Intrinsic PDF rotation and raster rotation disagree | Confirmed source defect |
| PDF-06 | P1 | Restore loses within-page location and misinterprets manual zoom | Confirmed source defect |
| PDF-07 | P1 | Loading tasks and async raster ownership are incomplete | Defect plus runtime risk |
| PDF-08 | P1 | Render failures are silent; memory limits are incomplete | Defect plus runtime risk |
| PDF-09 | P2 | Search omits matches; text/link layers absent | Defect plus capability gap |
| XLS-01 | P0 | Column headers have two horizontal displacement owners | Confirmed source defect |
| XLS-02 | P1 | Row headers, border geometry, and sheet switching lack one contract | Confirmed source defect |
| XLS-03 | P1 | Merges discard covered cells without rendering merged geometry | Confirmed source defect |
| XLS-04 | P1 | Sheet metadata, styles, cached values and limits lose fidelity | Defect plus capability gap |
| XLS-05 | P1 | Main-thread parsing and merge expansion can block the app | Runtime risk with explicit unbounded loop |
| XLS-06 | P1 | Cell details/copy/resize/Back interaction is incomplete | Confirmed source defect |
| DOC-01 | P1 | Loading and restore depend on incidental zoom rerenders | Confirmed source defect |
| DOC-02 | P1 | First-section fit, refits, and absent manual zoom limit reading | Defect plus capability gap |
| DOC-03 | P1 | Async DOM ownership and position persistence lack cleanup | Confirmed source defect |
| DOC-04 | P2 | No search/navigation and unverified complex-layout fidelity | Capability gap |
| SH-01 | P0 | PDF toolbar does not fit narrow phones | Confirmed sizing conflict |
| SH-02 | P1 | Cell/document taps hide chrome despite autohide being disabled | Confirmed source defect |
| SH-03 | P1 | Safe areas, focus, and position schema need shared ownership | Defect plus integration work |

## 3. PDF: exact remediation

### PDF-01 — Commit pinch zoom in one untransformed coordinate system

**Evidence:** `PdfViewer.tsx`, `onPointerMove`, `onPointerUp`, `captureAnchor`, and the layout effect around lines 515–571 and 733–855. Preview applies `pages.style.transform = scale(...)`. On lift, `captureAnchor` reads transformed client rectangles. React then updates page dimensions, but the layout effect reads `node.getBoundingClientRect()` with the old preview transform still applied. Only after calculating and assigning scroll does it clear the transform at line 570.

**Why:** the final layout is measured with an extra scale. The scroll correction targets a position in that transformed layout; removing the transform changes it again. Capturing a ratio from a consistently transformed rectangle is not inherently wrong. The critical error is using a still-transformed final rectangle and transformed overflow bounds to commit the new scroll.

**Implementation contract:**

1. Introduce an explicit zoom transaction containing a page anchor, actual starting scale, requested final scale, target client point, and a monotonically increasing transaction ID.
2. Capture the page-local point at pinch start, before preview transforms. Use that same content point throughout the gesture. Update its target client point to the current finger midpoint so two-finger translation is respected.
3. Preview scale and translation together from the gesture's starting geometry. At preview scale `k`, local point `p`, initial content origin `o`, and desired client point `m`, choose translation so `o + translation + k*p = m`. Convert through the scroller's coordinate system explicitly; do not mix document/client offsets.
4. On commit, store the final transaction and update the layout scale. In a pre-paint layout effect, **clear preview transform and transform-origin before measuring final rectangles and scroll bounds**, then solve the anchored scroll, clamp it, and finish the transaction. Removal, measurement, and correction must occur before paint.
5. A no-op/clamped scale still needs transaction cleanup. Use a transaction revision/state change so the finalizer runs even if `setZoom` receives the same number. Never depend solely on a changed zoom value to clear a transform.
6. Missing page, cancellation, lost capture, document change, and unmount must also clear preview and pending anchor state. A cancelled transaction should roll back to its committed geometry without generating a tap.
7. Disable browser scroll anchoring on the managed PDF scroll/content region with `overflow-anchor: none`, and own preservation explicitly. Keep the existing max-content positive-overflow layout; do not reintroduce centered negative overflow.

**Acceptance:** on page 8 at a mid-page paragraph, pinch from fit to 2x and back with both stationary and moving midpoints. For an anchor not blocked by scroll boundaries, drift after commit is at most **2 CSS px** in either axis. Both page edges remain reachable. Repeat at minimum/maximum zoom and with a pinch that has zero distance change. No transform or pending transaction remains after completion or cancellation. Raster replacement must not change page geometry.

### PDF-02 — Separate fit mode from actual scale

**Evidence:** `effectiveZoom()` at 575–586 always reads `pageSizes[0]`, calls `clampZoom`, and is used for buttons, wheel, and pinch. `pdfLayout.ts:14–15,37–38,65` uses the same 0.5–4 range for multiplier and absolute manual scale. Fit layout is computed independently for each page.

**Why:** a narrow phone can display a wide PDF below 0.5 actual scale. Entering manual zoom clamps that starting scale to 0.5. A gesture with almost no movement can enlarge it abruptly. On a mixed-size document, conversion based on page 1 changes the currently viewed page by an unrelated amount.

**Do:**

- Replace duplicated base calculations with one geometry model returning each page's actual display scale. Resolve the current anchor page, not always page 1, when leaving fit mode.
- Represent `fitWidth`, `fitPage`, and `manual(scale)` explicitly. Fit modes should not carry a hidden stale multiplier. Explicit fit commands always resolve an honest fit.
- Preserve exact actual starting scale; do not round to two decimals or clamp while reading current geometry. Round only displayed percentage. Clamp the requested manual result using a range that includes the document's fit scale. Define a named minimum policy rather than silently forcing all documents to 50%.
- A practical default is a minimum no greater than the current document's smallest fit scale and 0.1, with the existing maximum of 4 retained for this stabilization slice. Validate positive finite geometry. Larger zoom limits belong with the raster budget work.
- For toolbar steps use a documented scale ladder or multiplicative step, anchored at the unobscured reading-area center. Disable a control at its actual bound.
- Preserve the visible anchor page when switching from independent per-page fitting to one absolute manual scale; other page boxes can legitimately resize differently.
- Retain the current 1 CSS px per PDF point convention for now, but avoid calling it physically accurate size. The 760px desktop fit-width cap is a product choice; label it as a comfortable fit or remove the cap if the action is meant to fill the entire width.

**Tests:** mixed portrait/landscape pages where page 1 is offscreen; a 1200-point-wide page fitted into 344 CSS px; manual-to-fit-to-manual; a zero-motion pinch; repeated zoom-out below the original 0.5 threshold. Converting fit to manual with scale factor 1 must preserve the selected page's displayed width within rounding tolerance.

### PDF-03 — Give gestures a state machine

**Evidence:** pointer cancellation uses `onPointerUp`; tap detection compares two release locations but never checks down-to-up movement or duration. The second finger released after a completed pinch can become a tap. `lastMidpoint` is not reset at pinch start. `touch-action: pan-x pan-y` permits native pan ownership, while every pointer is captured for custom gestures. Wheel cancellation relies on React's event handler.

**Do:** model `idle`, `tapCandidate`, `panning`, `pinching`, and `settling` explicitly. Track pointer ID/type, down coordinates/time, maximum travel, and whether this entire contact sequence ever pinched. A tap requires a short duration, small down-to-up travel, and no cancellation/pinch. Cancel invalidates tap history. Ignore extra pointers or restart deliberately; never reuse a prior pinch midpoint.

Choose one gesture ownership policy and prove it on Android. For a deterministic first implementation, custom document gestures may use `touch-action: none` on the PDF reading surface with explicit single-finger pan, two-finger pan/zoom, and velocity-based fling. Keep controls/overlays outside that surface and preserve wheel, keyboard, and scrollbar navigation. This requires implementing pan inertia and bounds; a bare `touch-action: none` patch is incomplete. If retaining native panning instead, first provide device evidence that the chosen pinch mechanism survives native `pointercancel`; changing touch-action after the gesture starts is not a solution.

Use a native non-passive wheel listener on the scroller for Ctrl+wheel if cancellation is required, with cleanup. Read latest scale through a ref/reducer to avoid stale rapid-event state. Ordinary wheel scroll must remain normal. Coordinate delayed single-tap chrome toggling with double-tap zoom so the first tap does not hide controls during the double-tap sequence.

**Acceptance:** short pan ending near the previous release does not zoom; long press does not count as double-tap; pinch then second finger lift does not create tap history; pointercancel/lost capture clears state; single-finger fling feels continuous; Ctrl+wheel affects only document zoom. These require real browser/device tests, not jsdom alone.

### PDF-04 — Treat every geometry change as a layout transaction

**Evidence:** viewport measurement subtracts only 16px from full scroller height (around 291–301), although top and bottom bars cover part of it. `pageBoxes` uses that height for fit-page. Resize and `setPageSizes` change geometry without capturing a fresh anchor. Metadata publishes page 1 and then the final complete array; an intervening page failure can leave later pages on fallback sizes.

**Do:** expose measured top/bottom insets to viewer geometry through a small shared viewport hook/context. Define `usableHeight = clientHeight - topInset - bottomInset - verticalGaps`, using one padding convention. Recompute on toolbar/bottom-bar size changes as well as container resize. Keep inset reservation stable during chrome hide animation to avoid content breathing.

Preserve a page-local anchor before resize, orientation, rotation, and metadata corrections. Keep the last stable anchor from scroll/layout state so a ResizeObserver callback does not pretend it captured pre-resize DOM after resize already occurred. Publish metadata in bounded batches with per-page failure handling; fetch restored/visible page geometry early. Correct placeholders without moving the current reading point. Do not wait for every page before showing page 1.

**Acceptance:** fit-page really fits between visible bars on a 360x800 and short landscape viewport. Rotate the device while reading a paragraph and remain at that paragraph. Delay mixed-page metadata deliberately; resolving earlier page sizes does not jump the reader.

### PDF-05 — Respect intrinsic rotation everywhere

**Evidence:** metadata calls `page.getViewport({scale: 1})`, which uses intrinsic rotation. Raster rendering passes `rotation` explicitly, starting at zero. Installed PDF.js source defaults omitted rotation to `this.rotate`. Thus a PDF with intrinsic `/Rotate 90` can have rotated placeholder dimensions and an unrotated raster. Thumbnail rendering omits the user rotation entirely. The Rotate tool changes state without capturing an anchor.

**Do:** use `totalRotation = ((page.rotate + userRotation) % 360 + 360) % 360` consistently for page viewport/raster/text/annotation layers and thumbnails. Derive dimensions from that viewport or an equivalent proven geometry function. Store anchors in canonical PDF coordinates and convert with the old/new viewport when rotating; normalized x/y without rotation conversion does not preserve the same text point. Capture before rotating and make thumbnail aspect ratio follow the resulting viewport.

**Acceptance:** intrinsic 0/90/180/270 fixtures plus four user rotations each. No stretching; raster, placeholder, thumbnail, text highlight, and link target agree. Four rotations restore the starting view within rounding/bounds tolerance.

### PDF-06 — Persist what the reader actually sees

**Evidence:** 588–637 saves only page, optional zoom, and document scroll ratio. Restore prioritizes page top whenever page exists, losing within-page position. A saved manual zoom is restored as a multiplier of the settings fit mode. `onScroll` schedules persistence from a callback closing over the previous `currentPage`; zoom handlers also schedule before the new state commits. Cleanup discards a pending final write.

**Do:** implement the versioned position model in section 8. Persist mode, actual manual scale when relevant, user rotation, and a canonical page point plus viewport target fractions. Snapshot after committed scroll/layout through latest-state refs, never a stale event closure. Suppress writes until restoration finishes. Flush once on explicit close and when backgrounding; clear timers on unmount. Define idempotent flush behavior so navigation does not double-write old state.

Restore only once required target-page geometry and viewport insets are ready. Legacy positions get a documented fallback: page top if only page is reliable, ratio if no page exists; a legacy saved zoom represents manual mode. When remember-position is off, neither restore nor save any viewer position.

**Acceptance:** reopen halfway down a zoomed page with horizontal pan and rotation; close within 100ms of a final scroll; change viewport width before reopening; disable remember-position. Each case must match the documented policy.

### PDF-07 / PDF-08 — Own async work, render state, and memory

**Evidence:** `load()` around 304–361 does not retain/destroy its loading task or guard stale completion. `src/main.tsx` enables StrictMode, so effect replay can attempt the same transferred buffer twice. Cleanup only sees resolved `doc`. Password retries can fall back to detached `dataRef.current`. Rendering around 413–511 uses a cross-effect map keyed only by page number. Old completion can delete a newer task's map entry. All raster errors are swallowed. Every scroll reads every page rect at 647–659. Thumbnail rendering disconnects its observer after first entry and retains visited canvases until the sheet unmounts.

**Do, in this order:**

1. Introduce per-document load generation and task ownership. Check generation before creating a task after dynamic import and after every awaited completion. Destroy pending tasks on cleanup; destroy stale resolved documents. Handle both StrictMode replay and real close-while-loading. Do not solve this by disabling StrictMode.
2. Make byte ownership explicit. A new loading attempt must receive a valid fresh buffer or reuse the current loading task's supported password callback. Prefer PDF.js's password callback to repeatedly rereading the file. If fresh-byte retry remains, a failed reread must surface a recoverable read error; never fall back to detached bytes. Clear password state on success/cancel.
3. Keep render task registries local to a generation or store `{generation, task}` and delete only if the stored task is the same task completing. Cancel old work and reject stale canvas publication.
4. Track per-page `queued/rendering/ready/error` states. Cancellation is normal; real errors show a lightweight page-specific Retry action. A visible failed page must not remain white waiting for a new IntersectionObserver transition.
5. If a page exits and re-enters while its cancelled task settles, retain pending demand and enqueue again in `finally`. Current `inflight` checks can consume the re-entry without a later retry.
6. Keep the last completed canvas displayed during zoom while a new canvas renders, within a budget. Replace only raster children, not the whole page element once text/link layers are introduced. Release offscreen canvases explicitly and ensure detached failed canvases are not retained.
7. Fix `computeOutputScale`: its 0.25 lower floor can violate the advertised 12M pixel cap for very large CSS pages. Budget using actual rounded raster dimensions, cap individual width/height as well as total pixels, and permit a lower output scale or tiles. The dimension cap must be conservative and verified on supported WebViews.
8. Add an aggregate raster budget including visible pages, neighbors, thumbnails, and old/new canvases during replacement. Two concurrent render tasks do not cap retained memory. Use byte estimates such as width*height*4 for accounting, explicitly recognizing engine/GPU memory is additional.
9. Use visible candidate pages and prefix geometry/binary search for current-page and anchor selection. Avoid a DOM rectangle read for every page on every scroll. Recompute at most once per animation frame.
10. Put thumbnail renders through bounded scheduling; release tiles outside a retention window, show page numbers/accessible labels, and distinguish actual viewport pages from the 600px prefetch margin for render priority.

**Acceptance:** open/close repeatedly while loading, wrong password then correct password, cancel password, fast scroll out and back during a render, simulated render rejection, rapid zoom/rotation, 1000-page PDF, and a huge single page. No stale publish or permanent blank visible page. Record peak retained raster bytes and render concurrency; bounds must be assertable. Measure device memory separately rather than claiming the estimate is total process usage.

### PDF-09 — Search and semantic layers

**Evidence:** `PdfSearchSheet.tsx:95–101` inserts a space after every text item; this can split words. At 147–157 it lowercases snippets and stops after five hits per page, but reports `hits.length` as a result count. Clicking a hit only navigates to a page while leaving the modal sheet open. Pages are canvas-only. Outline handling always calls `getPageIndex(dest[0])`, although a resolved destination may contain a numeric page index.

**Do:**

- Preserve original text for snippets, and create a normalized search string with a mapping back to text items/offsets. Normalize using item boundaries/end-of-line information, not unconditional spaces. Keep a bounded cache and deduplicate in-flight extraction.
- Count all matches, or explicitly label a capped result set. Virtualize/batch large result lists and throttle progressive updates. Represent hit offsets/IDs and active match, not just page and snippet.
- Add a selectable text layer and search-highlight overlay tied to exactly the page's display viewport. Add read-only link/annotation presentation with deliberate internal navigation and external-link handling. Do not enable arbitrary document actions or invent a form-saving feature.
- Use the installed PDF.js types and bundled matching CSS/assets as the implementation authority. Confirm APIs locally before coding; do not paste APIs from an unrelated PDF.js version. Keep styles scoped so they cannot reset the app.
- Selecting a search result closes/collapses the obstructing sheet and focuses the actual match. Provide next/previous controls while the document remains visible. Distinguish image-only/no-extractable-text and extraction failures from ordinary no-match results; OCR is not included.
- Resolve numeric destination page indexes directly; resolve object references through `getPageIndex`. Preserve target coordinates where supported. Show a recoverable indication for unresolved destinations.

**Acceptance:** a word split across text items, mixed-case snippets, 20 occurrences on one page, rotated highlights, rapid query changes, no text PDF, internal links, numeric/reference/named outline destinations, selection and copy. Mobile text selection must coexist with the gesture policy from PDF-03.

## 4. Spreadsheet: one geometry system

### XLS-01 — Remove double horizontal scrolling of headers

**Evidence:** `XlsxViewer.tsx:115–156,503–535`. `HeadRow` is inside the horizontally scrolling `GridWrap`, sticky only on `top`, with no horizontal pin. Its `HeadTrackInner` also translates by `-scrollLeft` from React state. Body cells at 559 use ordinary content coordinates.

**Why:** when native content moves left by `S`, the header ancestor moves with it; the inner track moves left by another `S`. Before sticky/clipping constraints intervene, header x is approximately `origin + 48 + columnOffset - 2*S`, while body x is `origin + 48 + columnOffset - S`. The React-driven transform can also lag native scrolling. The result is not a column-name calculation bug.

**Required architecture for this fix:** one native two-axis scroller, a full logical-width surface, and a top-sticky header spanning that same surface. Let native horizontal scrolling move both header cells and body cells. Remove `HeadTrackInner`'s scroll translation. Do not add a second horizontally scrolling header and synchronize two `scrollLeft` values.

Use these coordinates, with `L=48`, `H=28`, prefix column offsets `C`, row offsets `R`, and scroller offsets `Sx/Sy`:

```text
surface width  = L + C[columnCount]
surface height = H + R[rowCount]
header column left = L + C[c]
body cell left     = L + C[c]
header cell width  = body cell width = C[c+1] - C[c]
body cell top      = H + R[r]       (surface coordinates)
column client x    = scroller content origin x + L + C[c] - Sx
```

The full-width header is sticky vertically at top 0 and moves horizontally with the surface. Its corner is sticky horizontally at left 0. Row numbers live in one full-height sticky-left rail, vertically aligned with the body; virtual row labels are absolutely positioned inside that rail. Ensure the rail's containing block spans the entire grid height/width so it is not constrained by a zero-height per-row wrapper. A grid-area overlay arrangement can put the rail and body in the same content area. Specify stacking: body < row rail < column header < corner, all frozen backgrounds opaque.

Keep a single geometry model for header, cell, selection, resize handles, and visible-window math. Use numeric positioning in inline styles or CSS variables for frequently changing coordinates, avoiding unbounded styled-components rule creation from scroll-dependent props.

**Acceptance:** at scrollLeft 0, 1, 47, 48, 95, 193, and the far right, every visible column header left/right edge matches its cell edges within **1 CSS px**, including after resizing a column. Test variable widths and diagonal fast scrolling. There must be no JS transform required to keep columns aligned.

### XLS-02 — Border boxes, row coordinates, and sheet state

**Evidence:** `GridCellBox:228–229` subtracts one pixel from width and height despite the global border-box reset, while headers use full width. `RowLabel` is absolute rather than frozen. `computeVisibleWindow` receives full scrollTop even though the body begins after the header. Sheet switching resets DOM offsets but not scroll state in the same transaction (485–491).

**Do:** use full allocation widths/heights with borders inside `box-sizing: border-box`. Draw grid lines once consistently; do not fix drift with arbitrary extra gaps. Name header height and row-label width constants and use them everywhere. Convert viewport bounds to the body's local coordinates, accounting for the header, frozen rail, and clipping. Update `sheetLayout.ts` tests to that contract.

Store `{scrollLeft, scrollTop, selectedCell, widthOverrides}` per sheet, restore in a layout effect after the new surface geometry commits, and update both refs/state from the applied clamped offsets. If choosing reset-to-origin as the initial product policy, reset all of those values explicitly; do not leave a stale virtual window for the first frame. Keep the active sheet name visible even for a one-sheet workbook.

For variable row heights introduced in XLS-04, use row prefix sums and binary search instead of `r*ROW_HEIGHT`. Keep default-height fast paths if useful. Add end-of-sheet tests on both axes; rendering near the first rows must not conceal an incorrect offset through overscan.

### XLS-03 — Render merges as rectangles, not suppressed values

**Evidence:** `parseWorkbook:66–81` expands every covered merge coordinate into a Set and drops covered cells. `GridSheet` has no merge metadata, and rendering gives the origin a normal one-cell width/height. A merged title is therefore clipped to its first cell with ordinary internal grid lines still present.

**Do:** retain validated merge ranges and an interval/spatial index. Never allocate one entry per covered coordinate. For each visible merge, render exactly one anchor cell at the merge origin with width `C[endCol+1]-C[startCol]` and height `R[endRow+1]-R[startRow]`. Suppress normal cells/borders in its interior. Include a merge when it intersects the window even if its origin lies outside the normal overscan window. Resolve hit testing, selected address, and copy to the anchor cell. Width changes must update merge bounds automatically from the same offsets.

Validate bounds, overlap, and range order. A huge or malformed range must not hang parsing. Clip to supported bounds with an explicit limitation state rather than an unbounded expansion.

**Acceptance:** horizontal/vertical/multirow merges, a merge whose anchor is offscreen, a merge crossed by both viewport edges, column resize through a merge, and a full-sheet merge with one populated cell. Work must scale with merge count/visible cells, not merge area.

### XLS-04 — Preserve readable workbook meaning

**Evidence:** `XLSX.read(data,{type:'array'})` at 337; parser reads only `!cols[c].wpx`, clamps widths to 48–320, never assigns declared bold/italic/align, ignores `!rows`, hidden rows/columns/sheets, and maps all errors to `#ERROR`. Rows and columns are silently capped at 1,000,000 and 500. Formula cells retain `f`, but missing cached values can be empty or stringified as `undefined` on the numeric path.

**Do:**

1. Extract parsing into a typed module that receives the XLSX API directly; remove `window.__PAPERWREN_XLSX` as a dependency.
2. Select read options intentionally and test them against the installed version. Request supported style/row/column metadata as necessary. Do not assume SheetJS Community supplies a full Excel style/rendering engine just because `cellStyles` exists.
3. Normalize supported widths from `wpx`, `wch`, or width metadata using one tested conversion. Preserve authored widths unless a user override exists; if a practical cap is necessary, expose it as a limitation. Normalize row heights/hidden entries and map visible coordinates to original row/column IDs.
4. Preserve formatted cached display values for dates, percentages, currency, booleans, and specific errors. Never recalculate formulas. A formula without a cached value must explicitly say “No cached result” in details rather than displaying `undefined` or implying a calculated answer.
5. Preserve supported alignment, wrapping, font emphasis, fills, and borders through a renderer-neutral model. For unsupported styles, use a documented neutral fallback and record the limitation. Do not silently invent bold headers or financial number formats.
6. Make hidden-sheet visibility deliberate; default to visible sheets and offer an explicit reveal action if implemented. Do not accidentally show hidden content as the initial active sheet.
7. Replace silent row/column truncation with either supported range navigation or a persistent, precise notice identifying the loaded boundary. Do not simply remove caps: very tall DOM surfaces can exceed engine coordinate limits. Measure and implement segmented/rebased scrolling for claimed large-range support, or retain a tested disclosed limit.
8. Empty workbook/no viewable sheets must have a terminal empty/error state. The current `!sheet` branch can display “Preparing sheet...” forever when parsing returns an empty array.

**Acceptance:** formatted numbers/dates, cached and uncached formulas, custom row/column sizes, hidden sheets/rows/columns, wrapped text, distinct error codes, data beyond column 500, a blank worksheet, and a workbook with no visible sheets. Record unsupported chart/image/conditional-format/freeze-pane behavior; those are follow-up fidelity capabilities, not solved by text cells.

### XLS-05 — Bound parsing and keep the interface responsive

**Evidence:** import is async but `XLSX.read` and `parseWorkbook` run synchronously on the UI thread. Every sheet is normalized eagerly; merge coverage expansion is unbounded.

Move file parsing/normalization into a dedicated worker using a transferred buffer and generation-based responses. Show a real preparing state with cancellation/back; a worker can be terminated when the document closes. Transfer a plain typed/sparse result, then rebuild indexes deliberately rather than sending React or DOM objects. Normalize the active sheet first where the library/data model permits; do not claim streaming parsing if the engine still reads the whole workbook.

Apply limits to decoded range, populated cell count, merge count, and resulting normalized payload. Return actionable “too large for this viewer” information when a tested budget is exceeded. Avoid serializing a million empty cells. Measure worker parsing time separately from UI time and first-grid paint.

### XLS-06 — Make cells usable on a phone

**Evidence:** details are reachable only by `onDoubleClick` on a div (566–570). Copy errors are swallowed (424–430). The cell sheet at 581 has no `id`, so `Sheet` does not register it for system Back. Resize installs global listeners but removes them only on pointerup (374–397), not cancel/unmount, and ignores pointer identity. Its 13px handle is partly clipped by the header cell's overflow.

**Do:** single tap selects and exposes a visible cell detail/formula strip or Details action. Enter opens details; Escape closes; optional long press must use travel/duration thresholds. Add a stable sheet `id="xlsx-cell-details"`. Stop grid interactions from invoking chrome toggles. Await copy, show success/error feedback, and keep details open on failure. Use the existing snackbar pattern.

Implement resize as a single owned pointer session: initiating ID, capture element, move, up, cancel, lost capture, and unmount cleanup. Ensure listeners cannot accumulate and other fingers cannot resize the column. Offer an accessible Column width action with numeric controls; the narrow drag edge cannot be the only way to resize.

Add grid/read-only semantics with row/column counts and 1-based indices on rendered cells, a roving active cell or `aria-activedescendant` strategy, visible focus, keyboard navigation, and scroll-into-view for focus. Virtualization must mount a destination before assigning focus. Name the selected address and full value for assistive technology.

## 5. Word/DOCX: load, fit, preserve, navigate

### DOC-01 — Loading is state, not zoom

**Evidence:** `DocxViewer.tsx:199` displays loading when `fitZoom === 1`. A successfully rendered document can fit at exactly 1. Restore at 156–167 depends on a later React render after imperative DOM mutation; successful rendering without a changed zoom need not cause that render.

Replace `failed` plus zoom-based inference with `loading | ready | error`, and explicit render-generation/layout-ready state. Begin loading for each document. Mark ready only after current-generation rendering succeeds and page geometry is measured. Show progress/placeholder based on status, never fit scale. Treat zero rendered pages as empty/unsupported rather than eternal loading. Gate restoration on ready plus stable page measurements.

**Acceptance:** document whose fit scale is exactly 1, normal phone fit, zero-page output, import failure, render rejection, close during import/render. Each reaches an honest terminal state; loading disappears even at 100%.

### DOC-02 — A fitted page also needs readable zoom

**Evidence:** initial fit and ResizeObserver read only the first `section.docx` (104–110,130–135), hard-clamp fit to 0.3–1.5, and unconditionally refit. No zoom controls or gesture handlers exist. A wide landscape section later in the document can overflow the first-section-based fit; resizing changes document height without preserving a page point.

**Do:** separate document base page geometry, fit mode, and manual scale. For a shared document scale, compute fit from the widest rendered section; do not scale each section independently and distort the document's relative page sizes. If choosing current-page fit instead, make it explicit and prevent scale changes merely from scrolling.

Measure all page boxes at unscaled dimensions and retain the list. Do not force a 0.3 minimum that prevents fitting unusually wide pages. Add fit-width and manual zoom with anchored pan; keep pages in reachable positive overflow. CSS `zoom` is currently the layout mechanism: verify it on supported Android WebViews before retaining it. If replacing it with transforms, give each scaled page an explicit layout spacer; a transform alone does not resize scroll layout.

Refit only in fit mode. Preserve manual scale on viewport changes, and preserve the page-local reading point across any relayout. Reuse tested anchor primitives from PDF where applicable, with a DOCX geometry adapter rather than importing PDF rendering internals.

Observe relevant content size changes and await usable font/image layout before final restoration, with bounded waiting. Embedded resources can change page geometry after the initial renderer promise. Any late correction must preserve the current point instead of restoring over a user's new scroll.

**Acceptance:** portrait-first/landscape-later file, very wide page, long table, 200% pan to both edges, device rotation, delayed image/font. Fit makes the chosen policy true; manual zoom remains manual; no paragraph jump on resize.

### DOC-03 — Own renderer DOM and honor position preferences

**Evidence:** `renderAsync` receives the live container. Cancellation at 99 stops only React follow-up; it cannot stop a started renderer from mutating the container. Error callbacks are not cancellation-guarded. The debounce at 141–154 has no unmount cleanup. DOCX does not consult remember-position, and `ViewerScreen` passes saved positions unconditionally. `FilePositionLike` duplicates the shared contract.

Render each generation into its own staging container (including its renderer-owned styles), then attach only if still current. Discard stale output and guard both success/error paths. Preserve required style nodes. Do not sanitize generated markup blindly in a way that destroys DOCX styles; keep untrusted resource/link handling deliberate and scoped. Remove the global failure string or replace it with development-only diagnostics that do not persist document content.

Use shared typed position contracts and the preference gate. Clear timers and observers; flush latest position on close/background as described for PDF. Reset restoration/status per document generation. If using object URLs for images/fonts, track and revoke them on generation disposal; changing `useBase64URL` without URL lifecycle ownership is incomplete. Base64 avoids some URL lifetime work but can increase large-image memory; profile before claiming a memory fix.

The app currently keys viewer navigation in `App.tsx`, which reduces ordinary cross-file reuse. Still implement proper effect ownership: StrictMode, close-during-load, and future prop updates remain valid lifecycle cases.

### DOC-04 — Add reading tools without promising Word's layout engine

After stability, add a page indicator/jump control, search with active-hit navigation, and heading outline when semantic headings can be extracted reliably. Build search indexing from text nodes with a node/offset map. Highlight via non-destructive ranges/overlays or a scoped mechanism; do not replace the renderer's `innerHTML` on each query. Keep selection/copy working.

Create a fidelity corpus with headers/footers, section breaks, page numbering, nested lists, tables across pages, footnotes, images, RTL text, authored colors, and embedded fonts. Compare against supplied reference renderings during implementation QA. `ignoreLastRenderedPageBreak: false` is a rendering policy that needs those fixtures; changing it globally can trade one document's layout issue for another's.

Audit the existing `!important` white-page and default-ink rules: they can override an authored section background/default color. Preserve document styling where supported and keep app theme around the page. A separate high-contrast override, if later added, must be an explicit reading mode.

No CSS patch can guarantee identical Word pagination, advanced floating object layout, or full Office fidelity. Record fixture-specific mismatches and renderer limitations accurately. A reflow reading mode is a later distinct mode with adjustable text size; do not achieve it by shrinking all page margins and tables in the faithful page view.

## 6. Shared shell defects

### SH-01 — Responsive PDF controls

**Evidence:** PDF renders six toolbar action buttons plus Back. `IconButton` has a nonshrinking 48px target; seven buttons require 336px before gaps, padding, format dot, or filename. `ViewerShell.TopRow` has no wrapping/overflow strategy. Narrow phones cannot accommodate this honestly.

At phone widths, show Back, an ellipsized filename, Search, and More. Move zoom in/out, fit modes, rotate, outline, and thumbnails into the tools sheet or a deliberate secondary control strip. A compact zoom/fit status may remain in the bottom bar. At larger widths expose more actions only when measured space allows. Keep 48px primary icon targets; do not squeeze icons into unusable targets to preserve the current row.

Test 320, 360, 390, 412, and tablet widths with long filenames and increased system text size. Every action must be reachable, no toolbar-induced horizontal app overflow, and filename remains discoverable.

### SH-02 — Chrome toggling must be opt-in

**Evidence:** `ViewerShell.tsx:196–205` toggles on any noninteractive content click, irrespective of `chromeAutohide`. Spreadsheet cells are divs and pass that filter. DOCX viewers pass autohide false but still toggle on taps. A double-tap PDF gesture can also bubble clicks into this handler.

Add separate explicit `allowTapToToggleChrome` and idle-autohide policies, or make the viewer's gesture controller invoke chrome actions. Default spreadsheet/DOCX chrome to stable until deliberately supported. For PDF, only a validated single background/read-surface tap toggles; selection, links, pinch, drag, and double-tap do not. Interactive overlays must not toggle underlying chrome via React portal event bubbling.

Pause idle hiding while overlays, loading/password/error recovery, or toolbar keyboard focus are active. Hidden toolbars must be removed from keyboard focus/accessibility interaction using an appropriate supported mechanism, not merely translated offscreen. Restore focus to a visible control on dismissal.

### SH-03 — Insets and overlays need one owner

`ViewerShell.BottomBar` includes safe-area bottom padding (94); PDF `ReaderStatus` adds it again near the end of `PdfViewer.tsx`. Let the shell own safe-area padding exactly once. Ensure viewers without a bottom bar still reserve system bottom inset, and handle left/right safe areas in landscape. Expose measured insets to both CSS and layout math without repeated magic subtractions.

Preserve the existing overlay registration/back stack. Give every new sheet a stable ID. Verify focus stays in a modal sheet and returns to its opener; the existing shared Sheet initially focuses the panel and handles Escape but does not implement a full focus trap. Fix that shared behavior once if required by the new controls, and test Back with stacked viewer/tools/details flows.

## 7. Suggested module boundaries

These names are guidance; keep equivalent existing abstractions if they satisfy the contract. Avoid a large framework migration.

| Module | Responsibility |
|---|---|
| `src/lib/pdfLayout.ts` | Pure fit, canonical page coordinate conversions, anchor/clamp math |
| `src/screens/viewer/useViewerViewport.ts` | Measured unobscured viewport and stable inset contract |
| `src/screens/viewer/useDocumentGestures.ts` | Pointer session, tap arbitration, preview/commit lifecycle |
| `src/screens/viewer/usePdfDocument.ts` | Loading generation, password flow, byte/task ownership |
| `src/screens/viewer/pdfRenderScheduler.ts` | Render demand, generations, budgets, retries, thumbnail scheduling |
| `src/screens/viewer/PdfPage.tsx` | Separate raster/text/annotation/highlight children and page status |
| `src/lib/sheetLayout.ts` | Row/column geometry, visible ranges, coordinate conversions |
| `src/lib/workbookModel.ts` and worker | Sparse workbook normalization, merges, supported metadata, limits |
| `src/screens/viewer/SpreadsheetGrid.tsx` | One scroll surface, frozen headers, selection/resize/navigation |
| `src/screens/viewer/useViewerPosition.ts` | Restore lifecycle, latest snapshot debounce/flush, preference gate |

Extract along actual ownership boundaries as each slice is implemented. Avoid building unused abstractions for future editing/OCR.

## 8. Persistence contract and migration

Extend `src/lib/types.ts` and **also** `src/lib/recents.ts:cleanPosition`; otherwise newly saved fields will disappear when recents normalize on reopen. Review `RecentsContext.updatePosition`, which shallow-merges old/new position objects, so changing mode can leave obsolete fields behind.

Recommended version-2 discriminated payload:

```ts
type PageLocation = {
  pageIndex: number;             // zero-based, integer
  x: number; y: number;          // canonical local document coordinates
  viewportX: number; viewportY: number; // target fractions of usable viewport
};
type PositionV2 =
  | { version: 2; kind: 'pdf'; location: PageLocation;
      mode: 'width' | 'page' | 'manual'; scale?: number; rotation: number }
  | { version: 2; kind: 'docx'; location: PageLocation;
      mode: 'width' | 'manual'; scale?: number }
  | { version: 2; kind: 'sheet'; sheetName: string;
      row: number; col: number; offsetX: number; offsetY: number };
```

Finalize exact coordinate units in type comments before coding. PDF coordinates should use PDF viewport conversion; DOCX uses unscaled section CSS coordinates. Their adapters must not confuse those units. Keep a readable legacy union/decoder for existing `{page,zoom,scrollRatio}` values and migrate when enough document information is available.

Validate every stored numeric value with `Number.isFinite`, bounds and integer checks where appropriate; current `cleanPosition` only checks type/sign for page/zoom. Clamp against the actual opened document. Replace the complete versioned payload on writes instead of merging incompatible fields. Missing sheet/page falls back predictably to the first available content. Spreadsheet user column width overrides may remain session-local for this slice; do not silently persist layout edits into the workbook.

Respect `viewer.remember_position` for restore and writes across all three viewers. Respect the existing recents opt-out. Do not store passwords, document text, or search excerpts in position state.

## 9. Verification specification

### Automated coverage required for these behavioral changes

Keep existing tests and add regressions that would fail under the current implementation. Pure helper tests are appropriate for geometry, but DOM rectangles and native scrolling require a browser integration harness. Use the repository's existing runner if present when implementation starts; otherwise add a small browser test setup with local fixtures. This audit does not add a new test dependency.

| Test group | Required assertions |
|---|---|
| PDF zoom transaction | Preview removed before final measurement; target drift <=2px away from clamped boundaries; no-op/cancel finalizes; moving midpoint follows same content point |
| PDF scale/rotation | Fit below 0.5 preserved on manual conversion; anchor-page geometry used; all intrinsic/user rotation combinations consistent |
| PDF lifecycle | StrictMode replay, pending load close, password recovery, stale render completion, re-entry during cancellation, visible-page retry |
| PDF geometry changes | Insets used for fit-page; late metadata and viewport resize preserve location; actual page bounds reachable |
| Grid DOM | Header/body edges <=1px difference at multiple offsets before/after resizing; fixed row rail and corner; first/last rows/columns visible |
| Grid model | Merge origin outside window, huge sparse merge, custom widths/heights, hidden entries, formatted values, uncached formulas, disclosed limits |
| Grid interaction | Single-tap details action, copy failure feedback, Back closes details, pointercancel cleanup, keyboard active-cell navigation |
| DOCX lifecycle | 100% ready state, render error, stale DOM discarded, content-ready restore, cleanup, remember off |
| DOCX layout | Mixed sections, width fit policy, manual scale preserved, late image/font layout anchored |
| Persistence | Legacy migration, new fields survive normalization, old mode fields removed, nonfinite values rejected, immediate-close flush |
| Shell | 320px toolbar fits; cell tap leaves chrome; no offscreen focus; safe area counted once; overlay focus/back order |

Do not mock `getBoundingClientRect` to return the desired aligned values in the only header/zoom regression test. That would test the mock instead of the bug. Unit tests may still use synthetic rectangles to isolate formulas.

### Fixture corpus

Extend the fixture generator without overwriting unrelated user documents. Store generated test cases under a dedicated viewer-regressions fixture directory with a manifest of what each case tests.

- PDF: mixed portrait/landscape/crop sizes; intrinsic rotations; repeated searchable words and split text items; image-only scan; encrypted file; 1000 small pages; oversized single page; named/numeric/reference destinations; damaged page.
- XLSX: unequal widths; resized columns; wide/tall sparse ranges; merge crossing the window; large sparse merge; hidden sheets/rows/columns; formatted numbers/dates/errors; formulas with and without cached results; empty workbook; unsupported feature samples with expected notices.
- DOCX: fit exactly 1; multiple page sizes; headers/footers; long tables; nested lists; page breaks/section breaks; large and delayed images; authored backgrounds/colors; RTL and font fallback; empty/corrupt input.

Use controlled mocks for failures that cannot be reliably encoded into a fixture, and state which tests are fault injection. Do not mislabel a simply corrupt PDF as a damaged individual page fixture unless it actually opens and fails at that page.

### Device and performance gates

The numbers below are proposed engineering targets, not measured baseline performance:

- Anchor drift <=2 CSS px when scroll boundaries permit preservation; grid edge difference <=1 CSS px.
- During gestures, no expensive document parsing/rasterization on each pointer move. Schedule preview updates once per animation frame.
- Target p95 interactive frame time <=32ms on an agreed midrange Android device; report device, WebView version, refresh rate, fixture and measurement method. Do not claim 60fps from desktop emulation.
- Visible demand is scheduled ahead of prefetch. Raster concurrency and configured byte/dimension budgets are never exceeded by the application-owned caches.
- Test repeated open/close and scrolling the whole document. Retained application cache size should return to its idle bounds; garbage collection need not happen instantly.
- Measure first-page/grid paint separately from metadata/index completion. Progress must not show a fabricated near-complete percentage for unknown-duration work.
- Real Android checks include fling, pinch, rotation, Back, software keyboard during search, clipboard failure, TalkBack, and app background/resume. Browser tests cover DOM geometry and desktop wheel/keyboard behavior; they do not certify all of those native behaviors.

At the end run `npm test`, `npm run build`, and `npm run lint`. Lint is an implementation completion requirement; this audit only ran build and tests. Report any pre-existing failures separately and do not use autofix commands across unrelated files.

## 10. Implementation order and completion gates

| Slice | Work | Must be true before continuing |
|---|---|---|
| 1 | Minimal failing regressions; SH-01; XLS-01 and border/header geometry from XLS-02 | Narrow toolbar reachable; real DOM header/cell alignment passes |
| 2 | Shared viewport contract; PDF-01/02/03/04/05 | Stable anchored zoom, rotation, fit and resize; no stale transforms; Android gesture policy proven |
| 3 | PDF-07/08; DOC-01/03; XLS-05 parsing limits/worker | Loads cancel cleanly, no silent blank page, no merge-area expansion, honest terminal states |
| 4 | Versioned persistence; PDF-06; DOC-02; remaining XLS-02; SH-02/03 | Reopen/resize/close preserve intended view; settings honored; stable shell/back/focus |
| 5 | XLS-03/04/06 | Merges and supported values/metadata correct; limits disclosed; mobile cell inspection usable |
| 6 | PDF-09; DOC-04; remaining reader accessibility/navigation | Search targets visible content, selectable text works, known fidelity limits documented |
| 7 | Full corpus/device pass and final report | Every included finding has evidence or an explicit remaining limitation |

If a later slice needs an earlier abstraction, introduce the smallest shared piece first and keep the failing regression attached to its fix. Do not claim the entire audit completed after fixing only the two reported symptoms. Equally, do not delay the P0 fixes to build advanced search or reflow features.

### Definition of done for the handoff

Deliver focused changes with passing relevant tests, a short implementation report mapping all IDs to fixed/deferred/blocked and evidence, and a list of remaining renderer capability limits. The first release-quality milestone requires all P0/P1 items in this scope; P2 can be a clearly identified follow-up milestone. “Adobe/Microsoft level” is not a checkbox earned by adding icons or copying styling. The measurable outcome is a reader that keeps the user's place, accurately aligns and presents supported content, and stays responsive through ordinary mobile interactions.

## 11. Copy-paste starting instruction for GLM

> Implement `docs/14-viewer-engineering-audit-glm-handoff.md` against the current Paperwren source. Follow the slices in section 10, beginning with failing regressions for spreadsheet header alignment and PDF zoom transactions. Treat the file as an engineering brief: inspect current symbols, implement the contracts, and verify each slice before proceeding. Preserve unrelated changes and offline/read-only behavior. Do not push or release. Report finding IDs, exact fixes, test evidence, and device checks still pending. Do not equate the existing 84 passing helper tests with correct mobile layout, and do not mark untested acceptance criteria passed.
