# Paperwren deep UX audit and remediation plan

Status: audit only. This document intentionally does not implement any application changes.

Audit date: 2026-09-04  
Audited revision: `e669bf5` (`main`)  
Primary target: Android, with browser/desktop behavior kept consistent

## 1. Goal

Turn Paperwren into a calm, dependable document reader whose core flows feel native:

- opening a file always preserves its real name and creates a recent item that can be reopened;
- system Back reverses one UI step at a time instead of unexpectedly closing the app;
- PDF zoom stays under the user's fingers or chosen focal point;
- zoomed PDF pages can be panned fully in every direction;
- toolbars and teaching UI never hide document content or demand an unnecessary tap;
- large and image-heavy PDFs reach first paint quickly and do not create avoidable memory pressure;
- DOCX and spreadsheet viewers follow the same chrome and navigation rules;
- the dashboard looks intentional, modern, and useful rather than like a sparse debug list;
- the Android launcher icon reads clearly at normal launcher size.

This brief is written as an implementation handoff. Follow the priorities and dependency order. Do not start with visual polish while file identity, reopening, navigation, and zoom are still structurally wrong.

## 2. Audit method and baseline

The audit covered:

- the React route and viewer state model;
- the PDF layout, rendering, zoom, search, outline, and thumbnail code;
- DOCX and XLSX viewport/chrome behavior;
- recents normalization, persistence, and reopen behavior;
- the Tauri/Rust storage boundary;
- the generated Android open-with patch;
- the bottom-sheet, dialog, coach-mark, and snackbar components;
- Android icon generation and release workflow;
- existing product specifications and unit tests;
- a browser smoke test at the mobile layout.

Observed baseline:

- `npm run build` passes.
- `npm run lint` passes with four existing style warnings.
- Existing unit tests exercise pure helpers, but there are no end-to-end tests for Android file grants, process restart, hardware Back, overlay dismissal, or focal zoom.
- The browser smoke test showed a recent card for `sample.pdf`; tapping it reproduced the `File not found` dialog because the recent persisted an identifier whose in-memory file handle no longer existed.
- The mobile dashboard is visually sparse: one narrow recent card occupies a small area while most of the viewport is empty.
- The current Android foreground artwork is visibly over-padded; the mark is scaled to 60% inside an already padded adaptive-icon pipeline.

## 3. Priority summary

| Priority | Finding | User impact | Main root cause |
|---|---|---|---|
| P0 | Recent files show generic names and cannot reopen | The app loses trust immediately | Display name, durable handle, and cached copy are conflated into one `source` string |
| P0 | Hardware/system Back exits from viewer or settings | Navigation feels broken and data/context can be lost | Routes and overlays are component state, not a back stack; Android Back is not bridged |
| P0 | PDF zoom jumps away from the focal point | Reading becomes disorienting | Incomplete anchor math and the wrong transform origin |
| P0 | Left side of a zoomed PDF can become unreachable | Parts of the document cannot be viewed | An overflowing child is centered by flex alignment, creating inaccessible negative overflow |
| P0 | Viewer controls cover content on entry | The first lines/page area are hidden | Shared chrome is absolutely positioned over content with no common viewport contract |
| P1 | Large/image PDFs are slow and memory-heavy | Long waits, blanking, and possible OOM | Whole-file reads/copies, eager page metadata, uncancelled renders, and no render scheduler |
| P1 | “Tap to hide the buttons” prompt repeatedly obstructs reading | Annoying mandatory-feeling interaction | Coach mark persists until explicitly tapped and has no auto-dismiss lifecycle |
| P1 | Overlay Back behavior is inconsistent | Back can exit instead of dismissing the top sheet/dialog | Sheets do not participate in a central overlay stack |
| P1 | Dashboard hierarchy and interactions are weak | Recents feel unfinished | Sparse single-purpose cards, hidden long-press actions, no continuation/status design |
| P1 | Android launcher mark looks small | Weak launcher/app-menu presence | Foreground SVG applies an additional `scale(0.6)` before icon generation |
| P2 | PDF features fall short of the stated quality bar | Missing selection, links, highlights, nested outlines | Canvas-only pages and partial PDF feature implementations |
| P2 | Persistence writes can race | Rare lost/corrupt state | Non-serialized frontend writes and one process-wide Rust temp filename |

## 4. P0 — durable file ingestion, real names, and reliable recents

### 4.1 Evidence

