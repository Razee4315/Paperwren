# Performance

Status: **v1.8.0 baseline measured 2026-11-15; v1.9.0 release baseline and v1.10.0 release re-measurement completed 2026-11-22.** Section 1–2 hold the v1.8.0 baseline and budgets; Section 2b holds the v1.9.0 release baseline (1x and 6x); Section 2c holds the final v1.10.0 release measurements (1x and 6x); Section 6 is the optimization log; Section 7 compares releases side by side.

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

## 2b. Baseline (v1.9.0 release, 2026-11-22)

Measured on the installed v1.9.0 Windows release build (`paperwren.exe`, 26,014,720 B, commit `6e550b7`, tag `pre-optimization-2026-11-22`) on the same Windows 10 i7-7820HQ / 16 GB / WebView2 157 machine, in two setups: normal (`1x`) and low-end simulation (CDP `Emulation.setCPUThrottlingRate(6)`, `6x`). Note: another Windows background process ran intermittent CPU bursts during startup and idle runs (`sysDuring` mean 21–68%). All numbers are medians unless noted.

### Start-up (v1.9.0 release)

| Metric | First run | Warm median (1x) | 6x | Note |
|---|---|---|---|---|
| Plain launch: window created / visible | 1,759 / 1,907 ms | 1,366 / 1,433 ms | — | `n=5` (sys CPU mean 47–69%) |
| Plain launch: Home ready | 2,956 ms | 2,379 ms (min 2,192) | — | Code loaded 2,335.5 ms -> Home +20–65 ms |
| Launch with `small.pdf`: first page | 6,440 ms | 3,241 ms (min 2,981) | — | `n=4` |
| Launch with `big.pdf` (22 MB, 255p): first page | 3,387 ms | 2,427 ms (min 2,212) | — | `n=4`; Home ready 1,284 ms, `read_file_range` 35 calls |
| Web layer reload to Home painted | 92.5 ms | 96.5 ms (dom 76 ms) | 810.9 ms (min 597, max 1,180.9) | `n=3` each |

### Idle CPU & wakeups (all 7 processes, 45 s window after 25 s settle, v1.9.0 release)

| State | CPU (% 1 core) | CPU-s/min | Mcycles/min | OS ctx/s | JS timers/min | IPC calls/30s | Private MB |
|---|---|---|---|---|---|---|---|
| Home, focused | 0.71% | 0.428 | 1,110.9 | 8.0 | 4 timeouts, 0 int, 0 rAF | 0 | 182.8 MB |
| Home, unfocused | 0.75% | 0.452 | 1,197.9 | 10.8 | 0 | 0 | 173.6 MB |
| Home, minimised | 0.43% | 0.260 | 1,536.3 | 10.1 | 0 | 0 | 181.2 MB |
| PDF open (`mid1.pdf`), focused | 0.07% | 0.044 | 2,142.8 | 45.7 | 30 int (2000 ms) | 15 (`plugin:fs\|stat`, 81.9 ms) | 226.5 MB |
| PDF open (`mid1.pdf`), unfocused | **3.02%** | **1.813** | **5,256.0** | **66.6** | **30 int (2000 ms)** | **15 (`plugin:fs\|stat`, 93.7 ms)** | 231.5 MB |
| PDF open (`mid1.pdf`), minimised | **1.21%** | **0.728** | **2,378.1** | **47.6** | **30 int (2000 ms)** | **15 (`plugin:fs\|stat`, 80.1 ms)** | 229.6 MB |

Key wakeup finding: even when minimised (`iconic: true`), WebView2 kept `document.visibilityState === "visible"` and `document.hasFocus() === true`, so `FileChanged.tsx` continued firing `plugin:fs|stat` 30 times/min (~45–67 ctx/s and ~2,550 `io_other_ops/min` in `main` across 4 OS processes).

### Memory (all 7 processes, private bytes, v1.9.0 release)

| State | Private MB | Working Set MB | JS Heap MB | DOM nodes | Workers |
|---|---|---|---|---|---|
| Home idle (30 s) | 220.3 MB | 436.9 MB | 5.3 MB | 1,469 | 1 (spare) |
| Small PDF open | 290.1 MB | 509.2 MB | 7.9 MB | 1,594 | 2 |
| Big PDF open (22 MB, 255p) | 336.7 MB | 541.4 MB | 8.7 MB | 3,405 | 2 |
| 5 tabs open | 469.3 MB | 706.4 MB | 13.7 MB | 3,230 | 5 |
| 30 s after closing all tabs | 283.1 MB | 514.6 MB | 8.9 MB | 1,470 | 1 |
| Leak check: 20x open/close `big.pdf` | r1 525.9 -> r20 501.2 MB (slope -17.4 MB/r) | -17.8 MB/r | 9.9 -> 12.0 MB (-0.14 MB/r) | 4,083 -> 3,444 (-151.9/r; 1,529 after GC) | 1 |
| 10-minute scripted use (45 loops) | t=30s 896.1 -> t=600s 1,177.8 MB (t=610s 1,007.9 MB: GPU 498.7, renderer 437.7) | 1,372.9 -> 1,632.9 MB | 12.1 -> 13.8 MB | 2,005 -> 2,390 | 2–3 |

### Size (v1.9.0 release)

