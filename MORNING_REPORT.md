# Morning Report — Paperwren v1.10.0

Date: 2026-11-22

## 1. Release & Rollback Summary

- **Version:** `v1.10.0` (bumped from `v1.9.0`, commit `557f964`)
- **Release status:** **DRAFT** (`draft: true`, `prerelease: false`). Kept as a draft because `src-tauri/tauri.conf.json` configures the GitHub auto-updater (`latest.json`), and Google Play upload was skipped.
- **Draft release URL:** https://github.com/Razee4315/Paperwren/releases/tag/untagged-414242b965ed9789e024 (also listed under https://github.com/Razee4315/Paperwren/releases)
- **Release workflow (`release.yml`, 5/5 jobs green, 15 signed assets attached):** https://github.com/Razee4315/Paperwren/actions/runs/44965873237
  - Signed Play AAB is archived as workflow artifact `Paperwren-android` without touching Google Play Console.
- **Validation workflow (`validate.yml`, 7/7 jobs green — Vitest 5 unit tests, Rust check/tests, Playwright E2E, Windows/macOS/Linux/Android builds):** https://github.com/Razee4315/Paperwren/actions/runs/44960868394
- **How to publish when ready:**
  1. Review the draft release on GitHub and test the installers (especially Windows minimize/restore and idle behavior).
  2. Click **Publish release** on the GitHub draft.
  3. Only after publishing, update `website/src/data/site.ts` from `1.9.0` to `1.10.0` and upload the signed Play AAB from the `Paperwren-android` workflow artifact if distributing on Google Play.
- **Rollback tag:** `pre-optimization-2026-11-22` at commit `6e550b7` (pushed to `origin`). To roll back `main`, inspect or revert against that tag; no commits were rebased or force-pushed.

## 2. Before vs After Summary (`v1.9.0` vs `v1.10.0`)

All runtime figures below were measured on packaged Windows release builds (`paperwren.exe`) on the same Windows 10 i7-7820HQ / 16 GB / WebView2 157 machine at both `1x` and `6x` CDP main-thread CPU throttling.

### Start-up, idle CPU, wakeups, and memory

| Metric | v1.9.0 (`6e550b7`) | v1.10.0 (`247b997` / `44965873237`) | Change |
|---|---|---|---|
| Web reload to Home painted (`1x` / `6x`) | `96.5 ms` / `810.9 ms` | **`72.7 ms` / `506.2 ms`** | **-24.7% / -37.6%** (6x budget `700 ms` met) |
| Launch `big.pdf` (22 MB, 255p) to page 1 | `2,427 ms` (`home->p1` `1,143 ms`) | **`1,873 ms` (`home->p1` `524 ms`)** | **-22.8%** total (**`home->p1` -54.2%**) |
| Plain launch to Home ready | `2,379 ms` (sys CPU 47–69%) | `879 ms` (sys CPU 13–23%) | Faster; lower OS noise at v1.10.0 run |
| Minimised PDF `plugin:fs\|stat` polls / min | `30 / min` | **`0 / min`** | **-100%** |
| Minimised PDF idle CPU (`% 1 core` / `main`) | `1.21%` (0.728 CPU-s/min) | **`0.46%` (0.274 CPU-s/min; `main` 0%)** | **-62.4%** |
| Minimised PDF OS context switches (`ctx/s`) | `47.6 / s` (`2,378` Mcycles/min) | **`12.3 / s` (`959` Mcycles/min)** | **-74.2% ctx/s** / **-59.7% Mcycles** |
| Home idle / Small PDF memory (Private MB) | `220.3 MB` / `290.1 MB` | **`212.9 MB` / `269.7 MB`** | **-7.4 MB / -20.4 MB** |
| 5 tabs memory (Private / JS Heap / DOM nodes) | `469.3 MB` / `13.7 MB` / `3,230` | **`399.6 MB` / `10.1 MB` / `2,868`** | **-69.7 MB (-14.9%) / -26% heap** |
| 20x open/close `big.pdf` leak check | Flat (`0` nodes leaked) | **Flat (`0` nodes leaked, `-0.014 MB/r` heap)** | Clean (`1,551` nodes on close) |
| 10-minute scripted soak (45 vs 46 loops) | `1,177.8 MB` | **`1,098.3 MB`** (`13.7 MB` heap flat) | **-79.5 MB** |