- `src/lib/backend.ts:120-145` receives only the picker-returned path/URI, derives `name` from its last path segment, and reads the entire URI later.
- `scripts/patch-android-openwith.mjs:48-68` uses `uri.lastPathSegment` instead of querying Android's `OpenableColumns.DISPLAY_NAME`.
- `src/screens/viewer/ViewerScreen.tsx:75-81` records the recent only after reading and sniffing, then stores `file.source` as its reopen handle.
- `src/App.tsx:85-94` reopens a recent by assigning `entry.source` to both `ref` and `source`.
- `src/lib/types.ts` has no durable reopen descriptor or separate managed-copy path.
- `src/lib/sniff.ts:85-97` can only replace opaque names with generic labels such as `Document.pdf`; it cannot recover the real provider display name.
- `scripts/patch-android-openwith.mjs:70-90` copies open-with files to `filesDir/inbox`, but that directory is outside the Rust cache lifecycle.
- `src-tauri/src/lib.rs:34-40` and `:92-105` report/clear only `app_cache/files`, so inbox copies accumulate and “Clear cache” does not clear them.

### 4.2 Why the current model fails

`source` is currently asked to mean all of these things:

1. stable document identity;
2. original provider URI or desktop path;
3. current readable handle;
4. managed local copy;
5. recent-entry deduplication key.

Those are different concepts. A `content://` grant may be temporary. A provider URI may not contain a filename. A managed copy can move or be cleared. A display name is not a unique identity. The current fallback changes only the label and therefore cannot fix reopen reliability.

### 4.3 Required data contract

Replace the `source`-only contract with an ingested document contract. Exact naming may vary, but the concepts must remain separate.

```ts
type ReopenDescriptor =
  | { kind: "persisted-uri"; uri: string }
  | { kind: "managed-copy"; path: string }
  | { kind: "desktop-path"; path: string };

interface IngestedDocument {
  id: string;                    // stable identity, not a display name
  displayName: string;           // provider DISPLAY_NAME when available
  format: FileFormat;            // sniffed from bytes/content, not trusted MIME alone
  size: number;
  reopen: ReopenDescriptor;
  originalUri?: string;
  managedCopyPath?: string;
  importedAt: number;
}

interface RecentDocument {
  id: string;
  displayName: string;
  format: FileFormat;
  size: number;
  reopen: ReopenDescriptor;
  originalUri?: string;
  managedCopyPath?: string;
  addedAt: number;
  lastOpenedAt: number;
  pinned: boolean;
  position?: FilePosition;
}
```

Migration must accept old entries. Old entries that cannot be reopened should be shown as unavailable with a repair/remove action; do not silently pretend they are healthy.

### 4.4 Android ingest behavior

Implement one native ingestion path used by both the in-app picker and open-with/share intents.

1. Query `ContentResolver` with `OpenableColumns.DISPLAY_NAME` and `OpenableColumns.SIZE`.
2. Prefer the provider display name. Use sanitized `lastPathSegment` only as a fallback.
3. Inspect intent grant flags. For `ACTION_OPEN_DOCUMENT`, call `takePersistableUriPermission` when the provider permits it.
4. If the grant cannot be persisted, create a managed private copy and make that copy the reopen descriptor.
5. Perform metadata lookup and file copy off the Android main thread. The current synchronous `input.copyTo(output)` can block `onCreate`/`onNewIntent` for a large or scanned PDF.
6. Emit ingest progress or at least a determinate phase (`Receiving file`, `Preparing PDF`) without blocking toolbar/back interaction.
7. Sniff the format once, close to ingestion, and return the authoritative result with the real name and size.
8. Deduplicate managed copies by a stable fingerprint. At minimum use content URI + provider metadata; preferably stream a SHA-256 while copying.
9. Define a managed-copy quota and lifecycle. Do not put reopen-critical files in a cache that “Clear cache” deletes without marking recents unavailable.
10. If a managed copy is removed, update or invalidate its recent entry atomically.

Recommended storage split:

- `app_data/imports/`: managed copies required to reopen open-with files; user-visible storage controls must explain this area.
- `app_cache/render/`: disposable thumbnails, page rasters, and temporary renderer data.
- persisted provider URIs: no duplicate import unless the provider is unreliable or performance requires one.

### 4.5 Frontend reopen behavior

- `backend.pickFile()` should return `IngestedDocument`, not a raw URI-shaped `PickedFileMeta`.
- `backend.openRecent()` should resolve the descriptor and return either readable content or a typed reason: revoked grant, missing managed copy, moved desktop file, permission denied, corrupt content.
- Record the recent from native metadata immediately after successful ingestion. Do not wait for PDF.js to finish parsing.
- If parsing fails, keep or remove the recent according to an explicit policy and show the correct error; never turn every read failure into “File not found.”
- Provide `Locate file`/`Choose again` when a persisted source is unavailable, then update the existing recent rather than creating a duplicate.
- Preserve the original real name through every layer. `displayNameFor()` should remain only the last fallback.

### 4.6 Acceptance criteria