| Artifact | Size | Note |
|---|---|---|
| Installed `paperwren.exe` (Windows) | 26,014,720 B (24.81 MiB) | Budget 27 MB (met) |
| Windows NSIS / MSI installer | 23.53 MB / 23.99 MB | CI v1.9.0 release |
| macOS DMG / Linux deb, rpm, AppImage / Android APK | 47.88 MB / 24.20, 24.20, 102.75 MB / 77.84 MB | CI v1.9.0 release |
| `dist/` total | 42,917,175 B (40.93 MB, 570 files) | `.traineddata` 18.89 MB, `.wasm` 8.30 MB, `.js` 6.40 MB (165 files, 61 micro-chunks < 2 KB), `.woff2` 3.20 MB, `.ort` 1.84 MB, `.bcmap` 1.11 MB, `.ttf` 0.55 MB, `.css` 0.37 MB (25 files) |
| Entry JS (`index-*.js`) | 296.11 KB (96.84 KB gzip) | Budget 300 KB / 100 KB gzip (met) |
| Entry CSS (`index-*.css`) | 49.35 KB (13.15 KB gzip) | Budget 80 KB (met) |
| Top JS chunks | `pdfWorker` 1,342.8 KB, `ModelView` 657.5 KB, `pdf-lib` (`index-*`) 542.8 KB, `xlsx` 488.3 KB, `pdf` 375.3 KB, `index` 296.1 KB, `katex` 255.8 KB, `pdf_viewer` 175.1 KB, `docx-preview` 170.2 KB, `PdfView` 86.4 KB | 165 total JS chunks (~9.1 KB CSP hashes on macOS) |

### Interaction latency & smoothness (v1.9.0 release, 1x `n=5` / 6x `n=3`)

| Action | 1x median (p95, LT>50 / maxLT) | 6x median (p95, LT>50 / maxLT) | Budget (1x / 6x) |
|---|---|---|---|
| No-op floor | 40.5 ms (41.5, 0) | 49.6 ms (56.2, 0) | — |
| Open recent PDF (`mid1.pdf`) | **356.2 ms** (382.1, 5 / 96 ms) | **3,390.5 ms** (3,438.2, 31 / **1,803 ms**) | **220 ms / 1,200 ms** |
| Switch tab | 41.0 ms (42.2, 0) | **316.5 ms** (444.7, 4 / 254 ms) | floor / **200 ms** |
| Page Down in PDF | 48.6 ms (54.2, 0) | **330.3 ms** (348.3, 4 / 333 ms) | floor / **200 ms** |
| Find open | 40.4 ms (48.9, 0) | 170.2 ms (176.3, 3 / 63 ms) | floor / 200 ms |
| Find type 5 chars (`works`) | **493.4 ms** (548.0, 0) | **1,151.6 ms** (1,977.2, 25 / 265 ms) | **400 ms / 600 ms** |
| Side panel open | 58.3 ms (70.2, 4 / 85 ms) | **519.5 ms** (570.4, 9 / **433 ms**) | floor / **200 ms** |
| Side panel close | 54.2 ms (59.5, 0) | **486.0 ms** (493.5, 9 / **313 ms**) | floor / **200 ms** |
| File menu open | 44.1 ms (54.7, 0) | **591.1 ms** (622.6, 8 / **528 ms**) | floor / **200 ms** |
| Go Home | 40.3 ms (41.0, 0) | **218.2 ms** (346.5, 3 / 275 ms) | floor / **200 ms** |
| Open Settings | 47.6 ms (168.6, 1 / 85 ms) | **368.0 ms** (p95 **1,895.1**, 10 / **716 ms**) | floor / **300 ms** |
| Switch theme | **64.3 ms** (85.8, 1 / 55 ms) | **657.4 ms** (710.1, 10 / **580 ms**) | floor / **200 ms** |
| Open Tools | 41.2 ms (67.9, 0) | 300.9 ms (p95 983.3, 10 / 285 ms) | floor / 300 ms |

| Smoothness test | 1x (p50 / p95 / max, >33 ms, LT) | 6x (p50 / p95 / max, >33 ms, LT) |
|---|---|---|
| Home recents scroll (4 s) | 16.7 / 16.8 / 16.9 ms, 0 >33, 0 LT | **33.4 / 83.3 / 116.6 ms, 47 >33, 39 LT (117 ms)** |
| PDF scroll (4 s) | 16.7 / 16.8 / 16.9 ms, 0 >33, 0 LT | 16.7 / 50.0 / 250.0 ms, **20 >33**, 10 LT (247 ms) |
| Large workbook (`large.xlsx`) scroll (4 s) | 16.7 / 16.8 / 50.0 ms, 2 >33, 0 LT | 18.3 / **215.4 / 267.5 ms, 21 >33, 39 LT (151 ms)** |
| Window resize, Home only (1.5 s) | 16.7 / 16.8 / 16.9 ms, 0 >33, 0 LT, 10 IPC | **35.9 / 116.0 / 124.8 ms, 16 >33, 11 LT (98 ms)** |
| Window resize, 4 PDF tabs (1.5 s) | 16.7 / 16.9 / 99.8 ms, 2 >33, 2 LT (81 ms), 16 IPC | 18.0 / **715.9 / 912.9 ms**, 2 >33, 3 LT (**813 ms**) |

### IPC & Backend hot paths (v1.9.0 release)

