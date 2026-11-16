# Performance

Status: **baseline measured 2026-11-15; changes implemented on `px/main` 2026-11-16.** Section 6 is the optimisation log. Every figure in the log is from the dev server or a production build served by `vite preview`, in headless Chrome, **not** from a packaged release. The release-build re-measurement is still to do (section 7).

## 1. How the baseline was measured

- **Build:** the installed 1.8.0 release for Windows (`paperwren.exe`, 26.8 MB). `git diff v1.8.0 HEAD -- src src-tauri` is empty, so it matches the source.
- **Machine:** Windows 10, Intel i7-7820HQ (4 cores, 8 threads), 16 GB, WebView2 runtime 157.
- **Low-end simulation:** CPU throttling 6x on the page's main thread through the DevTools protocol. It does not slow the Rust core, the GPU, WebView2's own start-up or the pdf.js worker, so the 6x column is a stress test of our JavaScript, not a prediction for a slow PC.
- **Not measured:** a true cold start (needs a reboot), a real low-end machine, Android, macOS, Linux. The start-up IPC log is from a page reload, not a process start.
- **Noise:** another program used 45 to 98% of the CPU in bursts during the session. Timed runs waited for a quiet moment; runs that could not get one are marked in the full report. All 6x interaction and smoothness runs are in that group.
- **Full report, scripts and raw data:** `audit/px/B1-baseline.md` and `audit/px/baseline/` (kept out of git).

## 2. Baseline and budgets

"Now" is the median on this machine. "6x" is the same with the page throttled. A budget in bold is not met today.

### Start-up

| Metric | Now | 6x | Budget | Note |
|---|---|---|---|---|
| Native window visible after process start | 144 ms | | 200 ms | Met |
| Process start to webview ready (`window created`) | 662 ms | | none | WebView2 creating its processes; not ours to reduce (section 5) |
| Home ready | 976 ms (952 to 1,093) | | **850 ms** | 189 ms of it is our code; about 159 ms of that waits for window placement |
| Web layer only: reload to Home painted | 260 ms | 905 ms | **200 ms / 700 ms** | |
| Wrong-colour window before Home | 0.9 to 1.0 s of light cream, in both the system-dark and Ink themes | | **0 frames** | 6 recordings at 29 fps |
| Window jumps to its saved place after showing | yes, at about 800 ms | | **no** | |
| First page of a small PDF given at launch | 1,512 ms | | **1,350 ms** | |
| First page of a 22 MB, 255-page PDF given at launch | 2,041 ms | | **1,850 ms** | |

### Idle CPU (all 7 processes, 60 s)

| State | Now | Budget | Note |
|---|---|---|---|
| Home, focused | 0 to 0.17 CPU-s per minute (under 0.3% of one core) | 0.2 CPU-s per minute | Met |
| One PDF open, focused | 0.00 CPU-s per minute | 0.2 | Met. The 2 s file check costs 30 small IPC calls a minute |
| Unfocused or minimised | 0.11 to 0.47 CPU-s per minute; 6 to 8 times the focused cycle count | **no more than 1.5 times the focused cycle count** | Cause not yet known |
| Warm-up after Home | 0.7 CPU-s at 3 to 4 s after start, +26 MB | keep (decision 3 in the plan) | It makes a first PDF open 215 ms faster |

### Memory (private bytes, all 7 processes)

| State | Now | Budget | Note |
|---|---|---|---|
| Home idle at 60 s | 182 to 184 MB | 185 MB | Met. Mostly WebView2's own processes |
| One small PDF open | 266 MB | 270 MB | Met |
| 5 tabs (the most kept alive) | 423 MB, about 22 to 26 MB per extra tab | 430 MB | Met |
| 30 s after closing every tab | 300 to 335 MB | **within 25 MB of Home idle** | Does not come back down |
| Open and close a 255-page PDF, per round | +2,100 detached DOM nodes, renderer +14 MB (20 rounds: 1,506 to 44,968 nodes) | **0 nodes, under 1 MB** | A leak. Forced garbage collection frees 24 nodes |
| 10 minutes of scripted use | 4,508 MB and still rising (renderer 2.3 GB, GPU 2.1 GB) | **600 MB, flat** | The script is far heavier than real use; the trend is what matters |

### Size