- Pick a PDF named `2026 tax return.pdf`; dashboard and viewer show exactly that name.
- Kill the app process, relaunch, tap the recent, and reopen successfully.
- Restart the device and repeat.
- Open the same file from Files, Drive, Downloads, WhatsApp, and an `ACTION_SEND` source; real names appear whenever the provider exposes one.
- Open the same file twice; one recent is updated, not duplicated.
- Move/delete/revoke the original. A managed copy still opens, or the recent clearly offers repair/removal.
- Clear render cache. Reopen-critical recents still work.
- Copying a 250 MB file does not freeze the main thread and Back remains responsive.
- Existing generic `Document.pdf` entries migrate without crashing and are clearly marked if unrecoverable.

## 5. P0 — real navigation and Android Back handling

### 5.1 Evidence

- `src/App.tsx:19-22` defines only one current route.
- `src/App.tsx:52-56` replaces that route directly and `goHome()` always jumps to Home.
- `src/screens/settings/SettingsScreen.tsx:41-77` keeps the settings subpage in local state.
- PDF sheets/search/dialogs are individual booleans in `PdfViewer` rather than entries in a shared overlay stack.
- `src/components/ui/Sheet.tsx` has no Escape, browser-history, or Android Back handling.
- `scripts/fixtures/MainActivity.template.kt` and the Android patch do not add a Back bridge.
- A second open-with intent replaces the active viewer in `App.tsx`; it does not stack file B above file A as the product spec requires.

### 5.2 Required navigation model

Use one navigation reducer/store with two ordered stacks:

```ts
interface NavigationState {
  screens: ScreenEntry[];   // Home at the bottom
  overlays: OverlayEntry[]; // sheet/dialog/search above current screen
}
```

Back priority must be exactly:

1. dismiss the top dialog/sheet/search/thumbnail/outline overlay;
2. leave a settings subpage and return to Settings root;
3. pop the active viewer and reveal the prior screen/viewer;
4. leave Settings root and reveal Home;
5. only when Home is the sole screen, allow Android to close/minimize the activity.

The toolbar Back arrow must call the same `handleBack()` function as system Back. Do not maintain two behaviors.

### 5.3 Android bridge

Add an Android Back callback in `MainActivity` using `OnBackPressedDispatcher`. The callback should ask the web layer whether it consumed Back. One workable contract is:

```js
window.__paperwrenHandleBack(): boolean
```

The function synchronously dispatches the navigation reducer action and returns `true` if it dismissed/popped something. If it returns `false`, temporarily disable the native callback and delegate to the activity's normal Back behavior.

Also wire browser `popstate` for desktop/browser QA. Browser URL changes can remain minimal (`#home`, `#viewer`, `#settings`) but history entries must reflect meaningful screens and overlays.

### 5.4 Acceptance criteria

- Home → PDF → system Back returns Home; a second Back exits/minimizes.
- Home → Settings → Appearance → Back returns Settings root → Back returns Home → Back exits.
- PDF → tools sheet → thumbnails → Back dismisses thumbnails first, then returns to PDF, then Home.
- PDF search with the keyboard open → Back closes keyboard first where Android owns that behavior, then closes search, then returns Home.
- Open file A, receive open-with file B while alive, press Back, and return to file A at its preserved scroll/zoom.
- Toolbar Back and hardware Back produce identical transitions.
- Rotation does not erase the stack or reopen a dismissed overlay.

## 6. P0 — focal PDF zoom that does not jump

### 6.1 Evidence and exact faults

- `src/screens/viewer/PdfViewer.tsx:503-590` stores only global scroll-width/height ratios.
- Wheel/pinch focal coordinates use client coordinates without consistently subtracting the scroll container's bounding rectangle.
- After relayout, the code subtracts half the viewport, so the chosen focal point is forced toward the viewport center instead of remaining under the fingers.
- The preservation effect depends only on `firstBox.width`; it can miss height-only changes, rounded-width no-ops, mixed page geometry, and other relevant relayouts.
- Pinch preview uses `Pages` with `transform-origin: 50% 0`, so the preview itself scales around top-center rather than the pinch midpoint.
- Zoom buttons deliberately clear the focal anchor, leaving the browser to preserve raw scroll offsets while document dimensions change.
- `onDoubleClick` is a mouse event, not a reliable mobile double-tap gesture.

### 6.2 Correct anchor model

Anchor to a page and a point inside that page, not to the document's total scroll ratio. Total document height changes non-uniformly with mixed page sizes, rotation, and placeholder correction.

Before changing zoom:

1. Get the scroller rect.
2. Choose the focal client point:
   - pinch: midpoint of the two active pointers;
   - wheel: wheel event coordinates;
   - double-tap: tap coordinates;
   - toolbar zoom button: center of the visible document viewport.