| Flow | Calls | Args B | Result B | Total ms | Calls >50 ms | Top commands |
|---|---|---|---|---|---|---|
| Startup (reload) + 5 s | 26 | 1,110 | 53,163 | 1,239.2 ms | 9 | `plugin:event\|listen` x9 (406 ms), `store_get` x7 (427 ms), `trace_mark` x3 (133 ms), `launch_files` (88 ms), `trace_enabled` (72 ms), `is_maximized` (39 ms), `is_fullscreen` (36 ms), `set_background_color` (34 ms) |
| Open argv `small.pdf` | 15 | 20,124 | 16,705 | 549.1 ms | 2 | `store_get` x4 (275 ms), `store_set` x4 (98 ms), `trace_mark` (86 ms) |
| Open argv `big.pdf` (22 MB) | **48** | 24,497 | 4,181,052 | **2,908.7 ms** | **32** | **`read_file_range` x35 (2,458.8 ms, avg 70.3 ms, max 97.9 ms)**, `store_get` x3 (218 ms), `store_set` x4 (119 ms) |
| Open argv `mid1.pdf` (1.9 MB) | 13 | 20,112 | 1,922,656 | 477.2 ms | 3 | `store_set` x4 (249 ms, max 204 ms), `store_get` x3 (92 ms), `read_file` (80 ms) |
| Open recent `mid1.pdf` | 7 | 15,173 | 1,922,255 | 267.0 ms | 2 | `store_set` x1 (140 ms), `read_file` x1 (64 ms), `store_get` x2 (41 ms) |
| Switch tab | 4 | 14,903 | 14,683 | 50.4 ms | 0 | `set_title` x2 (29 ms), `store_set` (12 ms), `store_get` (10 ms) |
| Scroll then stop (6 s) | 5 | 15,101 | 15,627 | 38.7 ms | 0 | `plugin:fs\|stat` x3 (16 ms), `store_get` (11 ms), `store_set` (11 ms) |
| Idle 60 s (PDF open) | 30 | 2,820 | 8,520 | 169.4 ms | 0 | `plugin:fs\|stat` x30 (avg 5.65 ms) |
| Resize (5 cycles) | **60** | 16,546 | 17,387 | **1,999.3 ms** | **17** | **`is_maximized` x19 (852 ms, max 273 ms)**, **`is_fullscreen` x19 (736 ms, max 174 ms)**, `plugin:fs\|stat` x8 (319 ms) |

Command latencies across all recorded flows (`n` / median / p95 / max): `read_file_range` (35 / 77.0 / 96.4 / 97.9 ms), `store_get` (29 / 29.0 / 134.7 / 160.3 ms), `store_set` (28 / 14.3 / 144.6 / 204.2 ms), `plugin:fs|stat` (57 / 5.7 / 16.2 / 149.9 ms), `plugin:fs|read_file` (4 / 72.0 / 364.2 / 414.4 ms), `plugin:window|is_maximized` (23 / 10.4 / 169.9 / 272.8 ms), `plugin:window|is_fullscreen` (23 / 11.1 / 168.0 / 173.6 ms), `plugin:updater|check` (1 / 6,497.7 ms).

### Build & tooling (v1.9.0 baseline, 2026-11-22)

| Step | Time | Note |
|---|---|---|
| Typecheck (`npx tsc --noEmit`, TS 5.9.3) | **20.62 s** | Local |
| Frontend prod build (`npm run build`, Vite 5.4.21 + `check-dist.mjs`) | **44.58 s** (Vite 25.08 s, 2,381 modules) | Local |
| Vite dev server cold start | **5.38 s** wall (`VITE ready in 978 ms`) | Local |
| Lint (`npm run lint` / `biome check .`, Biome 1.9.4) | **21.21 s (exit 1, 3,579 files)** | Scans untracked dirs; `src scripts tests` only = 4.43 s (Biome 1.32 s, 369 files, exit 0) |
| Incremental `cargo check` / `cargo clippy -- -D warnings` | 2.50 s / 18.71 s | Local (`rustc 1.99.0`) |
| Clean CI release build (`release.yml` run `44773820476`) | Win 538 s, macOS 553 s, Linux 361 s, Android 452 s | GitHub Actions (`validate.yml`: Frontend 76 s, Rust 190 s, E2E 316 s) |

## 2c. Final release measurements (v1.10.0 candidate, commit `247b997`, 2026-11-22)

Measured on the CI-built Windows release MSI (`validate.yml` run `44960868394`, extracted `paperwren.exe` 26,105,344 B) on the same Windows 10 i7-7820HQ / 16 GB / WebView2 157 machine at both `1x` and `6x` CDP CPU throttle using the exact same benchmark harness as Section 2b.

### Start-up (v1.10.0 release vs v1.9.0)

| Metric | First run | Warm median (1x) | 6x | vs v1.9.0 baseline |
|---|---|---|---|---|
| Plain launch: window created / visible | 544 / 567 ms | 596 / 619 ms | — | Quieter OS background (13–23% vs 47–69% at baseline); code->home = 3–7 ms |
| Plain launch: Home ready | 769 ms | 879 ms (min 805) | — | Baseline 2,379 ms (lower OS contention; see reload below for OS-independent gain) |
| Launch with `small.pdf`: first page | 1,279 ms | 1,838 ms (min 1,674) | — | Baseline 3,241 ms; `home -> first_page` = 513 ms |
| Launch with `big.pdf` (22 MB, 255p): first page | 1,884 ms | 1,873 ms (min 1,871) | — | Baseline 2,427 ms (**-22.8%**); `home -> first_page` **1,143 -> 524 ms (-54.2%, 2.2x faster)** |
| Web layer reload to Home painted | 63.9 ms | **72.7 ms** (dom 55.1 ms) | **506.2 ms** (min 484.9, max 545.3) | **-24.7% at 1x** (96.5 -> 72.7 ms); **-37.6% at 6x** (810.9 -> 506.2 ms, budget 700 ms **met**) |

### Idle CPU & wakeups (all 7 processes, 35 s window after 25 s settle, v1.10.0 release)