Note: the automated overnight `idle-unfocused-pdf` run ran on a locked Windows desktop where `GetForegroundWindow()` returns `0` from frame 0, so synthetic `unfocus` did not trigger a Win32 `WM_KILLFOCUS` transition; minimizing always triggers `Webview::hide()` even on a locked screen.

### Interaction latency & smoothness (`1x` and `6x`)

| Flow / Test | v1.9.0 `1x` | v1.10.0 `1x` | v1.9.0 `6x` | v1.10.0 `6x` | `6x` delta |
|---|---|---|---|---|---|
| Open recent PDF (`mid1.pdf`) | `356.2 ms` (maxLT 96 ms) | **`278.5 ms` (0 LT)** | `3,390.5 ms` (maxLT `1,803 ms`) | **`950.2 ms` (maxLT `71 ms`)** | **-72.0% (3.6x faster)** |
| Switch tab | `41.0 ms` | `46.2 ms` (0 LT) | `316.5 ms` | **`99.5 ms`** | **-68.6% (3.2x faster)** |
| Page Down in PDF | `48.6 ms` | `51.8 ms` (0 LT) | `330.3 ms` (maxLT `333 ms`) | **`202.6 ms` (maxLT `77 ms`)** | **-38.7%** (`maxLT -77%`) |
| Find open | `40.4 ms` | `51.3 ms` (0 LT) | `170.2 ms` | **`63.7 ms`** | **-62.6% (2.7x faster)** |
| Find type 5 chars (`works`) | `493.4 ms` | `487.3 ms` (0 LT) | `1,151.6 ms` (25 LT) | **`697.2 ms` (2 LT)** | **-39.5%** (`p95 -59%`) |
| Side panel open | `58.3 ms` (4 LT, 85 ms) | **`49.1 ms` (0 LT)** | `519.5 ms` | **`234.0 ms`** | **-55.0% (2.2x faster)** |
| Side panel close | `54.2 ms` | `49.5 ms` (0 LT) | `486.0 ms` | **`220.6 ms`** | **-54.6% (2.2x faster)** |
| File menu open | `44.1 ms` | `47.3 ms` (0 LT) | `591.1 ms` | **`189.0 ms`** | **-68.0% (3.1x faster)** |
| Go Home | `40.3 ms` | `47.9 ms` (0 LT) | `218.2 ms` | **`171.7 ms`** | **-21.3%** (`maxLT -45%`) |
| Open Settings | `47.6 ms` (1 LT, 85 ms) | `50.5 ms` (1 LT, 63 ms) | `368.0 ms` (p95 `1,895 ms`) | **`268.6 ms` (p95 `1,099 ms`)** | **-27.0%** (`p95 -42%`) |
| Switch theme | `64.3 ms` (1 LT, 55 ms) | **`54.2 ms` (0 LT)** | `657.4 ms` (maxLT `580 ms`) | **`244.4 ms` (maxLT `170 ms`)** | **-62.8% (2.7x faster)** |
| Open Tools | `41.2 ms` | `47.3 ms` (0 LT) | `300.9 ms` (p95 `983 ms`) | **`152.1 ms`** | **-49.5% (2.0x faster)** |
| Home recents scroll (4 s) | `16.7 / 16.8 ms`, 0 LT | `17.2 / 34.5 ms`, 0 LT | p50 `33.4`, p95 `83.3`, **39 LT** | **p50 `18.0`, p95 `53.9`, 3 LT** | **LT -92%, Paint -84%** |
| Large workbook scroll (`large.xlsx`) | 2 >33 ms, 0 LT | **0 >33 ms, 0 LT** | p95 `215.4 ms`, **39 LT** | **p95 `161.2 ms`, 29 LT** | **Paint -45%, Layout -31%** |
| Window resize, 4 PDF tabs | `99.8 ms` max, **2 LT** | **`69.5 ms` max, 0 LT** | p95 `715.9 ms`, maxLT `813 ms` | **p95 `365.6 ms`, maxLT `274 ms`** | **p95 -49%, maxLT -66%** |

### IPC, sizes, and build tooling