3. Find the page whose rect contains that point, or the nearest visible page.
4. Save `{ pageNumber, xRatioWithinPage, yRatioWithinPage, clientXWithinScroller, clientYWithinScroller }`.
5. Apply zoom/fit change.
6. In `useLayoutEffect`, after the new page boxes are committed, find the same page and point.
7. Set `scrollLeft` and `scrollTop` so that page-local point returns to the same client coordinate.
8. Clamp both axes to valid scroll ranges.

Create this math as a pure helper (`computeAnchoredScroll`) and test it independently.

For the live pinch preview, set transform origin to the current pinch point in content coordinates, or apply an explicit translate-scale-translate transform. On pointer-up, clear the preview transform only after the sharp layout is committed and the anchored scroll is applied; otherwise a one-frame flash/jump is visible.

### 6.3 Zoom semantics and controls

- Separate `fitMode` from `manualZoom` clearly.
- Pressing `+` or `-` should enter manual/custom zoom and show the actual percentage. Do not keep saying `Fit width` while rendering fit-width × 125%.
- Fit width and fit page are explicit actions, not a mysterious three-state cycle hidden behind a status pill.
- Implement mobile double-tap detection with pointer/touch timing and movement thresholds. Cycle or zoom as documented, anchored at the tap.
- Persist zoom/fit mode immediately after zoom settles, not only when a later scroll event happens.
- Clamp restored page and zoom to the newly loaded document's valid limits.

### 6.4 Acceptance criteria

- Put a word near the lower-right of a page under the pinch midpoint; pinch to 200%; the word remains under the same midpoint within 8 CSS px.
- Zoom in/out with buttons while reading the middle of page 25; the same page region stays centered.
- Ctrl-wheel zoom preserves the cursor point.
- Double-tap on a paragraph zooms around that paragraph, not page top.
- Repeat on portrait, landscape, mixed-size pages, and after 90° rotation.
- No one-frame jump occurs when the pinch preview becomes a sharp canvas.
- Page/zoom position persists even when the user zooms and immediately leaves without scrolling.

## 7. P0 — fully reachable horizontal panning

### 7.1 Root cause

`src/screens/viewer/PdfViewer.tsx:65-72` makes `Pages` a column flex container with `align-items: center`. When a page becomes wider than the scroller, flex centering can place the child's left edge in negative overflow. `scrollLeft` cannot navigate to content that lies before the scroll origin, so the user can move right but cannot reach the left side.

### 7.2 Required layout

Use a wrapper that grows to the widest page while remaining at least viewport width:

```css
.pages {
  width: max-content;
  min-width: 100%;
  align-items: stretch;
}

.pageBox {
  margin-inline: auto;
}
```

Behavior:

- when a page is narrower than the viewport, auto margins center it;
- when it is wider, the wrapper expands and the page begins at a reachable non-negative origin;
- `scrollLeft = 0` always reveals the true left edge;
- maximum `scrollLeft` always reveals the true right edge.

Verify RTL/system direction does not invert the contract unexpectedly. Keep PDF content positioning explicitly LTR if necessary while leaving extracted text direction intact.

### 7.3 Acceptance criteria

- At 400% zoom, pan to all four page corners.
- Starting from the right edge, pan fully back to the left edge.
- Portrait and landscape pages remain centered when narrower than the viewport.
- Mixed page widths do not shift the scroll origin between pages.
- No body-level horizontal scroll appears outside the PDF scroller.

## 8. P0 — viewer chrome must not cover the document

### 8.1 Evidence

- `src/screens/viewer/ViewerShell.tsx:32-98` absolutely positions the top bar, bottom bar, and content over the same full inset.
- PDF `ScrollWrap` uses `inset: 0` and only 8 px padding, so page content begins behind the visible toolbar.
- DOCX and XLSX each invent their own offsets (`DocxViewer.tsx:14-21`, `XlsxViewer.tsx:115-123`), creating inconsistent behavior and maintenance risk.
- Loading and error surfaces do not share the same viewport inset contract.

### 8.2 Required shared contract

Create one shared `ViewerViewport`/CSS-variable contract in `ViewerShell`:

- authoritative `--viewer-top-height` including safe-area inset;
- authoritative `--viewer-bottom-height` including the mode-specific bottom bar and safe-area inset;
- a document-start spacer so the first page/row/line is never hidden on entry;
- `scroll-padding-top`/`scroll-padding-bottom` so programmatic page jumps are not obscured;
- consistent z-index and pointer-event behavior;
- no page relayout jump merely because auto-hide runs.

Recommended reading behavior: chrome may overlay content after the user scrolls, but the scrollable document must contain start/end padding equal to the visible chrome heights. At scroll position zero, the first content is fully visible. This preserves screen space without shifting the document every 2.5 seconds.

