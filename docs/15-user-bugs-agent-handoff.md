# User-reported Android issues: implementation handoff

Date: 2026-09-06. Source package version: 0.9.18.

## Scope and evidence

The user initially said two issues but described four; address all four below. This is a quick static source audit, not a device reproduction or a completed fix. The screenshot shows repeated `Document.pdf`, `Document.docx`, and `Spreadsheet.xlsx` entries. It does not establish the installed APK version. No application code was changed and no tests were run for this audit. Existing comments describing previous fixes are not proof those fixes work in the installed app.

First establish the installed version/build and the exact source revision used to produce the APK. Current source already contains attempted fixes for filenames, opening visibility, and DOCX zoom. Preserve unrelated working changes, including the pre-existing untracked `scripts/debug-line.mjs`. Do not clear user history/imports to make tests pass.

## 1. History loses the original filename — high priority

**Expected:** Picking `Quarterly budget.pdf` displays that exact provider name in the viewer, Recent files, and Continue reading, including after restarting.

**Source evidence:**

- `src/lib/backend.ts`, `tauriBackend.pickFile`: extracts the final URI segment, then tries `window.__paperwrenAndroid.displayName(path)` and `contentSize(path)`. If the bridge is absent/fails, an opaque content URI often leaves a numeric name.
- `src/lib/sniff.ts:94`, `displayNameFor`: every name without a dot becomes a generic format label. This also incorrectly discards legitimate extensionless provider names.
- `src/screens/viewer/ViewerScreen.ts:137`: stores that fallback through `recordOpen`. Home is displaying stored metadata; changing only Home labels cannot recover the name.
- `scripts/patch-android-openwith.mjs:213`, `installNameBridge`: waits for a WebView at an app origin before calling `addJavascriptInterface`. Verify whether this late registration is available to the already loaded document on the target WebView; do not assume successful registration means the JS object is immediately visible.
- `scripts/patch-android-openwith.mjs:334`, `patchMainActivity`: returns immediately if the generated activity contains `handleIncomingIntent`. **Confirmed patch-upgrade defect:** an older patched activity can skip all new bridge additions and validation. A clean-template dry run does not test upgrading an existing activity.
- `.github/workflows/release.yml:205` invokes the patch before Android build; inspect the generated activity actually compiled, not just the fixture/template.

**Implementation steps:**

1. Capture whether the bridge exists immediately after cold start and after selecting a file. Compare provider DISPLAY_NAME, picked metadata, resolved viewer name, and persisted recent name.
2. Make metadata retrieval reliable before returning picker metadata. Prefer an asynchronous native metadata command/plugin if late JS-interface registration is unreliable. Keep provider calls off the UI thread where practical; handle null/missing metadata explicitly.
3. Distinguish a verified provider display name from a URI fallback. Preserve real extensionless names; sniff bytes for format independently. Do not infer metadata reliability solely from whether the string contains a dot.
4. Make the Android patch safely upgrade older patched activities and remain idempotent. Test clean, old-patched, and current-patched fixtures. Never blindly duplicate methods/imports/hooks.
5. For existing generic recent names, re-query metadata on successful reopening when the descriptor supports it, updating the existing entry without losing position/pin state. Do not invent lost filenames or require clearing recents. Managed copies may no longer retain enough metadata to recover an old original name.

**Acceptance:** Test picker and external Open with, local/cloud providers, opaque numeric URI, Unicode/spaces, extensionless name, metadata failure, and two different files. Check viewer + both Home surfaces and restart persistence. Verify old generic entries heal where metadata remains available.

## 2. Opening appears stuck until theme changes — highest investigation priority

**User reproduction:** Select/open PDF or another document; nothing visibly opens. Navigate to settings and change theme; the document appears. Repeated on the user's device. Exact root cause is **not established** by this static audit.

**Relevant code and concrete clues:**

- `src/App.tsx`, `pickAndOpen`: awaits picker then opens viewer immediately, before the viewer reads bytes. It uses `finally` but has no `catch`; picker/metadata rejection can produce an unhandled failure and no helpful UI. Also `picking` is internal and does not provide a visible opening indicator on Home.
- `src/screens/viewer/ViewerScreen.ts`, read effect: asynchronous read -> sniff -> data/format state -> parser viewer. Instrument these boundaries separately.
- `src/state/RecentsContext.ts`, `recordOpen`: callback depends on the entire `settings` object. The ViewerScreen read effect depends on `recordOpen`; therefore changing theme changes that callback and can restart reading. **Confirmed unnecessary dependency coupling; not proof it caused the reported stall.** Narrow dependencies to relevant recents settings and ensure ingestion does not restart on appearance changes. Preserve cancellation and fresh bytes for PDF password retries.
- `src/screens/viewer/ViewerShell.ts:26`: the shell already intentionally has no entrance animation; its comment describes Android picker-related opacity/animation freezing. Do not submit removal of an animation already removed. Inspect ancestors and opening surfaces for remaining opacity, transform, animation, stacking, or visibility problems.
- `src/state/NavigationContext.ts`: `openViewer` dispatches a reducer action directly. `src/lib/navigation.ts` returns a new screen array. No obvious missing React state update was found here.
- External opens follow a separate route: native `deliverPendingFile` -> inline `window.__paperwrenOpenFile` in `index.html` -> `paperwren-file` -> queue drain in App. Native copy failures currently have a silent catch, and delivery has a retry cap. Inspect emitted Kotlin/JS and acknowledgement values if this route fails; a template text check alone is insufficient.

**Investigation and implementation:**

