# Modernization Report

Date: 2026-11-22 (release `v1.10.0`, baseline `v1.9.0` at `6e550b7`).

## 1. Upgraded in v1.10.0

### Toolchain and bundler (Tier 2)

| Package | Before (`v1.9.0`) | After (`v1.10.0`) | Commit | Measured impact |
|---|---|---|---|---|
| `typescript` | `5.9.3` | `7.0.2` (native Go compiler) | `d8ac2ea` | `npx tsc --noEmit`: **20.62 s -> 2.62 s (7.9x faster)**. Removed deprecated `baseUrl` from `tsconfig.json`. |
| `vite` | `5.4.21` | `8.3.8` (Rolldown + Oxc) | `f3b16e9` | `vite build`: **25.08 s -> 2.35–4.09 s**; full `npm run build`: **44.58 s -> 5.22 s (8.5x faster)**; dev server startup: **5.38 s (`ready in 978 ms`) -> 0.41 s (`ready in 350 ms`, 13x faster)**. Kept `build.target: "chrome89"`; switched minifier and Vitest JSX from `esbuild` to `oxc`. Entry JS `303,950 B -> 302,889 B`, CSS `394,897 B -> 386,390 B`. |
| `@vitejs/plugin-react` | `4.7.0` | `6.3.0` | `f3b16e9` | Native Oxc React Fast Refresh / JSX transform under Vite 8. |
| `vitest` | `2.1.9` | `5.1.1` | `f3b16e9` | **`npm audit`: 8 CVEs (2 critical, 3 high, 3 moderate) -> 0 CVEs**. `node_modules` package count: **199 -> 148 (-51 packages)**. CI Frontend job green (`validate.yml` run `44960868394`, 64 s total). |

### Tauri, runtime libraries, and Rust crates (Tier 1, `803d465`)

| Package / Crate | Before (`v1.9.0`) | After (`v1.10.0`) | Note |
|---|---|---|---|
| `tauri` / `tauri-build` / `tauri-runtime-wry` | `2.12.5` / `2.12.0` / `2.12.3` | `2.12.7` / `2.12.5` / `2.12.5` | Latest compatible 2.12 patch fixes; `REMOVE_UNUSED_COMMANDS` check passes. |
| `tao` / `wry` | `0.37.2` / `0.57.2` | `0.37.3` / `0.57.3` | Retains Android `onRenderProcessGone` patch compatibility (`scripts/install-android.mjs check` verified). |
| `tauri-plugin-fs` / `dialog` / `updater` | `2.5.2` / `2.7.3` / `2.13.3` | `2.7.1` / `2.8.4` / `2.14.1` | Picks up Android `plugin-fs` >= 2.7.0 OOM fix (`RESEARCH.md` R2-38). |
| `@tauri-apps/api` / `@tauri-apps/cli` | `2.12.0` / `2.12.0` | `2.12.5` / `2.12.6` | Parity with Rust `tauri` 2.12.7. |
| `marked` | `18.0.0` | `18.2.1` | Compatible minor update. |
| `highlight.js` | `11.11.1` | `11.12.0` | Compatible minor update. |
| `dompurify` | `3.3.3` | `3.4.18` | Latest XSS sanitizer updates. |
| `katex` | `0.16.45` | `0.19.1` | Compatible minor update; KaTeX chunk & fonts verified. |
| `docx-preview` | `0.3.7` | `0.4.1` | Compatible minor update; DOCX E2E tests pass. |
| Cargo lockfile deduplication | `windows-sys` 0.59 + 0.60 + 0.61 | Dropped duplicate `0.59` / `0.60` entries | Cleaner Rust dependency graph. |

### Patterns modernized