Apply the contract to PDF, DOCX, XLSX/CSV, text, Markdown, loading, and error states. Remove format-specific magic numbers once the shared variables work.

### 8.3 Acceptance criteria

- Open every supported format; no first line, page header, row header, or cell is under the toolbar.
- Jump to a PDF search result/page; the target is not hidden by chrome.
- Last PDF page and last spreadsheet row are reachable above the bottom controls.
- Safe areas work on cutout/notch devices and gesture-navigation devices.
- Showing/hiding chrome does not cause scroll position jumps.

## 9. P1 — remove the annoying mandatory-feeling coach notification

### 9.1 Evidence

- `src/screens/viewer/ViewerShell.tsx:211-215` mounts the viewer coach for every viewer shell.
- `src/state/coachMarks.tsx:88-109` shows it after 1.2 seconds and marks it seen only when the bubble itself is tapped.
- Ignoring it, leaving the viewer, or tapping elsewhere does not complete the coach. It can therefore recur.
- The timeout cleanup returned inside the Promise callback is not returned from the React effect, so it is not a valid effect cleanup.
- The bubble has no close icon, timeout, or non-obstructive placement contract.

### 9.2 Required behavior

Preferred solution: remove the viewer coach bubble entirely. Visible conventional controls, auto-hide behavior, and an optional setting explanation are sufficient.

If product insists on keeping it:

- show it once per install only;
- mark it seen when it is shown, not only when clicked;
- auto-dismiss after 3–4 seconds;
- dismiss on scroll, zoom, toolbar action, center tap, Back, or viewer exit;
- never require tapping the message;
- fix the effect cleanup with a timer owned by the outer effect scope;
- keep it clear of the focal reading area and accessibility focus.

## 10. P1 — large and image-heavy PDF performance

### 10.1 Current bottlenecks

1. `backend.readBytes()` loads the whole file before PDF.js starts.
2. `bytes.buffer.slice(...)` can copy the file.
3. `PdfViewer.load()` passes `dataSource.slice(0)`, making another full copy.
4. The original `ArrayBuffer` remains in React state while PDF.js owns its copy.
5. Page-size discovery requests every page immediately in batches of 12 (`PdfViewer.tsx:293-327`).
6. Only the first size update and final all-pages update are published, so long documents use page-one fallback geometry and then suffer a large late relayout.
7. Render tasks are not retained/cancelled. A zoom change disconnects observers, but previous PDF.js work can continue in the background.
8. Rapid zoom can start overlapping old/new renders of the same page.
9. Every page has a DOM placeholder and observer even for extremely long files.
10. Search extracts every page serially on each query change with no debounce or text cache (`PdfSearchSheet.tsx:105-157`).

### 10.2 Required renderer architecture

- Prefer PDF.js URL/range loading from a native-managed local file. Use Tauri's safe asset URL or a narrowly scoped custom protocol and verify CSP/path traversal. Do not materialize multiple full-file JavaScript copies.
- If URL/range loading cannot work on a target, transfer/own one buffer only; remove avoidable `.slice()` calls after confirming PDF.js ownership semantics.
- Build a render scheduler with a small concurrency limit (recommended 2 on phones, configurable after profiling).
- Keep each PDF.js `RenderTask`; call `cancel()` when a page leaves the render window, zoom/rotation changes, or the viewer unmounts.
- Prioritize visible page, then adjacent pages, then thumbnails/search.
- Suspend or deprioritize thumbnail/search extraction while an active zoom/scroll render is settling.
- Discover exact page geometry lazily. Maintain stable estimates and correct only affected regions without one all-document relayout.
- Consider a real virtual list for documents above a threshold, while preserving anchor during measured-height corrections.
- Cache page text once per document for search. Debounce query input 200–300 ms and cancel stale work.
- Use coarse preview quality while pinch is active, then one sharp render after settle.
- Keep the existing canvas pixel budget, but add per-device/global live-canvas memory budgeting rather than only a per-page cap.

### 10.3 Performance gates

Measure on a low-end Android reference device, not only desktop browser:

- 10 MB ordinary PDF: first readable page ≤ 800 ms after ingestion is ready.
- 100 MB scanned PDF: visible progress within 300 ms; first readable page target ≤ 2 s.
- Continuous scroll: no blank page visible longer than 100 ms at normal speed.
- Steady reader memory target ≤ 350 MB; no unbounded growth after scrolling 100 pages forward and back.
- Ten rapid zoom steps settle to one final render generation; stale render tasks are cancelled.
- Search typing never blocks scrolling/chrome interaction.

## 11. P1/P2 — PDF feature and correctness gaps found during audit

These were not all explicitly reported, but they conflict with the repository's own “flagship” quality bar.

