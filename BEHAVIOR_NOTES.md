# Behaviour notes

What changed in how Paperwren behaves, flow by flow, for reviewers and testers. Written 2026-11-16 for the performance, UI and state-machine project on `px/main`.

How to read an entry:

- **Before** is what the app did before the change, recorded from the implementation reports (`audit/px/REPORT-*.md`) and the commit messages. It is the behaviour of 1.8.0 unless the entry says otherwise.
- **Now** is what the code does on `px/main`.
- **Visible change** says whether a reader can notice it.
- **Confirm on** lists where it still has to be checked. Everything in this file was checked at most in the Vite dev server in headless Chrome. Nothing here has been run in a packaged desktop app or on a phone unless an entry says so. "Windows release" means a CI-built Windows installer; "phone" means an Android device.

Item ids (0.1, 4.3, SM-01, X-04, U-13, P-04, M-2 and so on) point to `audit/px/PLAN.md` and the audits behind it. Commit hashes are on `px/main`.

Contents: [start-up and window](#start-up-and-window), [memory and tabs](#memory-and-tabs), [rendering](#rendering), [reading position](#reading-position), [close paths and unsaved work](#close-paths-and-unsaved-work), [recents and toasts](#recents-and-toasts), [stored values](#stored-values), [scan](#scan), [notes](#notes), [tools](#tools), [settings](#settings), [keyboard and shortcuts](#keyboard-and-shortcuts), [accessibility and contrast](#accessibility-and-contrast), [motion](#motion), [build and packaging](#build-and-packaging).

---

## Start-up and window

### Window placement (2.1, B-2; `952fcf3`)

- **Before:** the window was created visible at 1080 by 780. The page then read its saved place from the store, checked the monitors, resized, moved and maximised it. Measured on 1.8.0 for Windows: the window jumped to its saved place at about 800 ms and maximised about 50 ms later. The first render waited about 159 ms for that chain, or 400 ms at most.
- **Now:** the desktop window is created hidden (`visible: false` in the Windows, macOS and Linux configs; Android is untouched). In setup, `src-tauri/src/placement.rs` reads `store/window.json` (the same file and format as before, so saved places carry over), checks the place against the current monitors with the same rule (physical pixels, enough of the title bar on a screen), moves, sizes, maximises if it was maximised, and shows the window. A place on no screen keeps the default size, centred. If anything fails the window is shown anyway, and a thread shows it after 1.5 s if the first show did not work. The page no longer waits for placement before its first render. `windowState.ts` still saves the place on move and resize (500 ms debounce).
- **Visible change:** yes. No jump, and Home is expected about 150 ms sooner.
- **Confirm on:** Windows release (no jump, shortcuts work without a first click, Explorer double-click opens a file both when the app is closed and when it is running, a second monitor with another DPI, restart after a monitor is unplugged). macOS (a maximised window's zoom may animate after show). Linux (X11 and Wayland). The hidden window must always appear: test with a corrupted `window.json`.

### First colour of the window and page (2.1, U-13; `ba6b600`)

- **Before:** on Windows the window was a fixed cream (`#e7e4dd`) until the page painted, and the page applied the saved theme only after settings loaded, so its first paint used the default light theme. A dark or "system on a dark PC" reader saw a light window for 0.9 to 1.0 s before the dark Home (6 recordings at 29 fps).
- **Now:** before showing the window, `placement.rs` reads the theme from `store/settings_v2.json` (retired names mapped; "system" resolved against the system's dark mode as `settings.ts` does) and gives that theme's `--bg` to the window and webview on Windows, and to the webview on Linux. macOS is left as it was (a WKWebView background colour needs a private key). `index.html` has a small inline script in the head that reads `localStorage["paperwren.theme-hint"]` and sets `data-theme` before anything is painted. `SettingsProvider` starts from the hinted theme and keeps the hint written whenever the theme is known or changes. Tauri adds a hash for the inline script to the CSP, as it does for the open-with script already in that file.
- **Visible change:** yes, for dark and system-dark readers: no light flash.
- **Confirm on:** Windows release (first frame in the theme colour, both a themed and a "system" start). Linux. macOS: the webview may still be white before first paint. Known limits: the very first start after this update has no hint (once); a theme changed in a session leaves the native colour at the start theme until restart; a custom theme (if added) needs its colour known to Rust.

### Managed-copy sweep (2.4, P-25; `c2fd3f6`)

- **Before:** the sweep that deletes imported copies no longer in recents ran straight after recents loaded.
- **Now:** it runs when the browser is idle (`requestIdleCallback`, with a 4 s timer fallback), is cancelled on cleanup, and reads the current recents when it starts.
- **Visible change:** no.
- **Confirm on:** Windows release and phone: imported copies of removed files still go; no file opened right after start is lost.

### Settings loads on demand; viewer tools load on demand (2.2, 2.3; `d5d6399`, `91a68ce`)

- **Before:** the entry chunk held Settings, the file menu and, through them, signature and marks code; the PDF chunk held Fill and sign, Mark up and Read text. The signature marker was searched for across the whole file on the main thread before the worker started.
- **Now:** Settings is lazy (empty Suspense fallback, warmed after Home). Home's file actions and rename UI sit in their own modules. Fill and sign, Mark up and Read text load when opened. The signature scan runs after the first page, on worker-owned bytes in overlapping 64 KiB slices; editing or saving a marked copy waits for its result.
- **Visible change:** barely. The first open of Settings or a tool may show a very short empty moment.
- **Confirm on:** Windows release and phone, on a slow connection to storage: open Settings at once after start; open Fill and sign, Mark up and Read text on a PDF; open a signed PDF and edit it straight away (it must wait for the scan, then behave as before); a 22 MB PDF.

### Tauri 2.12 patch updates and wry 0.57.2 (0.2; `7a233a8`, `edd5e2d`)

- **Before:** tauri 2.12.0, wry as locked before. A drag-region click could lose its mouse-up.
- **Now:** lock-only updates (tauri 2.12.5 and related crates, wry 0.57.2, updater 2.13.3). No `Cargo.toml` change.
- **Visible change:** no intended change.
- **Confirm on:** Windows release, macOS, Linux, phone: window drag and double-click on the title bar, GTK resizing, updater check and install, Android lifecycle.

---

## Memory and tabs

### A closed PDF lets go of its pages (1.1, B-1; `255dd80`)

- **Before:** closing a PDF left all its pages alive: each open and close added about 2,100 detached DOM nodes and about 14 MB (4.5 GB after 10 minutes of scripted use). The viewer never released the document in pdf.js, so a `copy` listener on `document` and pdf.js's static text-layer map kept every page.
- **Now:** the viewer's cleanup calls `setDocument(null)`, clears the link service's document and passes pdf.js's `abortSignal`, which ends the viewer's scroll listener and `ResizeObserver`.
- **Visible change:** no.
- **Confirm on:** Windows release (repeat the 255-page open-and-close loop; nodes must stay flat), phone (many opens and closes).

### Hidden PDF tabs release their pages; kept tabs count bytes (1.3, P-04; `677e817`)

- **Before:** up to four tabs behind the shown one kept their document, every drawn page's canvas, text layer and links, and a worker. The only limit was the count of four. Memory did not come back after closing tabs.
- **Now:** ten seconds after a PDF tab is hidden (behind another tab or under Settings), each drawn page is destroyed the way pdf.js's own page buffer does it. The document, layout and scroll position stay. When the tab is shown again, the visible pages are drawn again. Switching between two documents within ten seconds redraws nothing. Kept tabs are still the latest four, but they also stop at about 200 MB between them (24 MB plus twice the file size per tab); the most recent is always kept. A tab left out reopens where it was left, as a fifth tab did before.
- **Visible change:** yes. An old tab may redraw its pages for a moment when revisited (approved). With large PDFs, fewer tabs stay alive.
- **Confirm on:** Windows release. Pre-existing and unchanged: an evicted tab reopens about one page lower. New: marks on a password-protected PDF are in memory only, so they are lost if its tab is evicted (this was already true for a fifth tab). Leave guards (below) keep a tab with such marks drawn.

### Attachments, picture URLs and the HEIC decoder (1.2, P-08, P-09, P-10, SM-23; `271301f`)

- **Before:** a file opened from a PDF's attachments stayed in a module map until exit; a fallback picture URL was created outside the effect that would revoke it; the HEIC worker was never ended (still alive 60 s after the picture closed).
- **Now:** the HEIC worker ends after its last queued result and is recreated on demand. Attachment ownership is tracked across desktop tabs, phone screens and tool handoffs, and the bytes are deleted after the last owner leaves (keys are monotonic). One effect owns the original and fallback picture URLs, revokes replaced ones and ignores late decode results.
- **Visible change:** no.
- **Confirm on:** Windows release and phone: open an attachment, close its tab, check memory; open a HEIC picture and several others; hand an attachment to a tool and back.

### Presenter clock (3.5, P-27; `6ced253`, `1fbdbae`)

- **Before:** the presenter's clock ticked while paused (2 state updates a second).
- **Now:** the clock runs only while presenting, unpaused, with the viewer active and the page visible. It ticks every 500 ms so seconds never repeat or skip. It restarts and refreshes on visibility change; elapsed time still counts hidden time.
- **Visible change:** no.
- **Confirm on:** Windows release and phone (screen off and on during a slideshow).

---

## Rendering

### Resize (3.1, M-1; `fb1745e`)

- **Before:** the root component read the raw window width, so every resize event redrew Root, Home and every kept document. The window buttons and full screen each asked `is_maximized` and `is_fullscreen` on every event (126 IPC calls in a 2 s drag).
- **Now:** Root reads only what side by side needs (where the halves meet, whether each is narrow), so it changes only when one of those does. Home and each document sit behind a memo with stable props. The maximise icon and full screen ask the window once as a resize starts and once 150 ms after it settles (`src/lib/settle.ts`).
- **Visible change:** no, apart from smoother resizing.
- **Confirm on:** Windows release: the maximise and restore icon is right after dragging, double-clicking the title bar, Win+arrow snapping and keyboard maximise (the icon now updates at burst edges). Split view still follows the window width; a window too narrow for two documents.

### Providers split into state and actions (3.2, M-2; `9abd748`, `50541cc`, `7c22ba7`)

- **Before:** settings, recents and navigation were each one context value; every change redrew Root, Home and every kept document. Opening any menu registered with Back and redrew everything; the file context each document handed to its bar and viewer was a new object on each render. The PDF view read every setting.
- **Now:** settings, recents and navigation are small stores (`src/state/store.ts`) with narrow hooks. Old hooks still work. Navigation gives three contexts (actions, screens, whole state). The viewer's file context is memoised. The PDF view reads its six settings and the theme only (`useTheme` follows the theme setting and the device's dark mode).
- **Visible change:** no intended change. A missed subscription would show stale UI.
- **Confirm on:** Windows release and phone: change theme, language, page colour, reopen-last and custom keys, and check Home and a kept tab behind both follow (a custom key applies on the very next press). Browser Back, Android Back and Esc close a menu first, then the document. Side by side, focus by click. A theme change in Settings reaches a PDF kept behind it when paper is set to match the theme.

### Workbook scrolling (3.3, P-16; `741814b`)

- **Before:** grid state followed every scroll event.
- **Now:** at most one scroll sync per animation frame; state is set only when the visible row or column bounds change. Pending frames are cancelled on geometry change and unmount. Saved scroll position still reads the real scroller.
- **Visible change:** no intended change.
- **Confirm on:** Windows release and phone with a large XLSX: scroll fast, no blank window; pinch and frozen panes.

### Overlay opening (M-2; `50541cc`)

- **Before:** opening the file menu redrew about 800 components (770 ms at 6x in the dev server).
- **Now:** about 90 (292 ms). See PERFORMANCE.md section 6.
- **Visible change:** menus open faster on weak machines.
- **Confirm on:** a weak Windows PC if available.

---

## Reading position

### Position held apart and written less often (3.2, P-12; `3dafcc9`)

- **Before:** each pause while reading (400 ms after scrolling stops) replaced the whole recents list in context and wrote it (14.4 KB; a read first on desktop). Home, Root and every open document redrew at each pause.
- **Now:** `setPosition` keeps the position apart; `positionOf(id)` reads it. All pending positions go into the list together, in one change and one write: when the document stops being the one on show (another tab, Home, Settings, closing it), when the app is put away (`visibilitychange` to hidden, `pagehide`), or after 5 s without a new position. So that a window closed within those seconds still reopens where the reader was, each kept position is also noted in one `localStorage` key, taken off once the list holding it is written, and put in the list at the next start. A rename moves a kept position to the new id.
- **Visible change:** no. Home shows the new page at once when you go Home.
- **Confirm on:** Windows release (close the window by the X within 5 s of scrolling and reopen: same page; check the `localStorage` key survives a WebView2 close), phone (background the app, kill it, reopen; `visibilitychange` on backgrounding), Linux and macOS (quit with Cmd+Q).

---

## Close paths and unsaved work

### One "can I leave?" check for every close path (4.1, SM-01; `666dcfc`)

- **Before:** Ctrl+W, the tab X and Back on the reader dropped unsaved work without asking (confirmed in code). Only the bar's close arrow, or Back for Fill and sign and Mark up, reached a guard.
- **Now:** `src/state/leave.ts` is one registry. A screen or tool with unsaved work holds a guard in its scope (a document tab or one screen of the stack). Every way out asks the guards of what it takes away: system Back, Alt+Left, the mouse back button, back arrows, Ctrl+W on a screen, the tab X, middle-click and Delete on a tab, "Close others" and "Close after", Back from a tool to the tools list, and on desktop the window closing (`onCloseRequested`, held only while something would be lost, then `destroy()`). A guard shows its own existing "Leave without saving?" dialog (Fill and sign, Mark up, the PDF reader) or the shared one in `ui/LeaveHost`. Discard runs the leaving that was asked for. A tab with work is brought into view before its question and stays drawn when more tabs are opened. Guards: Fill and sign (filled fields, added items), Mark up and the PDF reader (marks on a password-protected file), Organize pages (new order not saved), Scan (pages not saved), the Notes editor (writes the note first; holds if that write fails). New permission: `core:window:allow-destroy` in `desktop.json`.
- **Visible change:** yes: a question appears where work was lost silently.
- **Confirm on:** Windows release: close the window with unsaved Fill and sign work (X button, Alt+F4, taskbar close), choose Keep editing and then Discard. macOS: Cmd+W, Cmd+Q and the red button. Linux. Phone: system Back and the gesture with a password PDF highlight, Back again closes the question; Android "back to the app that opened it". Check that a locked-file tab is not evicted while it holds marks.

### One keyboard-owner check (4.1, SM-07; `666dcfc`)

- **Before:** with Fill and sign or Mark up open, Ctrl+O opened a new tab underneath, and Ctrl+W and the viewer zoom keys reached the document under the tool. Past four tabs the editor's tab could be unmounted with its work. Mark up's Ctrl+Z and Ctrl+Y still worked while its Save or Leave question was open.
- **Now:** `ownsKeys(depth)` in `src/ui/Overlay.tsx` is the single check. Ctrl+O and Ctrl+W act only with nothing over the app; zoom keys do not reach a document under a modal tool; Mark up's undo keys stop while its question is open.
- **Visible change:** yes, in those cases the keys do nothing.
- **Confirm on:** Windows release, macOS, Linux: each key with a dialog, menu, Fill and sign and Mark up open.

---

## Recents and toasts

### Recents wait for their first read (4.3, SM-03; `1062171`)

- **Before:** a change asked for before the stored list had been read (record, unavailable, pin, rename) was applied to an empty list and, on a phone, written over the whole stored list.
- **Now:** such a change is held and made once the list is read, on the list as stored.
- **Visible change:** no (the race is rare).
- **Confirm on:** phone: open a file from another app at launch; the recents list keeps all old entries.

### Desktop focus refresh (SM-03; `1062171`)

- **Before:** a read of the store that a local change overtook replaced the list, so the change disappeared from the UI until the next focus.
- **Now:** such a read is dropped and read again after that change's write.
- **Visible change:** no.
- **Confirm on:** Windows release with two windows: pin or remove in one, focus the other.

### Undo and the stored copy share one lifetime (4.3, X-02; `1062171`)

- **Before:** Remove and Clear released managed copies and Android URI grants after a fixed 6 s timer, while the Undo toast stayed up as long as it was held (pointer, keyboard or TalkBack focus). Undo after that restored an entry that would not open.
- **Now:** remove and clear keep the copies and grants until the list is restored (Undo) or settled (the Undo message went: the toast's `onExpire`). Callers with no Undo (Remove in the open-error dialog, a broken first open, Locate) settle at once. Recents turned off from another window keep the 6 s timer.
- **Visible change:** yes: Undo always works while it is on screen.
- **Confirm on:** phone with TalkBack: remove a file shared into the app, hold focus on Undo past 6 s, activate it, open the file. Also Settings, "Clear recents", then Undo.

### Toasts do not erase an Undo (4.3, X-19; `1062171`)

- **Before:** any newer message replaced a toast that had an Undo.
- **Now:** a message with an action steps aside for a newer message and comes back with the time it had left (at least 2.5 s). Only a newer message of the same words ends it. At most two wait. `toast()` takes `action.onExpire`, called once when the message goes without its action being taken.
- **Visible change:** yes: "Removed from recents" can come back after another message.
- **Confirm on:** all platforms with a screen reader (the persistent polite region announces each message once).

---

## Stored values

### One helper for stored values (4.4, 3.4; `8f96266`, `9f3b006`)

- **Before:** early changes could overwrite stored data (settings wrote defaults plus one key over the stored settings if changed before the first read); bookmark changes were not serialised; a slider wrote once per step (10 writes for 10 steps); a failed write was silent. `backend.storeSet` resolved whatever happened, so the existing failure paths never fired.
- **Now:** `src/lib/storedValue.ts` (`createStoredValue`) gives each value a load gate, one queue (reads and writes one after another), one trailing write per burst (settings: 250 ms), writes applied to the value as stored when it is shared between windows, and a refresh that is dropped when a local change is on its way. A failed write keeps its changes waiting, is said once through `onStoreFailed` with Try again (a toast, "Couldn't change saved data"), and is tried again when the app is put away (`pagehide`, `visibilitychange`). `storeSet` now rejects on failure (`createCheckedWriter`). Stored formats and keys are unchanged; existing data loads as before. Adopted by:
  - **Settings** (SM-11, M-4): ten slider steps make one write.
  - **Bookmarks** (SM-12): clearing and its Undo write at once and fail as a whole.
  - **Saved folders** (SM-13): `add()` after the picker reads the list as it is then.
  - **Kept signatures and stamps** (X-18): "Forget kept ..." and Undo go through them; a failure is said.
  - **Document marks** (SM-14, X-03): nothing is written before the marks are read; a mark made sooner is added to them; the write for the document left is made in an effect, not during render; a failed write keeps the marks unsaved and says so, with Try again.
  - **Recents** (X-18): a failed write is said; reading positions stay in their local fallback until the list with them is written.
- **Visible change:** yes: a failed save now shows a message with Try again. Otherwise none.
- **Confirm on:** Windows release (full disk or read-only store, if you can fake one), phone (storage full), Linux. Two windows on desktop: change a setting in each.

---

## Scan

### Save waits for finished pages; leaving stops the queue (4.2, SM-02, SM-16; `4516ee8`)

- **Before:** Save read a ref that was updated only at React render, so it could fail while a page was still being made. Leaving the tool revoked thumbnails but left queued decoding and rendering running. Closing a scan job terminated its worker without settling its pending requests.
- **Now:** the page ref is updated synchronously; Save waits for the queue. Queued work checks that the tool is mounted at decode, detection and render boundaries; active and queued render jobs close on unmount; Save returns without handing off a file after unmount. `ScanJob.close` rejects the current request, and queued requests reject on reaching the closed worker. In the dev server, Save clicked at "Finishing 2 pages…" with delayed renders produced one 10,041-byte PDF, and a five-page batch stopped after its first render on leaving.
- **Visible change:** no, apart from Save working in that moment.
- **Confirm on:** phone (camera, Back, native save) and Windows release. A decode already running finishes before the check; later work stops.

### Scan holds a leave guard (4.1)

- **Before:** closing with unsaved pages was silent.
- **Now:** Back, Ctrl+W and the tab X ask "Leave without saving?" while there are unsaved pages.
- **Visible change:** yes.
- **Confirm on:** phone and desktop.

---

## Notes

### Failed save or delete keeps the note (X-01, X-08; `4c82e18`, `576c781`)

- **Before:** the autosave caught a write failure and resolved; Back then closed unconditionally and the draft was lost. Delete swallowed failure and closed the editor, and repeated confirmation clicks could issue overlapping deletes.
- **Now:** the save chain returns success and updates the last-stored text only after success. Back closes only once the latest draft is stored; after a failed save the editor stays open with "Couldn't save this note" and Try again. A second Back leaves anyway, so a full or read-only disk cannot trap the reader. Close and delete share an in-flight guard; a failed delete keeps the editor and its dialog and says so; a successful delete suppresses the cleanup autosave.
- **Visible change:** yes.
- **Confirm on:** Windows release, phone: fill the disk or revoke storage; a slow delete clicked twice. Global tab-close guards and the note store's own transactions are still deferred.

### Add to Notes cannot make duplicates (X-05; `1d9da3a`)

- **Before:** OCR and Marks "Add to Notes" created a new id on each click without guarding the awaited write, so slow storage allowed duplicate notes.
- **Now:** a synchronous in-flight ref and a disabled, `aria-busy` button cover the whole write.
- **Visible change:** no.
- **Confirm on:** phone with slow storage. Not run end to end in the dev server.

### Notes: focus rings and delayed status (5.2, 6.5)

- **Before:** the Notes fields lost their global focus outline; open, backup, restore, export and handoff showed no ongoing feedback.
- **Now:** Notes inputs keep the global outline. Those jobs run through `taskFeedback.ts`: guarded by name, with a non-modal status shown through the toast host after a delay. Notes open results carry a request identity.
- **Visible change:** yes: focus rings; a short status on slow jobs. Handoff status uses the generic "Loading" wording.
- **Confirm on:** native export, restore and handoff on Windows release, macOS and phone.

---

## Tools

### Small tool transitions (4.5; `b60c6b1`, `1d9da3a`, `616eb28`)

| Flow | Before | Now | Visible | Confirm on |
|---|---|---|---|---|
| Fill and sign signature target (SM-04) | Forgetting the last kept signature closed the chooser without clearing the field target; a later toolbar signature landed in that old field | Toolbar selection clears any old target; forgetting the last signature clears it | yes: the next toolbar signature goes into placement | Windows release, phone |
| Read aloud (SM-05) | A piece fetched for a superseded run was dropped | It goes back behind pieces queued by Back; pause or skip during extraction loses nothing | yes | each platform's speech engine |
| Compress (SM-06) | Outcome and progress survived replacing the selected file and described the old file | They are cleared when the file changes | yes | any |
| OCR (SM-15) | A worker error rejected only start-up, leaving reads pending; stored OCR loading late replaced a running UI | Failure terminates the worker and rejects start-up and all waiting reads (the existing failure path); stored OCR is ignored once Start is pressed | yes, a dead worker now fails instead of hanging | Windows release and phone, real language data |
| Updater (SM-17) | Download and install blocked its modal with no network timeout | Feed request limited to 30 s, download to 5 minutes, using the plugin's cancellation | yes: a stalled network now ends in the existing failure message | Windows release, macOS, Linux AppImage: updater check, download, install and relaunch. A hang in the native installer is not covered |
| File changed bar (SM-20) | Late base and dismiss results could apply after a new file or read | Generation guards drop them | no | desktop, edit a file outside the app |
| Signature and stamp Done (SM-21, X-10) | No guard across font and store awaits; repeated taps placed twice | Synchronous guard, disabled `aria-busy` button, late placement after unmount ignored | yes | real Fill and sign flow on desktop and phone (not exercised in its real context) |
| PDF lifecycle on new bytes (SM-10; `ddcb4c9`) | A mounted viewer could keep a destroyed proxy while replacement data loaded | The proxy, error, password and metadata are cleared when data changes; empty input takes the failure path; late outline and signature-save results are ignored | no | replace a file on disk while open |

### Print (4.5, SM-19; `4c82e18`)

- **Before:** a second print request was silently ignored. Host-page printing waited for visibility change or ten minutes; web printing left its fallback timer alive after `afterprint`.
- **Now:** a second request shows "A print job is already in progress". The host fallback is 60 s and also listens for `afterprint`; listeners and timers are removed and the print root clears in `finally`.
- **Visible change:** yes.
- **Confirm on:** Windows release, macOS print sheet, Linux (WebKitGTK), phone. A host render longer than 60 s is not covered. No native print dialog was opened.

### Truthful clear results (4.6, X-04, X-07; `26bb06c`)

- **Before:** "Clear stored copies" swallowed a deletion failure, zeroed the counts, marked managed recents unavailable and announced success. Bulk bookmark, mark, signature and stamp clear buttons had no pending guard; signature and stamp clear and Undo swallowed errors and could show false zero counts.
- **Now:** one synchronous pending guard covers clear and Undo; controls are disabled while pending. On failure the counts and managed availability stay, a failure message shows and the confirmation stays available. Counts go to zero only after the write completed. Undo errors report failure.
- **Visible change:** yes.
- **Confirm on:** native `imports_clear` and Undo on Windows release, macOS, Linux, phone.

### Page, extract and rename fields (6.5; `2f2aeed`, `881e53a`)

- **Before:** a page draft vanished on blur or an invalid submit and decimals rounded; extract and rename validation appeared while typing.
- **Now:** an invalid page draft is kept with an explanation (integers, or a range). Extract and rename validate after the field is left, with an associated message; rename reserves status space and labels busy work. After review: rename shows its error at once again (a name with a slash cannot become valid by typing more), and a range that cannot become right is said at once, while one ending in `-`, `,` or a space waits for the field to be left.
- **Visible change:** yes.
- **Confirm on:** each platform with a screen reader. Page fields that hand authored labels to `onGoText` keep that callback's parsing.

---

## Settings

### Saved data, theme and keys (4.4, 5.1, 5.5)

- **Settings writes:** see [stored values](#stored-values).
- **Clear and undo:** see [truthful clear results](#truthful-clear-results-46-x-04-x-07-26bb06c).
- **Ctrl+, opens Settings** (5.5): see [keyboard and shortcuts](#keyboard-and-shortcuts).
- **Settings loads lazily:** see [start-up](#settings-loads-on-demand-viewer-tools-load-on-demand-22-23-d5d6399-91a68ce).
- **Visible change:** a failed settings save now says so.
- **Confirm on:** all platforms.

---

## Keyboard and shortcuts

### Browser keys that leaked (5.5; `f1a16d3`)

- **Before:** nothing stopped the web view's own keys. Plan item 5.5 treated Ctrl+P, Ctrl+U, Ctrl+S and Ctrl+Shift+I outside a viewer as unverified; reload and devtools defaults were also open.
- **Now:** one handler at `window`, after the document-level app handlers, catches unhandled browser keys: it prevents accidental reload (every variant), the web view's print, save, view-source and find, and release-build devtools. Viewer and custom shortcuts still win; field editing and clipboard keys still work (except reload). Devtools keys stay available in development. No capability or Rust change: Wry's browser accelerator option is not exposed by Tauri 2.12.5's builder or config.
- **Visible change:** yes: those keys now do nothing in the desktop app.
- **Confirm on:** Windows release (F5, Ctrl+R, Ctrl+Shift+R, Ctrl+P, Ctrl+S, Ctrl+U, Ctrl+F outside a viewer, F12, Ctrl+Shift+I), Linux (WebKitGTK inspector), macOS (Cmd+R, Cmd+P). The guard was only simulated in the dev server.

### Ctrl+, (Cmd+,) opens Settings (5.5, U-30; `f1a16d3`)

- **Before:** no fixed shortcut for Settings.
- **Now:** Ctrl+, on Windows and Linux, Cmd+, on macOS, with keyboard ownership (it does nothing over a dialog). Existing custom bindings are kept. The shortcut is listed using the existing translated "Settings" label.
- **Visible change:** yes.
- **Confirm on:** Windows release, macOS (also the app menu), Linux; a non-US keyboard layout where the comma needs a modifier.

### Keys and the top layer (SM-07)

See [one keyboard-owner check](#one-keyboard-owner-check-41-sm-07-666dcfc).

### Arrow keys in groups and the tab strip (5.2, 5.4; `a94deca`, `bfcc93c`, `7b46bb6`)

- **Before:** radio groups and button toolbars had no arrow-key movement; all tabs and their close buttons were separate Tab stops.
- **Now:** `KeyboardGroups` (mounted from `main.tsx`) gives radio groups and button toolbars roving focus with arrows, Home and End, RTL aware, skipping disabled items; text-field keys are left alone; toolbar movement does not change a radio selection. Groups that mount later are set up when focus enters them (the global observer was dropped because it ran a query for every PDF page and list row). The tab strip has one tab stop, arrows with Home and End and automatic activation, Delete to close, middle click to close, and focus restoration after removal.
- **Visible change:** yes.
- **Confirm on:** each platform with a screen reader and a keyboard; Arabic and Urdu (mirrored arrows). Physical middle click on desktop.

---

## Accessibility and contrast

### Contrast (5.1; `6689f88`)

- **Before:** several text and control colours were under WCAG 1.4.3 (4.5:1) and 1.4.11 (3:1): danger, success and accent on tinted surfaces; control borders at 1.20 to 1.25:1; file-icon lettering as low as 1.93:1 in the dark themes; code colours in the plain themes inherited the wrong palette and comments were 2.83 to 4.04:1; some counts and the inactive pane header used `opacity`.
- **Now:** a `--line-control` token at 3:1 or more for control borders and scrollbar thumbs; `--on-format` for file-icon lettering; all five source-code palettes defined per theme; danger, success and accent darkened in Paper and Sand; format fills darkened minimally; `opacity` removed from counts, unavailable rows and the inactive pane header. Ratios are in `docs/tokens.md`.
- **Visible change:** yes: stronger borders, crisper counts, corrected syntax colours and icon lettering. Before and after screenshots (1280 by 800, not in git): `audit/px/shots/5.1/`.
- **Confirm on:** Windows release (the default plain-dark and plain-light themes), phone (OLED dark), a tinted theme on each platform.

### Keyboard focus, names and announcements (5.2; `a94deca`)

- **Before:** Notes lost focus rings; the tab strip ring was clipped; the welcome dots were small and had no focus containment; search fields spell-checked; OCR lines were not keyboard reachable; dialog bodies had no description; the Tools outcome was not announced.
- **Now:** Notes fields and tab buttons have visible rings (inset on tabs). The welcome is portalled beside `#root` with `useModalFocus` (making `#root` inert) and its dots have 24 px targets and roving focus. Search fields in Home, Notes and the viewer shell turn off spellcheck and autocomplete. OCR picture and text lines are named native buttons. Dialog bodies are described; the Tools outcome has a persistent polite live region. The toast region was already polite and is unchanged (error toasts are polite too; the API has no error severity).
- **Visible change:** yes: focus rings and larger invisible dot targets.
- **Confirm on:** NVDA and JAWS on Windows, VoiceOver on macOS, Orca on Linux, TalkBack on a phone: OCR line activation, announcements, the welcome focus trap.

### High-contrast (forced colours) themes (5.3; `5d8b87a`)

- **Before:** no `forced-colors` rule: the selected state was invisible in a Windows contrast theme.
- **Now:** one global block maps tokens to system colours; selected, pressed and current states get a `Highlight` fill and a keyboard ring; switch tracks and thumbs, segmented controls, the tab strip and the welcome dots have their own boundaries. All rules are inside `forced-colors: active`.
- **Visible change:** only in a contrast theme.
- **Confirm on:** a real Windows contrast theme (Aquatic, Desert, Dusk, Night sky), macOS Increase contrast, old Android WebViews. Checked only with emulated `forced-colors` in Chrome.

### Tab strip reachability (5.4, U-14, U-15; `bfcc93c`, `3856228`)

- **Before:** tabs shrank to 72 px and were then clipped; selecting an off-screen tab did not show it.
- **Now:** 220 px tabs shrink to 120 px, then the strip scrolls horizontally with a thin scroll bar; the whole active tab is revealed on selection, tab change and resize; the wheel follows reading direction; RTL drag spacing is corrected. `aria-controls` and viewer panel ids are not wired yet.
- **Visible change:** yes.
- **Confirm on:** Windows release (native window drag from the strip, many tabs, packaged font), macOS, Linux.

### Search results and loading text (6.5)

- **Before:** the find panel could show cards for an earlier query, and used one empty message before and after the search finished.
- **Now:** cards show only for the current query and options; stale refreshes are cancelled; "Loading" and the no-match guidance are distinct (one new translated guidance string).
- **Visible change:** yes.
- **Confirm on:** each platform with a large document.

---

## Motion

Spec: [MOTION.md](MOTION.md). Tokens: [docs/tokens.md](docs/tokens.md).

### Tokens (6.1; `77e34a0`, `d4be09c`)

- **Before:** raw durations and easings in about 25 places; two identical easing tokens.
- **Now:** `--t-instant`, `--t-progress` and `--ease-exit` added, duplicate removed, values moved to tokens (some rounded: 160 to 180, 260 to 240, 90 to 80 ms).
- **Visible change:** barely.
- **Confirm on:** none needed beyond a look.

### Reduced motion in scripted scrolling (6.2, X-16; `659c185`)

- **Before:** six calls scrolled smoothly regardless of the preference (paged turns, tap to turn, OCR sync, theme carousel).
- **Now:** all use `scrollBehavior()`: `auto` under reduced motion, `smooth` otherwise.
- **Visible change:** only with reduced motion on.
- **Confirm on:** Windows ("Show animations" off), macOS (Reduce motion), phone (Remove animations): real page turns and OCR sync.

### Exits for menu, dialog and toast (6.3; `c828a72`, `881e53a`)

- **Before:** sheets, dialogs and menus vanished at once; toasts were removed at once; a short sheet drag snapped back.
- **Now:** menu, dialog and toast leave with a 120 ms fade of an inert copy (`useExitPresence`); focus and input are released at once. Reduced motion, a hidden page and dialogs holding a canvas skip the copy. A short sheet drag returns with a transform transition. Copies carry no `data-testid`. **The sheet exit was not shipped** (it failed the 6x budget).
- **Visible change:** yes.
- **Confirm on:** phone (Android Back during an exit, focus return in a real WebView), Windows release (focus returns to the opener, no double-click needed).

### Layout animation moved to transform and opacity (6.4; `bc0ae01`)

- **Before:** the OCR sweep and beam, the divider grip, the scrubber knob and the welcome dots animated size or position; the mark jump pulsed a `filter`; placeholder lines animated background.
- **Now:** these use `scaleY`, `translateY`, `scaleX` and opacity; a separate SVG outline pulses for a mark jump (the mark itself is unchanged); the beam's shadow and the found-line background tween are gone. The phone docked reading bars still animate margins (deferred).
- **Visible change:** yes, slightly.
- **Confirm on:** phone (the reading bars, OCR sweep), Windows release (OCR, divider, mark jump from a bookmark).

### Pending and validation feedback, loader delay, press states (6.5; `2f2aeed`)

- **Before:** the folder spinner mounted at once; no ongoing feedback for slow jobs; press and hover gaps on shared controls.
- **Now:** the folder spinner shows after 200 ms in reserved space (`useDelayed`); slow jobs show a delayed status; press feedback on shared controls, Home, Notes, Settings, onboarding, tools and the scanner; hover rules there are gated by hover capability.
- **Visible change:** yes.
- **Confirm on:** a phone (touch hover), Windows release.

---

## Build and packaging

### Build check for a PDF look-alike (0.1; `3cda332`)

- **Before:** nothing checked. Tauri 2.12 serves a script that has `%PDF` in its first 1,024 bytes as a PDF, so the app stays blank. Our code held the literal.
- **Now:** `scripts/check-dist.mjs` runs as `postbuild` (so in CI, validation and the Tauri release `beforeBuildCommand`) and fails the build if any script, style or page has the marker in its first 1,024 bytes. The source builds the header from character codes.
- **Visible change:** no.
- **Confirm on:** CI (all three workflows). The planned macOS header-size check (16 KiB) was not added: Rust rewrites the HTML after Vite, so the CSP size cannot be known at that point.

### Pruned Tauri commands and narrower permissions (D; `76c3e1a`)

- **Before:** `core:default`, `fs:default` and `updater:default` granted 117 commands on desktop and 100 on mobile.
- **Now:** `build.removeUnusedCommands` is on and the capabilities list 28 and 4 exact permissions. `mobile.json` also allows `$APPDATA/files/imports/**` and `$APPDATA/files/imports/*` so Android managed copies remain readable. Window restore now happens in Rust, so the frontend no longer holds maximize, set-size or set-position. Two custom app commands (`read_file_range`, `file_size`) were added for streamed PDF reading. Full mapping: `docs/unused-commands.md`.
- **Visible change:** no intended change; a missed permission fails only in a packaged app.
- **Confirm on:** a CI build on every platform, using the click-through checklist in `docs/unused-commands.md` (window buttons, drag and double-click, full screen and slideshow, pickers, drop, recents after restart, second launch hand-over, macOS menu, updater, Android picker and share).

---

## Issue fixes, storage, streaming and hardening (2026-11-20)

### Storage usage and Android picker copies (#95 follow-up)

- **Before:** every file chosen via Android's picker was copied into `files/imports/`, `importsPrune` ran only once at start-up, abandoned temp files waited 24 hours, `store::set(null)` left 4-byte `"null"` files behind, and thumbnails of entries evicted by the recents limit stayed on disk. `mobile.json` also omitted `$APPDATA/files/imports/**`.
- **Now:** when Android's picker grants a persistable URI (`keepDocument` returns true), the file opens directly as a `uri` without copying; stray non-recent grants are tracked in `picked_grants_v1` and released so Android's persistable grant quota is not exhausted. `importsPrune` also runs 5 s after opens/closes during long phone sessions, keeping open documents protected; `STALE_TEMP` is 1 hour and empty hash folders older than 10 minutes are removed. `store::set(null)` deletes the file and `recents.tsx` forgets thumbnails for evicted entries.
- **Visible change:** Android app storage stays bounded; picked files open immediately and rename in place; cloud-picked files need their provider available when reopened.
- **Confirm on:** Android CI APK (pick file, restart, reopen, check `files/imports` stays empty; open many files from WhatsApp and check cap; test saved folders) and Windows release.

### Large PDF streaming, CamScanner stability, orientation reset and ephemeral `ACTION_VIEW` (#94, #97, #98)

- **Before:** PDFs were read whole over IPC and then cloned back via `pdf.getData()` after page 1 for signature scanning, crashing on 350 MB PDFs (#97) and large picture PDFs (#94). Phone canvases capped at 16 MP with uncapped images. Rotating landscape to portrait could clamp scroll and reset to page 1. External `ACTION_VIEW` launches stayed in Android Recents and threw `Illegal invocation` on a detached `leaveToCaller` bridge call.
- **Now:** PDFs above 2 MiB on Android (8 MiB on desktop) stream via byte-range commands (`read_file_range`/`file_size` in Rust, `readRange`/`fileSize` in `MainActivity.kt`) using `PDFDataRangeTransport`, and files over 16 MiB defer the signature scan until an editor or Save with marks opens. Phone canvas cap is 4 MP (`2^22`) with a 16 MP viewer image cap (`4096×4096`). Resize preserves the pre-rotation page across orientation flips. External `ACTION_VIEW`/`ACTION_SEND` launches exclude the task from Android Recents (restored on launcher `ACTION_MAIN`), open files over 250 MiB by URI without copying, wait for incoming files before `reopenLast`, and invoke `window.__paperwrenAndroidExtras.leaveToCaller` with its receiver bound.
- **Visible change:** large PDFs open immediately without crashing; rotation keeps the page; external Android opens leave cleanly on Back and stay out of Recents. Pictures over 16.7 MP are omitted in the phone viewer rather than crashing the renderer.
- **Confirm on:** Windows release (350 MB PDF, marks key preserved, tools on >16 MB PDF) and Android CI APK (350 MB PDF from WhatsApp, CamScanner PDF, rotate on page N, Back to calling app, Recents overview).

### Settings side menu, duplicate Android scrollbars, scrubber touch and highlights toggle (#93, #94, #99, #100)

- **Before:** clicking a lower Settings section walked the highlight through every intermediate heading and landed on About; Android PDFs showed both native and custom scrollbars; grazing the scrubber edge hijacked scrolling; highlights on PDF pages could not be hidden while keeping notes open.
- **Now:** Settings pins the clicked section during smooth scroll and at the foot of the page until manual scroll input. Touch PDF containers hide native scrollbars under `(hover: none) and (pointer: coarse)` and `html.touch`. `Scrubber` uses a narrower 22 px inline-end target, ignores momentum and multi-touch, and requires a deliberate 80 ms hold or 4 px vertical drag. `MarksPanel` adds a translated Hide/Show highlights toggle (`data-marks-hidden`) that hides page overlays while keeping notes interactive and blocking invisible mark taps.
- **Visible change:** yes, on all four flows.
- **Confirm on:** Windows release (Settings side menu and chip row with/without reduced motion, Highlights toggle in side panel) and Android CI APK (single scrollbar, edge scrolling, Highlights toggle sheet).

### Security, privacy, memory and reliability hardening

- **Before:** incoming Android `file://` and own-`FileProvider` intents were not rejected; `list_folder` and `rename_file` lacked mobile guards; `open::validated` did not canonicalize before checking extensions or reject Windows UNC paths; `save::rename` allowed renaming into script extensions or over dangling symlinks; `docx-preview` and SheetJS lacked a strict ZIP-bomb total-size check; `PasswordDialog` retained typed passwords in state and unlocked docs could persist bookmarks; several viewers/tools lacked `ownsKeys()`, in-flight guards, abort checks, or canvas cleanup (`FillPage`, `PageThumb`, `ReadText`, `ImagesTool`); inline SVG textures (31 KiB) and `* { scrollbar-color }` sat in `global.css`.
- **Now:** Android refuses non-`content://` and own-authority incoming intents, narrows camera `FileProvider` to `Pictures/`, restricts release `isAppOrigin` to `tauri.localhost`, escapes `\u2028`/`\u2029` in `evaluateJavascript`, and bounds `decodePicture`/`saveChunk`/`ACTION_SEND_MULTIPLE`. Rust gates `list_folder`/`rename_file` to desktop, rejects Windows UNC/device paths, canonicalizes before extension checks, blocks app-private dirs and script renames, uses `symlink_metadata`, caps store/save payloads, skips `sync_all` on `thumb_*`, and adds `frame-src 'none'; media-src 'none'` to CSP. Frontend adds strict `validateZip` before `docx-preview`/SheetJS, sanitizes DOCX styles/hrefs and workbook links, tightens `LinkGuard`/DOMPurify/ODF, clears `PasswordDialog` state, disables persistent bookmarks on password-protected docs, enforces `ownsKeys()` and inactive `FindBar` gating, releases offscreen tool canvases and `ImageBitmap`s, moves textures to `public/textures/*.svg`, removes `* { scrollbar-color }`, and fixes Android transform-only entrances and `forced-colors` rules.
- **Visible change:** Windows `\\server\share` UNC paths and Android `file://` intents are now refused (mapped drives and `content://` still work); password-protected documents no longer save bookmarks; hidden-tab keys and double-clicks no longer misfire.
- **Confirm on:** CI (`validate.yml` + `ci.yml` across Linux, Windows, macOS, Android, Playwright) and packaged desktop/Android builds.

---

## Performance, efficiency and modernization pass (2026-11-22)

### Async WebCrypto document marks key (OPT-01)

- **Before:** opening a PDF (or picking one in Mark up / Read text) computed its marks store key by running a pure-JS `sha512()` synchronously on the main thread over up to 2 MiB (`contentKey(sample)`), taking ~667 ms of JS self-time at 6x CPU throttle and causing a >50 ms long task even at 1x.
- **Now:** `contentKeyAsync(sample)` hashes the exact same sample off the main thread with `crypto.subtle.digest("SHA-512", ...)` and falls back to synchronous `contentKey(sample)` where WebCrypto is unavailable (e.g. non-secure origins). Existing marks keys are byte-for-byte identical.
- **Visible change:** no.
- **Confirm on:** Windows release (open PDFs with existing marks and verify marks load identically, including large streamed PDFs) and Android CI APK.

### Overlay open without forced layout or style recalc (OPT-02)

- **Before:** opening any menu or dialog triggered a full-document `UpdateLayoutTree` (~327 ms at 6x) because `useModalFocus` set `#root[inert]` synchronously in `useLayoutEffect` immediately before `useExitPresence` called `getComputedStyle(el).getPropertyValue("--t-fast")`, and `MenuPanel` called `setAt()` in `useLayoutEffect` forcing a second synchronous React render and layout (~220 ms combined at 6x).
- **Now:** `useExitPresence` reads and caches `--t-fast` from `:root` lazily during unmount cleanup rather than on mount; `MenuPanel` sets `el.style.left`/`top` directly before `useModalFocus` with no second React render; `useModalFocus` keeps focus, `ownsKeys`, `Tab` trap, and `Escape` synchronous in `useLayoutEffect`, sets `#root[inert]` in `useEffect` right after first paint, and still removes `inert` synchronously before restoring focus to the opener.
- **Visible change:** no; menus and dialogs open at the exact same position and with the exact same focus/keyboard/inert behavior.
- **Confirm on:** Windows release (open/close File menu, nested Dialog over editor, keyboard Tab/Esc, focus return to opener) and Playwright E2E (`tools.spec.ts` `inert` assertions).

### Theme switch without forced style recalculation (OPT-03)

- **Before:** changing the theme called `paintWindowBackground()`, which invoked `getComputedStyle(document.documentElement).getPropertyValue("--canvas")` right after updating `dataset.theme`, forcing a full-document `UpdateLayoutTree` (~563 ms across 2,194 elements at 6x) before React finished updating, and also sent `set_background_color` immediately on startup even though Rust `placement.rs` already painted the initial window.
- **Now:** `paintWindowBackground(theme)` maps the five resolved themes directly to their `--canvas` RGB triples (falling back to `getComputedStyle` only for unknown themes), deduplicates identical colours, caches the `@tauri-apps/api/window` module import, skips writing `dataset.theme` when it already matches the initial hint, and defers only the first startup canvas sync by 250 ms.
- **Visible change:** no.
- **Confirm on:** Windows release (switch through all five themes in Settings and resize the window after each switch; verify first frame on cold start).