| State | CPU (% 1 core) | CPU-s/min | Mcycles/min | OS ctx/s | JS timers/min | IPC calls/30s | Private MB |
|---|---|---|---|---|---|---|---|
| Home, focused | 1.25% | 0.750 | 1,444.5 | 19.0 | 0 | 0 | 176.8 MB |
| Home, unfocused | 0.52% | 0.314 | 853.2 | 7.0 | 0 | 0 | 176.6 MB |
| Home, minimised | 0.29% | 0.171 | 814.6 | 8.5 | 0 | 0 | 171.8 MB |
| PDF open (`mid1.pdf`), focused | 0.62% | 0.371 | 1,164.9 | 40.2 | 30 int (2000 ms) | 15 (`plugin:fs\|stat`, 67.1 ms) | 225.3 MB |
| PDF open (`mid1.pdf`), unfocused | 0.49% | 0.297 | 1,517.5 | 42.3 | 30 int* | 15 (`plugin:fs\|stat`, 66.5 ms)* | 216.3 MB |
| PDF open (`mid1.pdf`), minimised | **0.46%** | **0.274** | **958.8** | **12.3** | **0** | **0** | **213.2 MB** |

- **Minimised PDF improvement vs v1.9.0:** `plugin:fs|stat` polls **30/min -> 0/min**, OS `ctx/s` **47.6 -> 12.3 (-74.2%)**, `main` process **0% CPU / 0 ctx/s**, Mcycles/min **2,378.1 -> 958.8 (-59.7%)**, idle CPU **1.21% -> 0.46% (-62.4%)**, Private RAM **229.6 -> 213.2 MB (-16.4 MB)**.
- *Note on `idle-unfocused-pdf`: the automated overnight run ran on a locked Windows desktop where `GetForegroundWindow()` returns `0` from frame 0, so synthetic `unfocus` did not emit a Win32 `WM_KILLFOCUS` transition. On an unlocked desktop, blurring the window emits Tauri `onFocusChanged(false)` and stops the `FileChanged` timer (0 polls/min); minimizing always triggers `Webview::hide()` even on a locked screen.

### Memory (all 7 processes, private bytes, v1.10.0 release)