### 11.1 Current-page tracking

`PdfViewer.tsx:443-466` compares page rectangles against `window.innerHeight / 2`, not the actual scroller rectangle. Use the scroller's top/bottom and select the page with the greatest visible area or whose center is nearest the viewport center.

### 11.2 Position persistence

- Save after zoom/fit/rotation settles, not only after scroll.
- Clear the pending 500 ms timer on unmount.
- Persist fit mode and rotation if the product promises restoration.
- Clamp restored page to `[0, numPages - 1]`.
- Do not let late page-size corrections move the restored anchor.

### 11.3 Search

- Add debounce and page-text caching.
- Provide next/previous controls and visible hit index.
- Add on-page highlight geometry through the PDF text layer.
- Decide whether selecting a result dismisses/collapses the sheet. On a phone, a full-height sheet that leaves the target hidden is not useful.
- Announce progressive results without flooding live regions on every page.

### 11.4 Outline

`outlineItems()` renders only the provided nodes and ignores `node.items`. Render nested children recursively, preserve hierarchy, and support collapsed branches for long outlines.

### 11.5 Thumbnails

- Fixed `aspect-ratio: 0.707` distorts landscape and non-A-series pages.
- Size the tile from real page geometry and use `object-fit: contain` without stretching the canvas.
- Cancel thumbnail render tasks when their sheet closes or tile leaves range.
- Keep current-page selection visible when opening the sheet.

### 11.6 Text, links, and accessibility

Canvas-only pages do not provide the promised text selection/copy, link annotations, search highlights, or meaningful screen-reader structure. Add PDF.js text and annotation layers aligned to each canvas. Ensure transforms/rotation/output scale share one viewport source of truth.

## 12. P1 — dashboard/recents redesign

### 12.1 Current design issues

- `src/screens/Home.tsx:73-77` uses auto-fill cards with a 260 px minimum. On wider compact layouts, a single item remains a small card with a large dead region.
- Each item has only a format badge, one-line name, and metadata. There is no reading-progress cue, state cue, preview, or explicit overflow action.
- Important actions are hidden behind long press/context menu, which is low-discoverability on touch.
- Unavailable entries look identical to healthy ones until tapped.
- The header has weak brand hierarchy and no useful recent count/continuation context.

### 12.2 Recommended information architecture

Phone:

1. compact branded app bar with properly sized mark/wordmark and Settings;
2. optional “Continue reading” card for the most recent healthy document, showing format, real name, last position, and a clear Resume action;
3. `Recent files` heading with count and optional view/filter action;
4. full-width recent rows/cards with a 48–56 dp format/thumbnail area, two-line filename, concise metadata, progress, and visible overflow button;
5. FAB or prominent Open action that does not obscure the list.

Tablet/desktop:

- switch to a balanced 2–4 column grid only when cards can use the available width;
- cap content width thoughtfully but avoid leaving one card stranded in a huge blank column;
- retain consistent card heights and filename wrapping.

### 12.3 Interaction requirements

- Tap healthy item: reopen/resume.
- Tap unavailable item: repair sheet, not a generic late parser failure.
- Overflow: Pin/Unpin, File details, Locate again when relevant, Remove from recents.
- Long press may remain as a shortcut but must not be the only route to actions.
- Show position such as `Page 12 of 240` when known.
- Use real name first; metadata second. Do not repeat generic `Document` if a provider name can be recovered.
- Add skeletons while recents load so the dashboard does not flash between empty/content.
- Preserve calm visual style: fewer borders, clearer surface elevation, stronger spacing rhythm, and format color used as an accent rather than a large saturated block.

### 12.4 Dashboard acceptance criteria

- One, five, and fifty recents all produce balanced layouts at 360, 412, 768, and 1440 px widths.
- Filenames with 80 characters, Arabic/Urdu, emoji, and RTL content do not break card actions.
- A missing recent is visually distinguishable and repairable without losing its metadata.
- All actions are reachable by touch, keyboard, and screen reader.
- Empty, loading, content, partial/unavailable, and error states have visual tests.

## 13. P1 — Android launcher/app-menu icon

### 13.1 Root cause

`assets/brand/app-icon-foreground.svg:2` applies `translate(102.4 102.4) scale(0.6)` to artwork that already occupies only part of its 512 px source. The release workflow then runs that through Tauri icon generation and Android adaptive-icon masking. The extra safe-zone padding makes the visible mark too small.

### 13.2 Required asset pipeline

- Maintain two deliberate sources:
  - legacy/full icon: background + mark composed for square/rounded fallback icons;
  - adaptive foreground: transparent canvas with the mark only, sized for Android adaptive keylines;