| Item | Now | Budget | Note |
|---|---|---|---|
| Windows installer | 23.6 MB | 24 MB | Met. Android APK 79.5 MB, AppImage 103 MB |
| Installed exe | 26.8 MB | 27 MB | Met |
| Web build | 44.9 MB: OCR data 19.8 MB, WASM 8.7 MB, JS 6.65 MB (2.18 MB gzip), fonts 3.35 MB, scanner model 1.9 MB | no growth | The large parts are features (OCR, scanner, fonts for Office files) |
| Entry script | 362 KB (119 KB gzip) | **300 KB (100 KB gzip)** | Carries Settings and tool code Home does not need |
| Entry stylesheet | 104 KB (25 KB gzip) | **80 KB** | Carries the viewer shell's styles |

### Interaction latency (input to next paint, 5 runs each)

The method's own floor is 46 ms, so "at the floor" means the action painted in about three frames.

| Action | Now | 6x | Budget (now / 6x) |
|---|---|---|---|
| Open a recent PDF, click to first page | 254 ms, 5 long tasks | 2,160 ms, 42 long tasks (longest 1.4 s) | **220 ms / 1,200 ms** |
| Switch tab | at the floor | 192 ms | floor / 200 ms (met) |
| Go Home | at the floor | 299 ms | floor / **200 ms** |
| Open the file menu | at the floor | 696 ms | floor / **200 ms** |
| Open or close the side panel | at the floor | 430 to 490 ms | floor / **200 ms** |
| Open Settings | at the floor | 500 ms | floor / **300 ms** |
| Switch theme | 62 ms | 386 ms | floor / **200 ms** |
| Open Tools | at the floor | 267 ms | floor / 300 ms (met) |
| Page Down in a PDF | at the floor | 284 ms | floor / **200 ms** |
| Find: 5 letters typed to hits shown | 693 ms (about 500 ms is the app's own delay) | 847 ms | **400 ms** / 600 ms |

### Smoothness (frames in the test window)

| Test | Now | 6x | Budget (now / 6x) |
|---|---|---|---|
| Scroll a PDF, 5 s | 300 frames, 0 over 33 ms | 230 frames, 18 over 33 ms | 295 frames / **270 frames, 5 over 33 ms** |
| Scroll a large workbook, 5 s | 301 frames | 79 frames, 95th percentile gap 152 ms | 295 / **200 frames** |
| Scroll Home's list, 5 s | 303 frames | 264 frames, 7 over 33 ms | 295 / 260 (met) |
| Resize the window for 2 s, Home only | 114 frames | 14 frames | 110 (met) / **60** |
| Resize the window for 2 s, 4 PDF tabs open | 33 frames, 16 long tasks (longest 88 ms) | 5 frames | **100 frames, 0 long tasks** / **40** |
| Menu, dialog, panel, screen change (5 pairs each) | 0 to 5 frames over 33 ms | 22 to 33 frames over 33 ms | 0 over 20 ms / **2 over 33 ms per pair** |

### IPC

| Flow | Now | Budget |
|---|---|---|
| Start-up to Home plus 5 s | 30 calls, 125 KB back (one 110 KB thumbnail read) | 25 calls |
| Open a recent PDF | 9 calls plus the file itself, once | 9 |
| Each pause while reading | 1 read and 1 write of the whole recents list (14.4 KB each, 10 ms) | **0 on a pause; 1 write on leaving the document or after 5 s idle** |
| Idle with a PDF open | 30 file checks a minute | 30 while visible, **0 while hidden or minimised** |
| A 2 s window resize | 126 calls: `is_maximized` 61, `is_fullscreen` 61; each took about 170 ms on average while resizing | **6 calls** |
| A slider dragged 10 steps | 10 settings writes | **1 write** |

## 3. Findings

Costs in the "Measured" column come from the baseline. "Estimate" means the code audit's reasoning, not yet measured. IDs starting with P are from `audit/px/A1-perf-static.md`; M from `audit/px/00-map.md`; B from the baseline.

| ID | Where | Cause | Measured cost | Fix | Expected gain | Effort |
|---|---|---|---|---|---|---|
| B-1 | PDF viewer close path (`src/screens/viewer/PdfView.tsx`) | Something keeps every page element of a closed PDF alive | +2,100 detached nodes and +14 MB renderer per open and close; 4.5 GB after 10 minutes of scripted use | Find the reference that holds them (heap snapshot), release it on close | Memory flat across open and close | M |
| B-2 | `tauri.windows.conf.json`, `src/main.tsx:34`, `src/lib/windowState.ts`, `src/state/settings.tsx:121` | The window is shown at a default size with a fixed light colour; place and theme are applied by the page later | 0.9 to 1.0 s of light cream, a jump at about 800 ms, and about 159 ms of the first render spent waiting for placement | Place and colour the window in Rust from the stored values before it is shown; apply the last theme before first paint | No flash, no jump, Home ready about 150 ms sooner | M |
| M-1 | `src/App.tsx:165`, `src/ui/WindowControls.tsx:28`, `src/lib/fullscreen.ts` | The root component re-renders on every resize event, and two IPC calls run per event | 33 frames in 2 s with 4 tabs (114 with Home only); 126 IPC calls per 2 s | Read width through thresholds, not the raw number; one trailing IPC call after the resize settles; memo boundaries round Home and each viewer | Resize near 60 fps with tabs open | M |
| M-2 | `src/state/navigation.tsx`, `recents.tsx`, `settings.tsx`; `ViewerScreen.tsx:393`; `App.tsx:374` | Any navigation, settings or recents change re-renders Home and every kept viewer; two context values are new objects on every render | At 6x: file menu 696 ms, side panel 430 to 490 ms, Settings 500 ms, theme 386 ms, Home 299 ms | Split state from stable actions in the three providers; memoise the two viewer contexts; memo Home and the viewers | Simple actions under 200 ms at 6x | M to L |
| P-12 | `src/state/recents.tsx:240`, `PdfView.tsx:774` | Each reading pause replaces the recents list in context and rewrites it to disk | 1 read and 1 write of 14.4 KB per pause, plus the re-render in M-2 | Keep the position outside the list's context; write on leaving or after 5 s idle | No re-render and no disk write while reading | M |
| P-14 | `src/screens/viewer/PdfView.tsx:85` | The PDF chunk imports Fill and sign, Mark up and Read text statically | Part of the 254 ms open (2.2 s at 6x, 42 long tasks) | Load each tool when it is opened | Smaller first PDF open | M |
| M-10 | `PdfView.tsx:474`, `src/lib/pdfTools.ts:79` | A signature marker is searched for across the whole file on the main thread before the worker starts | Estimate: grows with file size; part of the 2,041 ms big-PDF open | Run it after the first page, in slices | Faster first page on large files | S |
| P-24 | `src/App.tsx:15`, `src/screens/home/Home.tsx:14` | Settings, the file menu and through them the signature and marks code sit in the entry chunk | Entry 362 KB script, 104 KB styles | Load Settings on open; move the two shared pieces Home needs out of the viewer's files | Entry about 60 KB smaller; less to parse before Home | S to M |
| P-16 | `src/screens/viewer/SheetView.tsx:321` | Grid state follows every scroll event | 79 frames in 5 s at 6x | One update per frame, and only when the visible cell window changes | Workbook scroll over 200 frames at 6x | M |
| P-04 | `src/App.tsx:89` | Up to four hidden tabs keep their document, canvases and worker, with no size limit | 22 to 26 MB per small tab; memory does not return after closing | Release page canvases when a tab is hidden; count bytes, not tabs | Lower working set with several documents | M |
| P-10 | `src/lib/pictures.ts:171` | The HEIC decoder worker is never ended | Worker still alive 60 s after the picture is closed | End it after its last job | One fewer worker and its WASM heap | S |
| P-08 | `src/lib/backend.ts:1292` | Files opened from a PDF's attachments stay in a module map | Estimate: their full size until exit | Release when the last tab using them closes | Recover that memory | S |
| P-09 | `src/screens/viewer/ImageView.tsx:196` | A fallback picture URL is created outside the effect that would revoke it | Estimate: one picture's bytes per fallback | Own and revoke it in the effect | Stops growth in long picture sessions | S |
| P-27 | `src/screens/viewer/Present.tsx:50` | The presenter's clock ticks while paused | 2 state updates a second | Tick only while running | No work while paused | S |
| B-3 | not yet known | Something runs more when the window is unfocused or minimised | 6 to 8 times the focused cycle count, still under 1% of a core | Diagnose in the optimisation loop | Unknown | S to find |
| M-4 | `src/state/settings.tsx:153` | A settings write per slider step | 10 writes for 10 steps | One trailing write | Fewer disk writes | S |
| P-25 | `src/state/recents.tsx:164` | The managed-copy sweep runs straight after start | Estimate: disk contention with the first document | Run it when idle | Small | S |
| P-01 | `src/App.tsx:64`, `src/lib/pdfEngine.ts:59` | Warm-up of the viewer, PDF engine and a spare worker | 0.7 CPU-s and 26 MB; saves 215 ms on a first open | Keep; see decision 3 in the plan | | |
| P-02, P-03, P-15 | DOCX, EPUB, PDF tools | Whole-document work on the main thread | Not measured | Big moves; not in this plan | | L each |
| P-13 | `ReadingControls.tsx:29` | Auto-scroll in a hidden tab | **Refuted:** 0 frames and no scrolling in a hidden tab | None | | |

Findings from the code audit that the baseline did not reach (P-05 to P-07, P-17 to P-23, P-26, P-28 to P-33) stay in `audit/px/A1-perf-static.md` as estimates. They enter the plan only if a later profile shows them.

## 4. Rules that keep the app light

Short form is in `AGENTS.md`. The reasons:

1. **Budgets are the section 2 tables.** A change that makes a budgeted number worse needs a reason in its commit.
2. **Read narrow.** In a component that redraws often or sits under every tab, read one setting (`useSetting`), the actions only (`useRecentsActions`, `useNavActions`) or one slice (`useNavScreens`), not the whole context. One change to a whole-context value redrew Home and every kept document (M-2).
3. **Do not keep a reading position in a list.** Positions are held apart and written once on leaving, on `visibilitychange` or after 5 s idle (P-12).
4. **A closed document must let go.** `setDocument(null)` for pdf.js, revoke object URLs in the effect that made them, end workers after their last job, delete attachment bytes with their last owner (B-1, P-08, P-09, P-10).
5. **A hidden tab does not hold its pictures.** Page canvases go after 10 s hidden, and kept tabs are counted in bytes (P-04).
6. **One write per burst.** Stored values go through `src/lib/storedValue.ts`: one queue, one trailing write.
7. **Ask the window once per resize, not per event** (`src/lib/settle.ts`). Read the width through thresholds.
8. **Heavy code loads when used.** Settings, Fill and sign, Mark up and Read text are lazy; keep them out of the entry chunk.
9. **Animate `transform` and `opacity` only** and stay inside the 6x budget (`MOTION.md`).
10. **The build must not serve a script that looks like a PDF.** `npm run build` runs `scripts/check-dist.mjs`; the first 1,024 bytes of every script, style and page must not contain `%PDF` (Tauri 2.12 would serve it as a PDF and the window stays blank, R2-01).

## 5. Platform limits

- **WebView2 start:** about 660 ms of the 976 ms to Home is WebView2 creating its processes. The first launch after an install is slower still (Microsoft reproduced about 2 s). Research rows R1-11, R3-09.
- **Memory floor:** 7 processes and about 182 MB at an idle Home; the Rust core is 8 MB of that.
- **Hidden-window throttling:** no setting exists on Windows, Linux or Android (R2-23).
- **Binary IPC on Windows:** slower than on the other platforms (R3-02).

## 6. Optimisation log

Every row is a change that is on `px/main`. "Measured" says what was observed and where. **Dev** means the Vite dev server in headless Chrome; **preview** means a production build served by `vite preview`; **6x** means CPU throttling 6x on the page. None of these is a packaged release; release numbers are in section 7. Where a row has no number, none was taken and none is claimed.

| Item | Change | Measured effect |
|---|---|---|
| 0.1 | `scripts/check-dist.mjs` runs after every web build (CI, validate, release): fails if any script, style or page has `%PDF` in its first 1,024 bytes. The source builds the marker from character codes. The macOS header-size check was not added (CSP sizing deferred: Rust rewrites the HTML after Vite) | Safety net; the build and a planted-file check passed (137 assets checked) |
| 0.2 | Lock-only updates: wry 0.57.2; tauri 2.12.5, runtime-wry 2.12.3, runtime 2.12.2, utils 2.10.2, updater 2.13.3 and related crates | `cargo check` passed. Upstream fixes: drag-region mouse-up, channel delivery, GTK resizing, NSIS downgrade check, updater signature check. No size or speed claim |
| 1.1 B-1 | The PDF viewer cleanup calls `setDocument(null)`, clears the link service and passes pdf.js's `abortSignal` (`255dd80`) | Dev, 255-page PDF, 33 scroll steps, close, 3 forced GCs: DOM nodes before 316 to 2,655 to 5,013 to 7,444 (+2,350 a round), listeners 306 to 602, JS heap +1.0 MB a round. After: 373 nodes and 341 listeners every round for 10 rounds, heap 15.0 to 16.5 MB. Preview build: 352 nodes every round, heap 6.8 to 8.15 MB |
| 1.2 P-10, P-08, P-09, SM-23 | HEIC worker ends after its last job; attachment bytes deleted with their last owner; one effect owns and revokes the original and fallback picture URLs (`271301f`) | None measured. Phone and native measurements still to do |
| 1.3 P-04 | A PDF tab hidden for 10 s destroys its drawn pages (document, layout and scroll kept); kept tabs are the latest four and about 200 MB between them (24 MB plus twice the file size per tab) (`677e817`) | Dev, 5 PDFs of 1.9 MB, renderer memory: Home idle 142 MB; 5 tabs open 386 MB originally, 342 MB with B-1 only, **270 MB with both**; 30 s after closing all 318 MB, 162 MB, **161 MB**. DOM nodes after closing 2,862, 420, 420. Revisited tab redraws its visible pages in 47 ms (preview) to 60 ms (dev) with scroll unchanged. Three 22 MB PDFs: two viewers stay mounted instead of four |
| 2.1 B-2, U-13 | The window is created hidden, placed, sized, maximised and coloured from the stored values in Rust (`src-tauri/src/placement.rs`) before it is shown; a fallback thread shows it after 1.5 s. An inline script in `index.html` sets `data-theme` from `localStorage` before first paint (`952fcf3`, `ba6b600`) | Dev: `data-theme` set at 14 to 20 ms, before the first animation frame, and unchanged through start-up. The native window behaviour (no jump, no wrong colour, Home about 150 ms sooner) is **not measured** yet: needs a Windows release build |
| 2.2 P-24 | Settings loads on open and is warmed after Home; Home's file actions and rename UI moved to their own modules and styles so Home no longer imports the viewer menu or shell stylesheet (`d5d6399`) | `npm run build`, before to after: entry JS 374.05 to 316.14 kB (gzip 122.70 to 103.13 kB); entry CSS 111.27 to 85.22 kB |
| 2.3 P-14, M-10 | Fill and sign, Mark up and Read text load when opened; `CopyWarnings` split out; the signature scan reads worker-owned bytes in overlapping 64 KiB slices after the first page and is awaited before editing or saving a marked copy (`91a68ce`) | PdfView chunk 81.70 to 83.94 kB (gzip 29.05 to 29.83 kB): the three tools now load as their own chunks. One reopen of a recent PDF at 6x in headless Chrome against the dev server: 1,225 ms, 4 long tasks, longest 93 ms (the audit's 2,160 ms was the installed app, so not directly comparable) |
| 2.4 P-25 | The managed-copy sweep runs when idle (`requestIdleCallback`, 4 s deadline) (`c2fd3f6`). `modulePreload.polyfill` was kept: the docs do not guarantee native support in the Safari and WebKitGTK versions we ship on | No startup benchmark was run |
| 3.1 M-1 | Root reads the width only through what split view needs; Home and each document are memoised with stable props; window queries are made at the first and last event of a resize burst (`src/lib/settle.ts`, 150 ms) (`fb1745e`) | Dev, 45 recents, 60-step resize in 2 s: Home only 22,020 renders to 30, window queries 60 to 2. With 4 PDF tabs 39,821 renders to 2,871 (the PDF view refitting). Preview (later run, after M-2): Home only 22,020 to 30; 4 tabs 39,876 to about 2,700; frames in 2 s unchanged (118-122 to 118-119 Home only; 61 to 61-63 with tabs); frames over 33 ms 51-53 to 31-37. Frame counts in these runs were noisy |
| 3.2 M-2, P-12 | Settings, recents and navigation are small stores (`src/state/store.ts`) with narrow hooks (`useSetting`, `useSettingsOf`, `useRecentsActions`, `useRecentsReady`, `useIsRecent`, `useNavActions`, `useNavScreens`, `useTheme`); the old hooks still work. The viewer's file context is memoised. PDF view reads only its six settings. Reading positions are held apart and written once on leaving, on `visibilitychange` or after 5 s idle, with a `localStorage` mirror for abrupt closes (`9abd748`, `50541cc`, `3dafcc9`, `7c22ba7`) | Dev, 4 PDF tabs, 45 recents, 6x, original to now (renders, then ms): file menu 797 renders 770 ms to 90 renders 292 ms; Home 628 / 414 to 105 / 144; Settings 786 / 603 to 186 / 248; side panel 689 / 555 to about 168 / about 260; theme 708 / 753 to 303 / about 500. Preview, median of 10 at 6x, total: file menu 1,192 to 750; side panel 897 to 389; Back to Home 419 to 436 (no gain); Settings 926 to 890; theme noise. Three reading pauses: 2,159 renders and 3 recents writes to 287 renders and 0 writes. After 5 s idle the position reached the list; after a reload 1 s after scrolling the PDF reopened on that page. Not at the 200 ms target in the preview figures for the file menu and Settings. Remaining cost: style recalculation when the app root is made `inert` and when the theme changes |
| 3.3 P-16 | Workbook grid: one scroll sync per animation frame, state set only when the visible row or column bounds change (`741814b`) | None claimed. Looked at a 300-row CSV in headless Chrome. The 79 frames in 5 s at 6x is the baseline only; needs a large workbook on a device |
| 3.4 M-4 | Settings write once, 250 ms after the last change (in `9f3b006`) | Dev: ten dim steps made 1 settings write (baseline 10) |
| 3.5 P-27 | The presenter clock ticks only while running, visible and the viewer active; kept at 500 ms so seconds never skip (`6ced253`, `1fbdbae`) | Expected zero periodic renders while paused or hidden. Not measured |
| 4.x | Stored values, leave guards, recents lifetime, scan queue (`9f3b006`, `8f96266`, `666dcfc`, `1062171`, `4516ee8`) | Behaviour fixes, not speed. Checked in the dev server; see `BEHAVIOR_NOTES.md` |
| 5.4 | Tab strip scrolls and uses one tab stop (`bfcc93c`) | No timing. At 15 tabs the row is 1,828 px wide and all tabs are reachable by scroll and keyboard |
| 6.x | Motion tokens, exits, transform-only animation (`MOTION.md`) | OCR progress at 6x: 25 frame gaps, largest 16.8 ms, none over 20 ms (one small sample). The sheet exit failed the budget (25.2 ms gap) and was removed. The 6x budget is not verified for every animation |
| D | `build.removeUnusedCommands` on, desktop permissions listed one by one (`76c3e1a`) | Allowed plugin and core commands: desktop 117 to 28, mobile 100 to 4 (command counts, **not** binary size). `cargo check` with pruning passed in 31.57 s. CI Windows builds of the same commit with the flag on and off: `paperwren.exe` 26,774,528 to 25,951,744 bytes (**-804 KB**); NSIS installer 23,667,083 to 23,487,000 bytes (-176 KB); MSI 24,223,744 to 23,945,216 bytes (-272 KB). Above the 300 KB gate, so kept |

### Tried and not kept

| Idea | Result |
|---|---|
| `content-visibility: hidden` on hidden tabs | Gave a modest effect in the render-isolation work; not committed |
| Sheet exit animation | Removed: failed the 6x budget (MOTION.md section 7) |

### Not done (and why)

| Item | Why |
|---|---|
| B-3, why an unfocused window uses 6 to 8 times the cycles | The optimisation loop (step 7) was not run in this pass |
| The 1.4 s long task in a PDF open at 6x, the 500 ms delay in find | Same |
| Big moves E (byte-range loading), F (WebView2 memory level), G (PDF tools in a worker), H (scales) | Not approved for this pass |
| Android and macOS and Linux numbers | No such device or build here |

## 7. Release re-measurement

The baseline in section 2 was taken on the installed 1.8.0 release. The same scripts (`audit/px/baseline/`) must be run on a CI-built release of `px/main` on the same machine. Until then the "after" figures for the release are not known.

| Metric (from section 2) | Before (1.8.0 release) | After (release) |
|---|---|---|
| Home ready | 976 ms | pending release measurement |
| Wrong-colour window before Home | 0.9 to 1.0 s | pending release measurement |
| Window jumps to saved place | yes | pending release measurement |
| Open and close a 255-page PDF, per round | +2,100 nodes, +14 MB | pending release measurement |
| 30 s after closing every tab | 300 to 335 MB | pending release measurement |
| 5 tabs | 423 MB | pending release measurement |
| 10 minutes of scripted use | 4,508 MB and rising | pending release measurement |
| Entry script / stylesheet | 362 KB / 104 KB | pending release measurement |
| Windows installer / installed exe | 23.6 MB / 26.8 MB | pending release measurement |
| File menu at 6x | 696 ms | pending release measurement |
| Side panel at 6x | 430 to 490 ms | pending release measurement |
| Settings at 6x | 500 ms | pending release measurement |
| Open a recent PDF, click to first page (now / 6x) | 254 ms / 2,160 ms | pending release measurement |
| Resize, 4 tabs (frames in 2 s, now / 6x) | 33 / 5 | pending release measurement |
| Window queries during a 2 s resize | 126 | pending release measurement |
| Settings writes for a 10-step slider drag | 10 | pending release measurement |