| Metric | v1.9.0 | v1.10.0 | Change |
|---|---|---|---|
| IPC: `startup(reload)+5s` total ms | `1,239.2 ms` (9 >50ms) | **`700.2 ms` (4 >50ms)** | **-43.5%** |
| IPC: `open-argv(big.pdf 22MB)` | `48` calls, `2,908.7 ms` | **`44` calls, `1,413.2 ms`** | **-51.4%** (`read_file_range` 35->29, 70.3->42.1 ms) |
| IPC: `resize-5cycles` | `60` calls (`38` max/full), `1,999.3 ms` | **`43` calls (`18` max/full), `1,324.1 ms`** | **-28.3% calls** (`is_maximized`/`is_fullscreen` -52.6%) |
| Entry JS preload / `dist/` total CSS | `303,950 B` / `394,897 B` | **`302,889 B` / `386,390 B`** | **-1.1 KB / -8.5 KB** (`dist/` -18.6 KB) |
| Signed release installers (`44965873237`) | Win NSIS `23.53 MB`, MSI `23.99 MB`; macOS DMG `47.88 MB`; deb `24.20 MB`; rpm `24.20 MB`; AppImage `102.75 MB`; APK `77.84 MB` | **macOS DMG `-20.2 KB`, `.app.tar.gz -31.1 KB`, deb `-26.6 KB`, rpm `-23.1 KB`, AppImage `-20.5 KB`, APK `-2.9 KB`**; Win NSIS `+8.3 KB`, MSI `+28.7 KB` | Smaller on macOS, Linux & Android; Windows +90.6 KB exe (Tauri 2.12.7 + minimize hook) |
| Typecheck (`npx tsc --noEmit`) | `20.62 s` (TS 5.9.3) | **`2.62 s` (TS 7.0.2)** | **7.9x faster** |
| Frontend prod build (`vite` / `npm run build`) | `25.08 s` / `44.58 s` (Vite 5.4.21) | **`2.35–4.09 s` / `5.22 s` (Vite 8.3.8)** | **6x–10.7x / 8.5x faster** |
| Dev server cold start (`vite`) | `5.38 s` (`ready in 978 ms`) | **`0.41 s` (`ready in 350 ms`)** | **13.1x faster** |
| Lint (`npm run lint`) | `21.21 s` (exit 1, 3,579 files) | **`0.76 s` Biome / `1.46 s` wall (exit 0, 374 files)** | **14.5x faster** |
| `npm audit` / `node_modules` count | `8` CVEs (2 crit, 3 high, 3 mod) / `199` pkgs | **`0` CVEs / `148` pkgs** | **100% CVEs cleared (-51 pkgs)** |
| CI `release.yml` durations (`44965873237`) | Win 538 s, macOS 553 s, Linux 361 s, Android 452 s | **Win 448 s, macOS 420 s, Linux 256 s**, Android 451 s | **-17% Win, -24% macOS, -29% Linux** |

## 3. Every Change Implemented