- keep the adaptive background as a separate solid/color resource;
- remove accidental double padding; enlarge the mark until it reads strongly but survives circle, squircle, rounded-square, teardrop, and OEM masks;
- do not bake a rounded background tile into the adaptive foreground;
- generate all densities and verify the files copied by `patch-android-icons.mjs`, not just the checked-in preview assets;
- add a release check that fails if the foreground's non-transparent bounding box is implausibly small.

Acceptance: at launcher size, the Paperwren sheets mark should have similar visual weight to neighboring first-party icons and remain uncropped under common adaptive masks.

## 14. P1 — shared overlays and format consistency

### 14.1 Sheet/dialog behavior

- Register every open sheet/dialog with the navigation overlay stack.
- Back dismisses the top overlay before the screen.
- Add Escape handling to `Sheet`, matching `Dialog` on desktop.
- Trap focus within modal surfaces, restore focus to the opener, set an initial focus target, and hide inert background content from assistive technology.
- Cancel delayed dismiss timers on unmount and prevent double dismissal.
- Ensure drag-to-dismiss does not steal vertical scrolling from sheet content.

### 14.2 DOCX

- Replace nonstandard CSS `zoom` with a tested transform/layout strategy where possible; Android WebView behavior can vary.
- Keep first-page content clear of chrome through the shared viewport contract rather than a hard-coded 72 px padding.
- Do not force all paragraph text to near-black if authored content intentionally uses color; scope fallback color only to unset/default text.
- Add a loading state that does not render “Opening document...” inside the node that `docx-preview` immediately replaces.
- Add render cancellation/stale-result protection when switching files quickly.

### 14.3 XLSX/CSV

- Use shared chrome insets rather than `margin-top: 56px` and a global document CSS variable.
- Keep row labels sticky horizontally; verify current absolute row labels do not scroll out of view.
- Preserve per-sheet scroll and selection state when switching tabs.
- Add position persistence and meaningful Back behavior for the cell-details sheet.
- Ensure loading/error state content is not behind chrome.

### 14.4 Text/Markdown

- Apply top/bottom viewer insets.
- Avoid centering a `max-width` absolutely positioned Markdown body with `inset: 0; margin: auto` in a way that produces ambiguous width/overflow; give it `width: 100%` and an inner reading column.
- Treat external links explicitly and safely in the native shell.

## 15. P2 — persistence correctness and error taxonomy

### 15.1 Frontend write ordering

`RecentsContext` fires `storeSet()` calls without serialization. Rapid open/position/pin events can complete out of order and persist stale arrays. Add a per-key write queue or move mutation/serialization behind one backend command.

### 15.2 Rust atomic temp-file collision

`src-tauri/src/lib.rs:61-76` writes every store key through `.PID.tmp`. Concurrent writes for settings and recents can target the same temporary path. Use a temp path unique to the destination key and write generation (or a proper atomic-write crate), then rename with platform-appropriate replacement semantics. Serialize mutations per store if necessary.

### 15.3 Typed failures

The viewer currently maps any `readBytes` rejection to `File not found`. Introduce typed errors:

- `not_found`;
- `permission_revoked`;
- `provider_unavailable`;
- `read_failed`;
- `unsupported`;
- `corrupt`;
- `out_of_memory`;
- `cancelled`.

Each error needs one clear recovery path. Cancellation during Back/file switch must never show an error dialog.

## 16. Implementation order

### Phase A — foundations (must land first)

1. Introduce `IngestedDocument`, reopen descriptors, and recent migration.
2. Build unified native ingestion for picker and open-with.
3. Query real Android display name/size and make file copies asynchronous.
4. Implement managed-copy/persisted-URI lifecycle and typed reopen errors.
5. Add the central screen/overlay navigation reducer and Android Back bridge.
6. Add integration tests for process restart and Back.

Exit gate: real names and durable reopen pass on device; viewer/settings Back never exits early.

### Phase B — PDF interaction correctness

1. Fix overflow layout so all page edges are reachable.
2. Extract/test page-local anchor math.
3. Rebuild pinch, wheel, button, fit, and double-tap zoom around the same anchor transaction.
4. Persist settled zoom/fit/position.
5. Standardize shared viewer insets and remove obstructive coach behavior.

Exit gate: all focal zoom and four-corner pan acceptance tests pass at multiple orientations/sizes.

### Phase C — performance and flagship fidelity

1. Move PDF loading to a URL/range or single-buffer ownership path.
2. Add render scheduler, generations, and cancellation.
3. Make page geometry, thumbnails, and search lazy/prioritized.
4. Add text and annotation layers, highlights, nested outlines, accurate thumbnails.
5. Profile scanned PDFs on low-end Android hardware.

Exit gate: performance budgets and memory plateau pass.

### Phase D — dashboard, icon, and cross-format polish

