# Overnight pass: brand, motion, performance, security (2026-09-10)

Scope: full UI/UX audit with live screenshots, a viewer rendering-pipeline
audit, a Rust/backend security and storage audit, and remediation of the
P0/P1 findings. Every claim below was verified against the built app in the
dev server (browser backend) or the patch dry run; items that need a real
device are listed at the end.

## 1. Brand and first-run (commits `0269e82`, plus polish in `fff571e`+)

**Found.** The launcher icon — a folded-paper wren on a black tile — is the
app's best asset and appeared nowhere in the app. Onboarding used a
hand-drawn blob bird, tiny line art lost in a black void, one flat
slide-in. The splash fanned three colored rectangles. Home's app bar wrapped
the icon in an accent-to-green gradient ring that fights the brand.

**Changed.**

- `BrandMark` component: the launcher icon inlined as React SVG
  (per-instance gradient ids, crisp at any size, zero image fetches).
- Splash: brand tile settles, wordmark and tagline rise, warm radial glow;
  480 ms total, matching `SPLASH_MS`.
- Onboarding: welcome is a brand moment (tile hero, Fraunces wordmark,
  format strip); slides get tinted circular stages, staggered entrances,
  swipe navigation; the line wren perches on slide 1's folder.
- Home app bar uses the real tile (hairline ring for dark surfaces).
- OpeningScreen uses the brand tile; Home empty state is a proper three-
  sheet fan with idle float; Continue-reading card gets the warm branded
  gradient; skeletons shimmer.

## 2. Viewer performance (commit `b6a3ed4`)

- PDF render effect restarts on a geometry signature (`pageLayoutSig`),
  not on `pageBoxes` identity: the metadata sweep (now 48-page batches)
  no longer cancels live rasters and re-observes every publish. Anchor
  capture is skipped until position restore has run.
- Search and the match-highlight layer share one extraction cache
  (`pageTextItems`, slim item copies); highlights no longer re-extract
  page text right after a search did.
- Thumbnails: DPR-aware scale (0.25 × clamp(dpr,1,2)) and a per-document
  LRU canvas cache (60 tiles, rotation+scale keyed) — reopening Pages
  re-attaches instead of re-rendering.
- Dark-reading invert moved from the document-sized column to per-page
  boxes.
- Search UI updates throttled to ~10 Hz; the per-character map is two
  number arrays instead of millions of objects.
- DOCX scroll: cached section geometry + binary search; zero rect reads
  per frame (was one `getBoundingClientRect` per section per event).
  Re-measured synchronously per zoom commit and on container resize.
- Open path: redundant whole-file copy removed from the Tauri
  `readBytes`; the branded opening page holds 150 ms so fast opens don't
  flash a loader (a read already past 20% skips the hold).
- Startup: ViewerScreen is lazy-loaded; main chunk 462 KB → 301 KB
  (gzip 147 KB → 96 KB). Dead 1-byte `xlsx` manualChunk removed.

Verified in-browser: open → real filename in toolbar, all pages rast,
thumbnails render, search finds matches and highlights draw through the
shared cache, per-page dark filter visually identical.

## 3. Security and storage (commit `fff571e`)

- Mobile fs scope narrowed from `**` to `content://**` + the managed
  imports dir: a webview parser exploit can no longer read arbitrary
  app-private files over IPC. Desktop keeps the broad read scope
  deliberately (recents reopen across sessions has no fresh gesture;
  read-only by construction; internal builds) — documented in the
  capability file.
- `dialog:default` reduced to `dialog:allow-open`; duplicate core
  permissions and redundant `fs:allow-read-file` removed.
- CSP: `base-uri 'self'; form-action 'none'; object-src 'none'`.
- Rust: cache/imports commands are async (were blocking the platform
  main loop — ANR risk); `dir_size` no longer follows symlinks (link
  loop aborted the process under `panic=abort`); new `imports_remove`
  command accepts bare filenames only.
- Android patch script: unique ingest temp files (the old `$$` suffix
  was a string literal, not the pid — concurrent ingests could corrupt
  each other), failure Toast instead of silence, per-call origin
  re-check inside the JS bridge, `application/octet-stream` removed
  from VIEW/SEND filters, and a block-upgrade mechanism
  (`upgradeWhen`) so activities patched by older script revisions are
  rewritten in place — covered by the extended dry run (4/4 checks).
- Bridge drain opens every queued payload (was: kept only the last).
- `recordOpen` identity is stable across `files.recents_limit` changes
  (changing the limit re-read the open document); the new limit is
  honored via a ref and covered by a rewritten regression test.
- Recents eviction deletes orphaned managed copies (single remove,
  limit pruning, recents-off wipe); Clear-recents keeps files so Undo
  stays honest. Settings repoints the dead "Clear cache" card at the
  real stored-copies surface and marks affected recents unavailable
  after a clear.
- Settings screen z-index 30 → 600: Home's FAB no longer pokes through.

## 4. Validation state

- `npm run lint` clean; `npm test` 149/149; `npm run build` OK.
- `node scripts/patch-android-openwith.mjs check`: 4/4 dry-run checks.
- Rust changes are compile-unverified locally (no toolchain on this
  machine); CI builds them.
- Needs a real Android device: open-with ingestion end-to-end, toast on
  ingest failure, octet-stream disappearance from the system share
  sheet, fs-scope read of `content://` picks on the device.