| Commit | Change | Measured improvement |
|---|---|---|
| `1414305` | OPT-10: Enable gitignore integration in `biome.json` and remove duplicate ignore pattern | Local `npm run lint` `21.21 s` (exit 1) -> `0.76 s` Biome / `1.46 s` wall (exit 0) |
| `df14cdc` | OPT-01: Add off-thread WebCrypto `contentKeyAsync()` in `docMarks.ts`, use in `PdfView.tsx` & `ToolsScreen.tsx` | Removed 667 ms pure-JS SHA-512 hotspot; 6x `open-recent` `3,390.5 -> 950.2 ms` (`maxLT` 1,803 -> 71 ms) |
| `384e84c` | OPT-02: Lazy cached `--t-fast` on exit in `useExitPresence.ts`; direct `MenuPanel` placement; defer `#root[inert]` to `useEffect` | Combined with `247b997`, 6x `file-menu` `591.1 -> 189.0 ms` (-68%) |
| `58917d8` | OPT-03: Direct 5-theme `--canvas` RGB map in `windowBackground.ts`, cached window import, deferred startup canvas sync | Removed 562 ms forced `getComputedStyle`; startup `set_background_color` `34 -> 3.8 ms`; `switch-theme` 6x `657.4 -> 244.4 ms` |
| `ba5874f` | OPT-04: GPU layer & containment on Home `.scroll` and `.row`, shared `IntersectionObserver`, memoized rows & `relativeTime` | 6x `home-recents-scroll` Paint `1,334.5 -> 212 ms` (-84%), LT>50 `39 -> 3` (-92%), p50 `33.4 -> 18.0 ms` |
| `f513a30` | OPT-05: Skip non-`path` polling & subscribe native `onFocusChanged` in `FileChanged.tsx`; cache Tauri imports in `backend.ts`; Windows child `Webview::hide()`/`show()` | Combined with `de20917`, stopped 30/min minimized `plugin:fs\|stat` polls |
| `700d941` | OPT-06: On-demand `signatureScan`, hoisted `BYTE_RANGE`, lazy `CropPages`, rAF/skip-p1 `PdfThumbs` scroll & cancel offscreen renders, chunked base64 thumbs, cached `loadEngine()` | 6x `side-panel-open` `519.5 -> 234.0 ms` (-55%), 1x 0 LT; avoided eager up-to-16 MiB copy + 256 `setTimeout(0)` wakeups |
| `b0e213f` | OPT-07: Gate closed `Sheet`/`Dialog` children, cache `canWebShare()`, `Promise.all` Settings mount + containment, `memo(SlideCanvas)`, lazy Office/EXIF details, skip desktop URI-heal timers, skip `Marking` rAF when collapsed, fast `formatNumber` | `open-settings` 6x p95 `1,895 -> 443 ms`, `open-tools` `-50%`, `find-open` `-63%`, 5 tabs RAM `-69.7 MB` |
| `a3748c1` | OPT-08: Numeric `key(r,c)` & unmerged fast path in `SheetView.tsx`, single `hasRtl`, two-level `textWidth` cache, `contain: strict` on `.cell` | 6x `xlsx-scroll` Paint `447 -> 246 ms` (-45%), Layout `264 -> 183 ms` (-31%), p95 `215 -> 161 ms` (-25%), 1x 0 frames >33 ms |
| `4f6e8e1` | OPT-09: Desktop 256 KiB `RANGE_CHUNK`, defer streamed `readSample()` past `drawn`, zero-alloc `eq_ignore_ascii_case` in `open.rs`, trailing `afterQuiet(200)` resize sync | `big.pdf` IPC `2,908.7 -> 1,413.2 ms` (-51%), `big.pdf` `home->p1` `1,143 -> 524 ms` (-54%), `resize` max/full queries `-52.6%` |
| `803d465` | OPT-11: Compatible minor/patch dependency updates (`tauri 2.12.7`, `tao 0.37.3`, `wry 0.57.3`, `plugin-fs 2.7.1`, `marked`, `highlight.js`, `dompurify`, `katex`, `docx-preview`, Cargo lockfile) | CI 7/7 green; `plugin-fs >= 2.7.0` Android OOM fix; dropped duplicate `windows-sys` 0.59/0.60 |
| `de20917` | Fix Windows frameless (`decorations: false`) minimize detection (`size <= 300x100 && is_minimized()`) | Confirmed minimized PDF `plugin:fs\|stat` `30 -> 0/min`, `ctx/s` `47.6 -> 12.3`, CPU `1.21% -> 0.46%` |
| `d8ac2ea` | OPT-12: Upgrade `typescript` `5.9.3 -> 7.0.2` (native Go compiler), drop deprecated `baseUrl` | `npx tsc --noEmit` `20.62 -> 2.62 s` (7.9x faster) |
| `f3b16e9` | OPT-13: Upgrade `vite` `5.4.21 -> 8.3.8`, `@vitejs/plugin-react` `4.7.0 -> 6.3.0`, `vitest` `2.1.9 -> 5.1.1` (Oxc, keeping `chrome89`) | `vite build` `25.08 -> 2.35–4.09 s`, dev `5.38 -> 0.41 s`, `npm audit` `8 -> 0 CVEs`, `-51` packages, smaller bundles & installers |
| `247b997` | Phase 6 Round 1: `content-visibility: hidden` on `.shell[data-away]` and delayed `.page[data-away]` on Home; skip `Settings` `SectionList` mount `scrollWidth` & initial `onScroll()` | 6x `file-menu` `299 -> 189 ms` (styled elements `1,202 -> 265`), `switch-theme` `651 -> 244 ms` (`2,194 -> 583` elements), `switch-tab` `259 -> 100 ms`, `open-settings` `364 -> 269 ms` |
| `3eaf43b` | Phase 7 docs: `PERFORMANCE.md`, `RESEARCH.md`, `MODERNIZATION.md`, `DECISIONS.md`, `OPTIMIZATION_PLAN.md`, `BEHAVIOR_NOTES.md`, `AGENTS.md` | Efficiency rules & before/after audit committed cleanly |
| `557f964` | Prepare `v1.10.0` release files and add optional `draft` `workflow_dispatch` input to `release.yml` | Draft multi-platform release `v1.10.0` built & verified cleanly (`44965873237`) |