1. Redesign dashboard states and recent-item interactions.
2. Rebuild adaptive/legacy icon sources and validate masks.
3. Move DOCX/XLSX/Text/Markdown onto shared viewport and overlay contracts.
4. Complete keyboard, focus, screen-reader, RTL, and reduced-motion QA.

Exit gate: responsive visual regression suite and device UX checklist pass.

## 17. Required automated tests

### 17.1 Unit tests

- page-local focal anchor before/after zoom;
- anchor preservation with mixed page sizes and rotation;
- horizontal scroll bounds and centering math;
- zoom/fit state transitions and labels;
- recent migration from every old schema shape;
- stable document identity/deduplication;
- typed error mapping;
- navigation reducer Back priority;
- storage write serialization.

### 17.2 Browser/component tests

- open PDF, zoom at point, assert same page-local coordinate remains under point;
- 400% zoom reaches all page corners;
- toolbar does not cover first/last content;
- sheet Back priority and focus restoration;
- settings subpage Back sequence;
- search debounce/cancellation and result jump;
- nested outline rendering;
- landscape thumbnail ratio;
- dashboard responsive states and long/RTL filenames.

### 17.3 Android instrumentation/device tests

- picker from a test `DocumentsProvider` with opaque URI but explicit `DISPLAY_NAME`;
- persisted URI reopen after activity recreation, process death, and reboot simulation where feasible;
- non-persistable share/open-with grant falls back to managed copy;
- hardware and gesture Back across the full matrix;
- second open-with while viewer A is active stacks viewer B;
- asynchronous large-file ingest keeps main thread responsive;
- adaptive icon screenshots under several masks;
- low-memory scanned-PDF scroll/zoom stress.

### 17.4 CI changes

- Add component/E2E tests; pure helper tests alone cannot catch the reported failures.
- Add the Android native patch tests for display-name query, async ingestion structure, and Back bridge.
- Add an icon foreground bounding-box check.
- Add a store concurrency test.
- Keep Markdown-only audit commits from triggering a release, but application changes from this plan must run all gates.

## 18. Manual release checklist

- [ ] Real filename shown from Downloads, Drive, WhatsApp, Files, and Share.
- [ ] Every new recent reopens after process kill.
- [ ] Viewer Back → previous screen; Home Back → exit only.
- [ ] All PDF overlays dismiss in reverse order.
- [ ] Pinch, wheel, buttons, and double-tap preserve their intended focal point.
- [ ] All four corners of a 400% page are reachable.
- [ ] No toolbar covers opening content in any viewer.
- [ ] No coach message demands a tap or repeatedly blocks reading.
- [ ] 100 MB scanned PDF shows progress and remains responsive.
- [ ] Search/thumbnail work does not starve visible page rendering.
- [ ] Dashboard looks balanced with 0, 1, 5, and 50 files.
- [ ] Missing recent has repair/remove flow.
- [ ] Launcher icon has strong visual weight under common masks.
- [ ] TalkBack labels/order, keyboard focus, RTL, rotation, and reduced motion verified.
- [ ] Cache/storage UI accurately describes what is disposable versus required for reopening.

## 19. Guardrails for the implementation model

- Do not “fix” real filenames by inventing smarter generic labels. Retrieve provider metadata.
- Do not store another temporary URI in the same `source` field. Separate identity and reopen mechanism.
- Do not solve Back with scattered event listeners in each component. Use one ordered navigation/overlay owner.
- Do not solve focal zoom with a global document scroll ratio. Anchor to a page-local point.
- Do not solve left-edge panning by adding arbitrary padding or negative transforms. Fix the overflow containing block.
- Do not hide overlay problems by disabling Back or auto-hide.
- Do not improve scanned-PDF performance only by lowering canvas resolution. Remove full-file copies, cancel stale work, and prioritize visible pages.
- Do not delete old recents silently during migration.
- Do not clear reopen-critical managed copies under a control labeled only “Clear cache.”
- Do not redesign the dashboard before the recent data contract is trustworthy.
- Preserve unrelated local files and changes. In particular, the pre-existing untracked `scripts/debug-line.mjs` was not part of this audit.

## 20. Definition of done

The work is done only when all of the following are true on a real Android device:

1. Files keep their real names and recents reopen after process death.
2. System Back, gesture Back, toolbar Back, and overlay dismissal follow one predictable stack.
3. PDF zoom remains anchored and every zoomed page edge is reachable.
4. Viewer chrome never hides the first or last meaningful content.
5. Large scanned PDFs remain responsive with bounded rendering work and memory.
6. Dashboard, icon, and cross-format viewers meet the visual/interaction acceptance criteria.
7. Automated tests cover the reported regressions, and the manual release checklist passes.