1. Reproduce on an Android build matching source; separately test picker, recent, and external open, cold/warm start, and return from background. Include slow/large files and unavailable providers.
2. Add temporary timestamped diagnostics with a per-open request ID: picker launch/result, metadata completion, navigation dispatch/commit, viewer mount, byte read start/end, sniff result, parser start/ready/error, and first visible content. Avoid logging document contents.
3. At the stall, inspect navigation debug state, viewer DOM presence, computed visibility/opacity/transform/z-index and bounds, document visibility, and outstanding read/parser work. Compare just before/after theme change. This distinguishes missing navigation, pending I/O, repeated ingestion, and a paint problem.
4. Fix the demonstrated failing boundary. Show immediate opening feedback once a selection is accepted, visible recoverable errors for rejected picker/read/native operations, and prevent stale completions from replacing a newer request or reopening a closed screen.
5. Do not use forced theme changes, arbitrary polling, repeated remounts, or random delays as a fix. A slow provider needs honest progress/error behavior, not a guaranteed unrealistically short timeout.

**Acceptance:** No settings interaction is needed. A controlled delayed read shows loading then content; failures show an actionable error. Changing theme during/after loading does not reread/reparse the document unnecessarily or lose position. Repeat opens and background/resume on a real Android WebView. Browser tests alone cannot certify this device symptom.

## 3. PDF tools hide and cannot be restored — confirmed structural bug

**Evidence:** `src/screens/viewer/PdfViewer.tsx:286` calls `useViewerChrome()` inside PdfViewer, but PdfViewer itself returns the `ViewerShell` containing the provider. React context only resolves providers ABOVE the calling component, not a provider it returns below itself. The ordinary ViewerScreen -> PdfViewer tree has no enclosing chrome provider.

`ViewerShell.tsx:134` supplies default no-op `toggleChrome`/`showChrome` and an always-true `isChromeVisible`. `PdfViewer.tsx:1018–1021` uses those defaults in its touch tap handler. Meanwhile the real shell can hide its tools with its 2500ms timer. Its own pointer-up handler explicitly handles only mouse input. Consequently touch cannot restore the real hidden toolbar through this path. Mouse testing can misleadingly pass.

**Fix:** Establish one chrome controller shared by the shell and PDF gestures. Either lift controller state into a provider above both consumers or split the PDF shell wrapper and descendant gesture/content component so the hook executes below the provider. Do not add a second unrelated visibility state. Consider a context default that throws outside the provider once all consumers are placed correctly, preventing silent no-op regressions.

Retain pointer gesture arbitration: a single tap toggles once; a hidden toolbar can return promptly; double-tap zoom, pinch, pan, selection, and links must not produce extra toggles. Preserve hold behavior during overlays/loading and `inert` handling for hidden controls. Verify timer cleanup and rescheduling after restoration.

**Acceptance:** Real touch input: let auto-hide happen, tap to restore, repeat five times; tap-hide then tap-show; repeat with auto-hide disabled. Test mouse separately. Pinch/pan/double-tap do not accidentally hide tools. Search/tools/password overlays keep controls usable. Add a touch-enabled integration test that asserts the actual header's visibility and interactivity, not just a mocked callback.

## 4. DOCX zoom is not accessible to the user — verify current build/layout

**Source already has the feature:** `src/screens/viewer/DocxViewer.tsx:608–624` renders Zoom out, Zoom in, and Fit width, with test IDs `docx-zoom-out`, `docx-zoom-in`, `docx-fit-width`. `stepZoom` around line 240 changes scale by 1.25; the document container uses CSS `zoom` around line 61. Chrome auto-hide is disabled for DOCX. Do not claim zoom is absent in this source or implement a second zoom engine.

**Next steps:** Verify the APK includes these controls. At 320/360/384 CSS-pixel widths, landscape, long filenames, and larger font settings, check whether the fixed top actions fit and remain clickable. Inspect ViewerShell TopRow/TopActions sizing. If they do not fit, use a discoverable Tools menu or appropriate compact layout, keeping zoom in/out/fit available. Verify CSS zoom actually changes document dimensions in the supported Android WebView. Global browser pinch is disabled by `index.html` viewport settings; browser pinch is not a substitute for accessible document controls.

Preserve existing anchor correction, fit-width behavior, mixed portrait/landscape page widths, search alignment, and saved position. If current build works, document the build mismatch and validate a rebuilt APK rather than rewriting working code.

**Acceptance:** Open a multi-page DOCX on a narrow phone. Zoom in visibly enlarges text, zoom out reverses it, and Fit width restores the fit. Controls stay reachable, enlarged content is pannable, last page remains reachable, and zoom does not blank or rerender the document incorrectly.

## Validation and delivery checklist for implementing agent

1. Read applicable repository instructions; inspect current files before editing because line numbers can move. Keep scope to these four user issues.
2. Prioritize the definite PDF provider defect and filename patch defect; investigate the opening stall with evidence rather than guessing. Verify existing DOCX behavior.
3. Extend relevant tests: `src/lib/__tests__/sniff.test.ts`, navigation tests, `tests/e2e/narrow-toolbar.spec.ts`, `pdf-zoom.spec.ts`, and `docx-lifecycle.spec.ts`. Add delayed-read/appearance-change coverage and native patch-upgrade coverage where appropriate.
4. Run `npm test`, `npm run build`, and `node scripts/patch-android-openwith.mjs check`. Follow `playwright.config.ts` setup for targeted Playwright tests; @playwright/test is not declared in package.json, so do not silently churn package-lock just to run it. A patch dry run is not Android compilation or device verification.
5. Build/validate Android if the environment supports it. Report unavailable device checks explicitly. Preserve history and user files.
6. Deliver changed files, demonstrated root causes, tests actually run/results, APK/build identity when applicable, and any still-unverified symptoms. Do not mark all four fixed based solely on compilation or prior implementation reports.