## 4. Modernization Completed & Still Pending

- **Completed:** `typescript 7.0.2`, `vite 8.3.8`, `@vitejs/plugin-react 6.3.0`, `vitest 5.1.1`, `tauri 2.12.7`, `tao 0.37.3`, `wry 0.57.3`, `tauri-plugin-fs 2.7.1`, `tauri-plugin-dialog 2.8.4`, `tauri-plugin-updater 2.14.1`, `@tauri-apps/api 2.12.5`, `@tauri-apps/cli 2.12.6`, `marked 18.2.1`, `highlight.js 11.12.0`, `dompurify 3.4.18`, `katex 0.19.1`, `docx-preview 0.4.1`; WebCrypto off-thread SHA-512; CSS containment and `content-visibility: hidden`.
- **Still pending (with reasons in `MODERNIZATION.md`):**
  1. GitHub Actions `actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4` -> `v5` (clears CI Node 20 deprecation warnings; low risk, small PR).
  2. `react` / `react-dom` `18.3.1 -> 19.3.1` + React Compiler (Tier 3 framework major).
  3. `pdfjs-dist` `4.10.38 -> 5.x/6.x` (Tier 3; requires checking minimum Android WebView compatibility past Chrome 89).
  4. `three` `0.172.0 -> 0.184+` (lazy-loaded 3D `.glb` viewer only; needs visual verification).
  5. `jszip -> fflate` unification and Rust `edition = "2024"` / MSRV bump.

## 5. Changes Reverted or Skipped (and why)

- **Reverted `@biomejs/biome` `1.9.4 -> 2.6.8` (OPT-14):** Only 135 ms faster (`767 -> 632 ms`), Biome `1.9.4` already has 0 CVEs, while Biome 2 required import reordering in 143 files, CSS changes in 21 files, and flagged 20 intentional Chrome 89 CSS fallbacks (`100vh`/`100dvh`, `rgba`/`color-mix`) under `noDuplicateProperties`.
- **Reverted `lucide-react` `0.545.0 -> 1.77.0` (OPT-15):** Compiled cleanly across all 144 icons, but regressed bundle metrics: entry JS `+3,487 B` (`302,695 -> 306,182 B`), total JS `+8,896 B`, transformed modules `+469`, with 0 CVE or runtime gain.
- **Skipped updating `website/src/data/site.ts`:** Left on `1.9.0` while `v1.10.0` is a draft so website download links do not point at an unpublished release.
- **Stopped Phase 6 after Round 1:** Re-profiling `bin-p6r1` confirmed no remaining app-owned hotspot exceeds 10% of any flow; remaining costs are Blink layout/paint of visible nodes, pdf.js canvas drawing, React 18 virtualized cell DOM reconciliation, or WebView2/IPC floors (all Tier 3 territory).

## 6. Autonomous Decisions Made

Logged in `DECISIONS.md` (`D-01` through `D-14`):

- `D-01` / `D-02`: Validate native release builds from CI Windows MSI extracted cleanly in scratch while backing up and SHA-256 verifying `%APPDATA%` / `%LOCALAPPDATA%` (24/24 files, 0 mismatches).
- `D-03` / `D-04` / `D-05`: Preserve exact `#root[inert]`, signature banner behavior, and synchronous `contentKey` export alongside WebCrypto `contentKeyAsync`.
- `D-06` / `D-07`: Keep `build.target: "chrome89"` under Vite 8, `@types/node` on `22.x`, and Rust `edition = "2021"` / MSRV `1.77.2`.
- `D-08`–`D-14`: Defer Tier 3 items cleanly; revert OPT-14 (Biome 2) and OPT-15 (`lucide-react` 1.x); use `content-visibility: hidden` + delayed Home away + `Settings` mount layout guard; add optional `draft` input to `release.yml` (skipping Google Play upload when `draft=true`); stop after Phase 6 Round 1 and release as `v1.10.0` draft.

## 7. Tier 3 Proposals (not implemented tonight)