| State | Private MB (vs v1.9.0) | Working Set MB | JS Heap MB | DOM nodes | Workers |
|---|---|---|---|---|---|
| Home idle (30 s) | **212.9 MB** (-7.4 MB) | 419.7 MB | 5.4 MB | 1,513 | 1 (spare) |
| Small PDF open | **269.7 MB** (-20.4 MB; budget 270 MB **met**) | 487.0 MB | 7.4 MB | 1,614 | 1 |
| Big PDF open (22 MB, 255p) | 346.2 MB (mid 339.4 MB) | 552.8 MB | 8.5 MB | 3,427 | 1–2 |
| 5 tabs open | **399.6 MB** (-69.7 MB, -14.9%; budget 430 MB **met**) | 633.7 MB | **10.1 MB** (-26%) | **2,868** (-11%) | 4 |
| 30 s after closing all tabs | 283.9 MB (+0.8 MB) | 513.3 MB | 8.8 MB | 1,492 | 1 |
| Leak check: 20x open/close `big.pdf` | Flat (slope -9.09 MB/r; r1 449.9 -> r20 525.8 MB) | -9.72 MB/r | **-0.014 MB/r** (9.3 -> 10.7 MB) | **-97.8/r** (returns to 1,551 nodes / 452 listeners) | 1 |
| 10-minute scripted use (46 loops) | t=30s 862.1 -> t=600s **1,098.3 MB** (-79.5 MB vs v1.9.0's 1,177.8 MB) | — | **14.1 -> 13.7 MB (flat)** | **2,513 -> 2,387 (flat)** | 1–3 |

### Size (v1.10.0 release vs v1.9.0)

| Artifact | v1.9.0 release | v1.10.0 release (`44965873237`) | Delta |
|---|---|---|---|
| Installed `paperwren.exe` (Windows) | 26,014,720 B (24.81 MiB) | 26,105,344 B (24.90 MiB) | +90.6 KB (Tauri 2.12.7 / wry 0.57.3 + minimize hook; under 27 MB budget) |
| Windows NSIS / MSI installer | 23,529,036 B / 23,986,176 B | 23,537,315 B / 24,014,848 B | +8.3 KB / +28.7 KB (under 24 MB NSIS budget) |
| macOS universal DMG / `.app.tar.gz` | 47,881,919 B / 47,924,834 B | **47,861,688 B / 47,893,698 B** | **-20.2 KB / -31.1 KB** |
| Linux `.deb` / `.rpm` / `.AppImage` | 24,203,452 / 24,204,686 / 102,754,808 B | **24,176,886 / 24,181,562 / 102,734,328 B** | **-26.6 KB / -23.1 KB / -20.5 KB** |
| Android APK | 77,844,901 B | **77,842,005 B** | **-2.9 KB** |
| `dist/` total | 42,917,175 B (570 files) | **42,898,544 B** (581 files) | **-18.6 KB** |
| Entry JS preload sum | 303,950 B (296.8 KiB) | **302,889 B (295.8 KiB)** | **-1.1 KB** (under 300 KB budget) |
| Total CSS (`dist/`) | 394,897 B | **386,390 B** | **-8.5 KB** |

### Interaction latency & smoothness (v1.10.0 release, 1x `n=5` / 6x `n=3`)

| Action | 1x median (LT>50 / maxLT) | 6x median (p95, LT>50 / maxLT) | 6x vs v1.9.0 | Budget (1x / 6x) |
|---|---|---|---|---|
| No-op floor | 51.7 ms (0) | 54.1 ms (54.4, 0) | — | — |
| Open recent PDF (`mid1.pdf`) | **278.5 ms (0 / 0 ms)** | **950.2 ms** (1,014.6, 11 / **71 ms**) | **-72.0% (3.6x faster; maxLT -96%)** | 220 / 1,200 ms (6x **met**) |
| Switch tab | 46.2 ms (0) | **99.5 ms** (189.2, 3 / 152 ms) | **-68.6% (3.2x faster)** | floor / 200 ms (**met**) |
| Page Down in PDF | 51.8 ms (0) | **202.6 ms** (372.3, 3 / 77 ms) | **-38.7% (maxLT -77%)** | floor / 200 ms |
| Find open | 51.3 ms (0) | **63.7 ms** (148.2, 1 / 94 ms) | **-62.6% (2.7x faster)** | floor / 200 ms (**met**) |
| Find type 5 chars (`works`) | 487.3 ms (0) | **697.2 ms** (803.1, 2 / 164 ms) | **-39.5% (p95 -59%, LT 25 -> 2)** | 400 / 600 ms |
| Side panel open | **49.1 ms (0 / 0 ms)** | **234.0 ms** (338.7, 11 / 295 ms) | **-55.0% (2.2x faster)** | floor / 200 ms |
| Side panel close | 49.5 ms (0) | **220.6 ms** (253.0, 7 / 164 ms) | **-54.6% (2.2x faster)** | floor / 200 ms |
| File menu open | 47.3 ms (0) | **189.0 ms** (199.8, 3 / 161 ms) | **-68.0% (3.1x faster)** | floor / 200 ms (**met**) |
| Go Home | 47.9 ms (0) | **171.7 ms** (226.5, 4 / 151 ms) | **-21.3% (maxLT -45%)** | floor / 200 ms (**met**) |
| Open Settings | 50.5 ms (1 / 63 ms) | **268.6 ms** (1,099.3, 5 / 441 ms) | **-27.0% med (-42% p95)** | floor / 300 ms (**met**) |
| Switch theme | **54.2 ms (0 / 0 ms)** | **244.4 ms** (292.5, 7 / 170 ms) | **-62.8% (2.7x faster; maxLT -71%)** | floor / 200 ms |
| Open Tools | 47.3 ms (0) | **152.1 ms** (815.1, 5 / 235 ms) | **-49.5% (2.0x faster)** | floor / 300 ms (**met**) |

| Smoothness test | 1x (p50 / p95 / max, >33 ms, LT) | 6x (p50 / p95 / max, >33 ms, LT) | vs v1.9.0 (6x) |
|---|---|---|---|
| Home recents scroll (4 s) | 17.2 / 34.5 / 35.3 ms, 26 >33, 0 LT | **18.0 / 53.9 / 412.6 ms, 48 >33, 3 LT (65 ms)** | p50 **33.4 -> 18.0 ms**, p95 **83.3 -> 53.9 ms**, LT **39 -> 3 (-92%)**, Paint **1,335 -> 212 ms (-84%)** |
| PDF scroll (4 s) | 17.2 / 18.0 / 29.3 ms, 0 >33, 0 LT | 18.0 / **37.7** / 196.5 ms, 26 >33, **5 LT (198 ms)** | p95 **50.0 -> 37.7 ms**, LT **10 -> 5 (-50%)** |
| Large workbook (`large.xlsx`) scroll (4 s) | 17.2 / 18.1 / 25.4 ms, **0 >33, 0 LT** | 35.9 / **161.2** / 376.1 ms, 32 >33, **29 LT (118 ms)** | p95 **215.4 -> 161.2 ms (-25%)**, LT **39 -> 29**, Paint **447 -> 246 ms (-45%)**, Layout **264 -> 183 ms (-31%)** |
| Window resize, Home only (1.5 s) | 17.4 / 18.1 / 18.2 ms, 0 >33, 0 LT, **8 IPC** | 35.9 / **78.8 / 107.2 ms**, 24 >33, **4 LT (66 ms)**, 8 IPC | p95 **116.0 -> 78.8 ms (-32%)**, LT **11 -> 4 (-64%)** |
| Window resize, 4 PDF tabs (1.5 s) | 17.9 / 35.6 / 69.5 ms, 5 >33, **0 LT (0 ms)**, **13 IPC** | 125.7 / **365.6 / 393.9 ms**, 6 >33, 6 LT (**274 ms**), 13 IPC | 1x LT **2 -> 0**; 6x p95 **715.9 -> 365.6 ms (-49%)**, max **912.9 -> 393.9 ms (-57%)**, maxLT **813 -> 274 ms (-66%)** |

### IPC & Backend hot paths (v1.10.0 release vs v1.9.0)

| Flow | Calls (vs v1.9.0) | Total ms (vs v1.9.0) | Calls >50 ms | Key change |
|---|---|---|---|---|
| Startup (reload) + 5 s | 26 (26) | **700.2 ms** (1,239.2 ms, **-43.5%**) | **4** (9) | `set_background_color` deferred 250 ms (34 -> 3.8 ms) |
| Open argv `small.pdf` | 17 (15) | **327.5 ms** (549.1 ms, **-40.4%**) | **0** (2) | Cached module imports + async SHA-512 |
| Open argv `big.pdf` (22 MB) | **44** (48) | **1,413.2 ms** (2,908.7 ms, **-51.4%**) | **9** (32) | `read_file_range`: 35 -> **29 calls**, avg **70.3 -> 42.1 ms**, total **2,458.8 -> 1,221.2 ms (-50.3%)** |
| Open argv `mid1.pdf` (1.9 MB) | 15 (13) | **229.7 ms** (477.2 ms, **-51.9%**) | **0** (3) | Deferred signature scan + async SHA-512 |
| Open recent `mid1.pdf` | 9 (7) | **161.3 ms** (267.0 ms, **-39.6%**) | **0** (2) | Same |
| Scroll then stop (6 s) | 5 (5) | **28.9 ms** (38.7 ms, **-25.3%**) | 0 (0) | — |
| Resize (5 cycles) | **43** (60, **-28.3%**) | **1,324.1 ms** (1,999.3 ms, **-33.8%**; 331.1 ms quiet) | **4** (17, **-76.5%**) | `is_maximized` **19 -> 9**, `is_fullscreen` **19 -> 9** (-52.6% each) |

### Build & tooling (v1.10.0 vs v1.9.0)

| Step | v1.9.0 | v1.10.0 | Speedup |
|---|---|---|---|
| Typecheck (`npx tsc --noEmit`) | 20.62 s (TS 5.9.3) | **2.62 s** (TS 7.0.2) | **7.9x faster** |
| Vite prod build (`npx vite build`) | 25.08 s (Vite 5.4.21) | **2.35 s** build / **4.09 s** wall (Vite 8.3.8) | **6.1x–10.7x faster** |
| Full frontend build (`npm run build`) | 44.58 s | **5.22 s** (`tsc` + `vite build` + `check-dist.mjs`) | **8.5x faster** |
| Vite dev server cold start | 5.38 s wall (`ready in 978 ms`) | **0.41 s wall (`ready in 350 ms`)** | **13.1x faster** |
| Lint (`npm run lint`) | 21.21 s (exit 1, 3,579 files) | **0.76 s** Biome / **1.46 s** wall (exit 0, 374 files) | **14.5x faster** |
| `npm audit` vulnerabilities | 8 (2 critical, 3 high, 3 moderate) | **0** | **100% resolved** |
| CI `validate.yml` (`44960868394`) | Frontend 76 s, Rust 190 s, E2E 316 s | **Frontend 64 s, Rust 63 s, E2E 303 s** (7/7 jobs green) | Faster across all jobs |
| CI `release.yml` (`44965873237` vs `44773820476`) | Win 538 s, macOS 553 s, Linux 361 s, Android 452 s | **Win 448 s, macOS 420 s, Linux 256 s, Android 451 s** (5/5 jobs green) | **Win -17%, macOS -24%, Linux -29%** |

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
11. **No polling when events or observers exist.** Use native `onFocusChanged`, `ResizeObserver`, and shared `IntersectionObserver`s rather than intervals or per-row observers.
12. **No work while minimized, unfocused, or covered.** Stop file-check timers when blurred/minimized (hiding the child WebView2 on Windows minimize), apply `content-visibility: hidden` to covered tabs and Home, and gate closed `Sheet`/`Dialog` subtrees behind their open flag.
13. **No per-frame or per-scroll allocations in hot paths.** Use numeric cell keys, cached canvas font state, memoized list rows, and off-thread `crypto.subtle.digest` for multi-megabyte content hashing.
14. **Never force synchronous style/layout after root mutations or on mount.** Avoid `getComputedStyle`, `scrollWidth`, and `scrollIntoView` right after toggling `data-theme`, `#root[inert]`, or mounting a screen.
15. **Measure before and after on a release build** (or label dev numbers explicitly), and revert any change that does not measurably help.

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
| 7 / Issues | Byte-range PDF streaming (`read_file_range`/`readRange`, deferred >16 MiB signature scan, 4 MP phone canvas cap); extracted 31 KiB SVG textures to `public/textures/*.svg` and removed `* { scrollbar-color }`; lazy-loaded `TabStrip`, `SplitDivider`, `Updates`, `FolderList`, `RenameDialog`, `ShortcutList`, `ReadAloud`, `ToolsScreen` sub-tools, `ImageView` OCR, and broke `settings.ts -> speech.ts`; narrow `useSetting`/`useSettingsOf` across all viewers and `Shell`; paused `FileChanged` timer while blurred/hidden; zeroed offscreen canvases in `FillPage`, `PageThumb`, `PdfThumbs`, `ScanTool`/`ScanEditor` and bounded tool queues/caches; removed `sync_all` on `thumb_*`, `HashSet` in `folder.rs`, `Condvar` in `placement.rs`, `save_as` zero-clone; cut Find debounce and cached `FindResults` page text | Measured in v1.9.0 release baseline (Section 2b): entry JS 362 -> 296 KB, entry CSS 104 -> 49 KB, 20x leak +2,100 -> 0 nodes, 10-min soak 4.5 GB -> 1.18 GB |
| OPT-10 | `biome.json`: enable `vcs.useIgnoreFile: true`, deduplicate `src-tauri/target/**`, ignore local scratch folders (`1414305`) | Local `npm run lint`: **21.21 s (exit 1, 3,579 files) -> 0.77 s Biome / 1.46 s wall (exit 0, 374 files)** (14.5x faster). Kept |
| OPT-01 | `src/lib/docMarks.ts`, `PdfView.tsx`, `ToolsScreen.tsx`: off-thread WebCrypto `contentKeyAsync()` via `crypto.subtle.digest("SHA-512")` with sync fallback (`df14cdc`) | Release (6x): eliminated 667 ms pure-JS SHA-512 hotspot; `open-recent` **3,390.5 -> 1,029.8 ms** (Tier 1) -> **950.2 ms** (final), maxLT **1,803 -> 71 ms (-96%)**; 1x **356.2 -> 278.5 ms (0 LT)**. Kept |
| OPT-02 | `useExitPresence.ts`, `Overlay.tsx`: lazy cached `--t-fast` on unmount; direct style placement in `MenuPanel` before `useModalFocus`; `#root[inert]` deferred to `useEffect` (`384e84c`) | Release (6x): `file-menu` **591.1 -> 298.7 ms** (Tier 1) -> **189.0 ms** (with P6-R1, **-68%**, budget 200 ms met). Kept |
| OPT-03 | `windowBackground.ts`, `settings.tsx`: static 5-theme `--canvas` RGB map, cached window import, skip redundant `dataset.theme` write, defer initial startup canvas sync 250 ms (`58917d8`) | Release: eliminated 562 ms sync `getComputedStyle` on theme switch; startup `set_background_color` 34 -> 3.8 ms; combined with P6-R1 `switch-theme` 6x **657.4 -> 244.4 ms (-63%)**, 1x **64.3 -> 54.2 ms (0 LT)**. Kept |
| OPT-04 | `Home.module.css`, `Home.tsx`: compositor layer + containment on `.scroll`, containment on `.row`, shared `IntersectionObserver`, memoized `visible`/`pinned`/`recent` and `RecentRow`, minute-cached `relativeTime` (`ba5874f`) | Release (6x `home-recents-scroll`): Paint **1,334.5 -> 144.6–212 ms (-84% to -89%)**, LT>50 **39 -> 3 (-92%)**, p50 **33.4 -> 18.0 ms**, p95 **83.3 -> 53.9 ms**. Kept |
| OPT-05 + fix | `FileChanged.tsx`, `backend.ts`, `src-tauri/src/lib.rs`: skip non-`path` polling, native `onFocusChanged`, cached Tauri module imports, Windows child `Webview::hide()`/`show()` matching frameless iconic size `<= 300 × 100 && is_minimized()` (`f513a30`, `de20917`) | Release (`idle-minimised-pdf`): `plugin:fs\|stat` polls **30/min -> 0/min**, `ctx/s` **47.6 -> 12.3 (-74%)**, `main` CPU **0% / 0 ctx/s**, total CPU **1.21% -> 0.46% (-62%)**, Mcycles/min **2,378 -> 959 (-60%)**. Kept |
| OPT-06 | `PdfView.tsx`, `pdfTools.ts`, `PdfThumbs.tsx`, `pdfEngine.ts`: on-demand `signatureScan` (check page signature spots first), hoisted `BYTE_RANGE`, lazy `CropPages`, rAF/skip-p1 `PdfThumbs` scroll & offscreen `RenderTask` cancel, chunked base64 thumbs, cached `loadEngine()` (`700d941`) | Release (6x): `side-panel-open` **519.5 -> 299.2 -> 234.0 ms (-55%)**; 1x **58.3 -> 49.1 ms (0 LT)**; eliminated up to 16 MiB `getData()` copy & 256 timer wakeups on normal PDFs. Kept |
| OPT-07 | Closed `Sheet`/`Dialog` gating across 6 files, cached `canWebShare()`, `Promise.all` Settings mount + containment, `memo(SlideCanvas)`, lazy Office/EXIF details, skip desktop URI-heal timers, skip `Marking` rAF when collapsed, fast `formatNumber` (`b0e213f`) | Release (6x): `open-settings` p95 **1,895 -> 443 ms**, `open-tools` **300.9 -> 152.1 ms (-50%)**, `find-open` **170.2 -> 63.7 ms (-63%)**, 5 tabs RAM **469.3 -> 399.6 MB (-70 MB)**. Kept |
| OPT-08 | `SheetView.tsx`, `sheetHelpers.ts`, `Sheet.module.css`: numeric `key(r,c)` + unmerged fast path, single `hasRtl`, two-level `textWidth` cache, `contain: strict` on `.cell` (`a3748c1`) | Release (6x `xlsx-scroll`): Paint **447.4 -> 245.8 ms (-45%)**, Layout **263.5 -> 182.5 ms (-31%)**, p95 **215.4 -> 161.2 ms (-25%)**, 1x `>33 ms` **2 -> 0**. Kept |
| OPT-09 | `pdfRange.ts`, `PdfView.tsx`, `open.rs`, `settle.ts`, `WindowControls.tsx`, `fullscreen.ts`: desktop 256 KiB `RANGE_CHUNK`, defer streamed `readSample()` until `drawn`, zero-alloc `eq_ignore_ascii_case`, trailing-only `afterQuiet(200)` resize sync (`4f6e8e1`) | Release IPC: `open-argv(big.pdf)` **2,908.7 -> 1,413.2 ms (-51%, `read_file_range` 35 -> 29, avg 70.3 -> 42.1 ms)**; `big.pdf` `home -> first_page` **1,143 -> 524 ms (-54%)**; `resize-5cycles` `is_maximized`/`is_fullscreen` **19 -> 9 each (-53%)**. Kept |
| OPT-11 | Compatible minor/patch updates: `tauri` 2.12.7, `tao` 0.37.3, `wry` 0.57.3, `plugin-fs` 2.7.1, `plugin-dialog` 2.8.4, `plugin-updater` 2.14.1, `@tauri-apps/api` 2.12.5, `marked` 18.2.1, `highlight.js` 11.12.0, `dompurify` 3.4.18, `katex` 0.19.1, `docx-preview` 0.4.1 (`803d465`) | CI `validate.yml` 7/7 green; `REMOVE_UNUSED_COMMANDS` check green; dropped duplicate `windows-sys` 0.59/0.60. Kept |
| OPT-12 | Upgrade `typescript` `5.9.3 -> 7.0.2` (native Go compiler), drop deprecated `baseUrl` (`d8ac2ea`) | Local `npx tsc --noEmit`: **20.62 s -> 2.62 s (7.9x faster)**. CI green. Kept |
| OPT-13 | Upgrade `vite` `5.4.21 -> 8.3.8`, `@vitejs/plugin-react` `4.7.0 -> 6.3.0`, `vitest` `2.1.9 -> 5.1.1` (Oxc minifier & JSX, keeping `build.target: "chrome89"`) (`f3b16e9`) | `vite build` **25.08 s -> 2.35–4.09 s**; `npm run build` **44.58 s -> 5.22 s (8.5x)**; dev start **5.38 -> 0.41 s (13x)**; `npm audit` **8 -> 0 CVEs**; `node_modules` **199 -> 148**; MSI -41 KB, NSIS -31 KB, exe -37 KB, entry JS -1.1 KB. CI 7/7 green. Kept |
| P6-R1 | Phase 6 Round 1 (`247b997`): `content-visibility: hidden` on `.shell[data-away]` and delayed (250 ms) `.page[data-away]` on `Home`; skip `Settings` `SectionList` mount `scrollWidth` & initial `onScroll()` | Release (6x): `file-menu` **298.7 -> 189.0 ms** (styled elements 1,202 -> 265), `switch-theme` **650.7 -> 244.4 ms** (2,194 -> 583 elements), `switch-tab` **259.3 -> 99.5 ms**, `open-settings` **364 -> 268.6 ms** (384 ms mount layout gone), `resize-4-pdf-tabs` 6x p95 **550.8 -> 365.6 ms** (1x LT **0**). Phase 6 **stop criterion met** (no remaining app-owned hotspot >10% without Tier 3). Kept |

### Tried and not kept

| Idea | Result |
|---|---|
| Sheet exit animation | Removed: failed the 6x budget (MOTION.md section 7) |
| `@biomejs/biome` `1.9.4 -> 2.6.8` (OPT-14) | Reverted: only -135 ms faster (767 -> 632 ms) with 0 CVEs in 1.9.4, while forcing import/CSS churn across 164 files and flagging 20 intentional Chrome 89 CSS fallbacks as `noDuplicateProperties` |
| `lucide-react` `0.545.0 -> 1.77.0` (OPT-15) | Reverted: compiled cleanly across all 144 icons, but regressed entry JS **+3,487 B**, total JS **+8,896 B**, and transformed modules **+469** with 0 CVE or speed gain |

### Not done (and why)

| Item | Why |
|---|---|
| B-3, why an unfocused window uses 6 to 8 times the cycles | The optimisation loop (step 7) was not run in this pass |
| The 1.4 s long task in a PDF open at 6x, the 500 ms delay in find | Same |
| Big moves E (byte-range loading), F (WebView2 memory level), G (PDF tools in a worker), H (scales) | Not approved for this pass |
| Android and macOS and Linux numbers | No such device or build here |

## 7. Release re-measurement

All three columns below were measured on packaged Windows release builds (`paperwren.exe`) on the same Windows 10 i7-7820HQ / 16 GB / WebView2 157 machine.

| Metric (from section 2) | v1.8.0 release | v1.9.0 release | v1.10.0 release (`247b997`) |
|---|---|---|---|
| Web reload to Home painted (1x / 6x) | 260 ms / 905 ms | 96.5 ms / 810.9 ms | **72.7 ms / 506.2 ms** |
| First page of 22 MB `big.pdf` at launch | 2,041 ms | 2,427 ms (`home->p1` 1,143 ms) | **1,873 ms (`home->p1` 524 ms)** |
| Wrong-colour window / jump at start | 0.9–1.0 s / yes | 0 frames / no | **0 frames / no** |
| Minimised PDF idle wakeups (`plugin:fs\|stat`) | 30 / min | 30 / min (1.21% CPU, 47.6 ctx/s) | **0 / min (0.46% CPU, 12.3 ctx/s)** |
| Open and close a 255-page PDF, per round | +2,100 nodes, +14 MB | 0 nodes (flat) | **0 nodes (flat)** |
| 5 tabs private RAM | 423 MB | 469.3 MB | **399.6 MB** |
| 30 s after closing every tab | 300 to 335 MB | 283.1 MB | **283.9 MB** |
| 10 minutes of scripted use | 4,508 MB and rising | 1,177.8 MB (45 loops) | **1,098.3 MB (46 loops, flat heap & DOM)** |
| Entry script / stylesheet | 362 KB / 104 KB | 296.8 KB / 49.4 KB | **295.8 KB / 52.0 KB (total CSS -8.5 KB)** |
| Windows NSIS installer / installed exe | 23.6 MB / 26.8 MB | 23.53 MB / 24.81 MiB | **23.54 MB / 24.90 MiB** |
| Open a recent PDF, click to first page (1x / 6x) | 254 ms / 2,160 ms | 356.2 ms / 3,390.5 ms | **278.5 ms (0 LT) / 950.2 ms (maxLT 71 ms)** |
| File menu at 6x | 696 ms | 591.1 ms | **189.0 ms** |
| Side panel open at 6x | 430 to 490 ms | 519.5 ms | **234.0 ms** |
| Open Settings at 6x | 500 ms | 368.0 ms (p95 1,895 ms) | **268.6 ms** |
| Switch theme at 6x | 386 ms | 657.4 ms | **244.4 ms** |
| Switch tab at 6x | 192 ms | 316.5 ms | **99.5 ms** |
| Go Home at 6x | 299 ms | 218.2 ms | **171.7 ms** |
| Resize, 4 PDF tabs (1x LT / 6x p95) | 16 LT / 5 frames | 2 LT / 715.9 ms p95 | **0 LT / 365.6 ms p95** |
| Window queries during 5 resize cycles | 126 (2 s) | 38 (`is_maximized` + `is_fullscreen`) | **18 (-52.6%)** |
| Frontend `npm run build` / `tsc` / `lint` | — | 44.58 s / 20.62 s / 21.21 s | **5.22 s / 2.62 s / 1.46 s (0.76 s Biome)** |