- **Off-thread SHA-512 (`df14cdc`)**: Replaced main-thread pure-JS SHA-512 over 2 MiB PDF samples (`docMarks.ts`) with native `crypto.subtle.digest("SHA-512", ...)` (keeping sync fallback and `sha512()` for 100k-round Office password derivation).
- **VCS-aware linting (`1414305`)**: Enabled Biome `vcs.useIgnoreFile: true` (`npm run lint` 21.21 s exit 1 -> 0.77 s exit 0).
- **Native WebView2 visibility & focus gating (`f513a30`, `de20917`)**: Paired Tauri `onFocusChanged` with Windows `tauri::Webview::hide()`/`show()` on minimize/restore so minimized PDFs drop to 0 timer wakeups and 0 `stat` IPC calls per minute.
- **CSS Containment & `content-visibility: hidden` (`ba5874f`, `a3748c1`, `247b997`)**: Replaced uncontained covered screens and unpromoted scrolling containers with modern CSS containment and offscreen subtree skipping (`chrome89+` safe).

## 2. Tested and reverted

| Package | Tested version | Reason reverted |
|---|---|---|
| `@biomejs/biome` | `1.9.4 -> 2.6.8` | Measured `npm run lint` improved by only 135 ms (767 ms -> 632 ms), while Biome 1.9.4 already has 0 CVEs. Biome 2 required import reordering across 143 files, CSS formatting churn across 21 files, and flagged 20 intentional Chrome 89 CSS fallbacks (`100vh`/`100dvh`, `rgba`/`color-mix`) under `noDuplicateProperties`. |
| `lucide-react` | `0.545.0 -> 1.77.0` | All 144 icons compiled cleanly, but the bundle regressed: entry JS grew **+3,487 B** (`302,695 -> 306,182 B`), total JS grew **+8,896 B** (`6,700,433 -> 6,709,329 B`), and transformed modules jumped **+469** (`2,363 -> 2,832`), with 0 CVE or runtime performance benefit. |

## 3. Still outdated and why deferred

| Dependency / Platform item | Current | Latest observed | Why deferred |
|---|---|---|---|
| `react` / `react-dom` (+ React Compiler) | `18.3.1` | `19.3.1` | Framework major migration; touches every screen, ref pattern, and test harness (Tier 3). |
| `pdfjs-dist` | `4.10.38` (legacy) | `6.5.438` | `pdfjs-dist` 5/6 raised baseline browser requirements beyond Chrome 89 Android WebViews; cannot verify old Android WebViews without physical devices (Tier 3). |
| `three` | `0.172.0` | `0.184+` | Lazy-loaded only for `.glb` 3D model viewing (`ModelView` chunk); breaking renderer/material changes across 12+ releases need dedicated visual testing. |
| `jszip` | `3.10.1` | `3.10.1` (unmaintained) | Stable; replacing with `fflate` requires auditing our ZIP-bomb central-directory security checks across DOCX/XLSX/PPTX/ODF/EPUB. |
| `@types/node` | `22.x` | `25.x` | Intentionally pinned to match CI `node-version: 22` so Node 24/25-only APIs cannot sneak into scripts. |
| Rust edition / MSRV | `2021` / `1.77.2` | `2024` / `1.99.0` | Kept to avoid breaking documented MSRV (`Cargo.toml`) without owner sign-off. |
| GitHub Actions Node 20 actions (`actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4`) | `v4` | `v5` (Node 24) | CI emits deprecation warning ("forced to run on Node.js 24"); safe to bump in a small dedicated CI maintenance PR. |

## 4. Recommended next upgrades

1. **GitHub Actions `v4 -> v5`** (Effort: S, Risk: Low) — clears CI Node 20 deprecation annotations.
2. **React 19 + React Compiler** (Effort: L, Risk: Medium) — removes manual memoization pressure across viewers and `SheetView`, after running the full Playwright and unit suites.
3. **`pdfjs-dist` 5/6 evaluation** (Effort: M–L, Risk: High on old Android) — test on a Chrome 89–100 Android WebView device or raise the minimum Android WebView floor explicitly.
4. **Biome 2.x** (Effort: M, Risk: Low) — adopt in a dedicated formatting-only PR once ready to accept the 164-file diff and configure `noDuplicateProperties` overrides for intentional CSS fallbacks.