| ID | Proposal | Expected gain | Effort | Risk / why deferred |
|---|---|---|---|---|
| `T3-01` | Upgrade React `18.3.1 -> 19.3.1` + React Compiler | Automatic memoization across screens & sheet cells | L | Framework major + compiler transform across every view |
| `T3-02` | Evaluate & upgrade `pdfjs-dist` `4.10.38 -> 6.5.438` | Newer PDF rendering & worker improvements | M–L | Raised WebView baseline past Chrome 89; needs old-Android testing |
| `T3-03` | Stream large PDFs via Tauri `asset:` protocol (`convertFileSrc`) | Eliminates HTTP IPC overhead on large desktop/Android PDFs | M | Touches capabilities, CSP, asset scope, and Android/Linux Range handling |
| `T3-04` | Move heavy DOCX / EPUB / `@cantoo/pdf-lib` tool work to Workers | Stops main-thread stalls during heavy tool saves/exports | L | Architectural rewrite (`docx-preview` depends on DOM) |
| `T3-05` | Windows WebView2 `TrySuspend` + `MemoryUsageTargetLevel::Low` when minimized | Extra RAM & background timer drop on long minimizes | M | Risk of suspending active OCR/PDF export workers without job gating |
| `T3-06` | Native Rust OS file watcher (`notify`) replacing focused 2 s `FileChanged` poll | Focused PDF idle `ctx/s` `40.2 -> ~8/s` (`0` IPC/min) | M | New crate + Tauri command + capabilities + network/FS watcher edge cases |
| `T3-07` | Virtualized `<canvas>` or pooled DOM rows in `SheetView` | 6x `xlsx-scroll` p95 `161 ms -> <33 ms` | L | Full grid rewrite (selection, notes, RTL, merged cells, a11y) |

## 8. UI / Behavior Improvement Suggestions (out of scope tonight)

- **Find input responsiveness (`find-type-5`, `487 ms` at `1x`):** Add an instant first-match count / lightweight debounce feedback so typing short queries feels immediate without blocking.
- **Background tab memory control:** Offer an optional Settings toggle for lower-RAM devices to release background tab documents/memory more aggressively than the 4-tab / 200 MB cap.

## 9. Areas Needing Automated Tests (next session)

1. `contentKeyAsync` vs synchronous `contentKey` parity across small/large buffers and the non-WebCrypto fallback path.
2. `Home` delayed `data-away` (`250 ms` timer when covered, immediate synchronous removal when shown again, preserved scroll position, and `ResizeObserver` refit).
3. `Settings` `SectionList` chip highlight and horizontal scroll on manual scroll and section clicks (confirming no synchronous layout on mount).
4. `FileChanged` native `onFocusChanged` pause/resume + immediate file-mtime check on focus return + skipping non-`path` sources.
5. Windows frameless minimize (`159 x 27` iconic size + `is_minimized()`) hiding and restoring the child `Webview` (including taskbar restore and Explorer open-with while minimized).
6. `PdfView` on-demand `signatureScan` (unsigned ordinary PDF skips scan; unsigned form detects spot and offers Sign; signed PDF suppresses Sign offer and warns before edit/save).
7. `SheetView` numeric `key(r, c)` merge lookup on unmerged vs merged >1,000-row sheets and `textWidth` two-level font cache eviction.
8. `windowBackground` 5-theme `--canvas` RGB map consistency check against `src/styles/global.css` theme tokens.

## 10. Remaining Risks, Platform Limits & Unverified Environments

- **Platforms not benchmarked locally:** Physical macOS, Linux, and Android devices were not available locally (CI compiled and passed all unit, Rust, Playwright E2E, and packaging checks across all 4 platforms; runtime/CPU/memory profiles are Windows 10 WebView2 157 only).
- **Interactive Windows spot-checks to perform before publishing `v1.10.0`:**
  - Minimize Paperwren, leave it unfocused/minimized on an unlocked desktop, modify an open PDF from another app, then restore from taskbar and confirm immediate `FileChanged` prompt + 0 background polling.
  - Open another file via Windows Explorer double-click while Paperwren is minimized (`hand_over` restore path).
  - Verify Vite 8 `chrome89` bundle on an older Android WebView (Chrome 89–100) if a device/emulator is available.
- **Platform floors remaining:** Windows WebView2 still takes ~550–600 ms native process spawn on cold start, ~175–213 MB private bytes across 7 WebView2 processes at idle, and uses an HTTP/1.1 6-connection pool on `http://ipc.localhost`.
- **CI deprecation notice:** `validate.yml` and `release.yml` still use `@v4` Node 20 GitHub Actions (running on Node 24 with deprecation warnings); bump to `@v5` in a follow-up CI chore.
