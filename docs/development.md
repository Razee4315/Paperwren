# Working on Paperwren

How to run it, test it, translate it and ship it. For what the app does, see [features](features.md).

## Contents

- [Development](#development)
- [Architecture](#architecture)
- [Builds and releases](#builds-and-releases)

## Development

Requirements: Node 20+. Rust is only needed for the desktop shell and `cargo test`.

```bash
npm install
npm run dev            # web preview at http://localhost:1420 (in-memory backend)
npm run lint           # biome
npm run build          # tsc + vite
npm test               # unit tests (vitest)
cargo test --manifest-path src-tauri/Cargo.toml

# Browser tests against the production build
npm i --no-save @playwright/test && npx playwright install chromium
npm run build && npx playwright test
```

The browser shows the phone layout. Add `?desktop` to the address for the desktop one, `?desktop&frame` to see the window buttons the app draws on Windows, and `?desktop&lights` for the room a Mac's bar leaves for the system's buttons, with the Mac's keys (`tests/e2e/desktop.spec.ts` covers them).

The Mac app is built on a Mac, with Rust and the Xcode command line tools:

```bash
npx tauri build --bundles app   # src-tauri/target/release/bundle/macos/Paperwren.app
```

It is signed ad hoc, not by a developer account; copy it to `/Applications` to install it.

Run all four checks (`lint`, `build`, `test`, `cargo test`) before pushing.

### Tracing a slow start

To find where a slow start goes, run the desktop app with `PAPERWREN_TRACE=1` (for example `PAPERWREN_TRACE=1 ./Paperwren.AppImage`, or `$env:PAPERWREN_TRACE=1` before the exe in PowerShell). It writes one line per milestone to stderr, `paperwren-trace: <ms> <milestone>`, with the milliseconds counted from the start of `run` in `src-tauri/src/lib.rs` (time the loader spends before that is not counted): process start, an `environment` line (OS, version, and on Linux `XDG_SESSION_TYPE`, the `WEBKIT_DISABLE_*` variables if set, and whether it is an AppImage), window created, page load started and finished (from the webview), `web: page loaded` (the first script running), `web: code loaded` (the rest of the scripts evaluated), `web: Home ready` and `web: first document page drawn` (open a document to see it). Without the variable nothing is written. The web layer reports through `src/lib/trace.ts`, which does nothing outside the desktop app; the lines come from the shell's one clock, so a web line is stamped when the shell receives it, a few milliseconds after it happened. A report with these lines gives numbers to work from before any WebKit setting is tried.

### Fixtures

- `python3 scripts/make-office-fixtures.py`: the basic Office/ODF/RTF samples (needs python-pptx, python-docx and LibreOffice).
- `python3 scripts/make-rich-fixtures.py`: styled and frozen workbooks, chart and effect decks, right-to-left text, a picture, and password-protected PDF and Office files (needs openpyxl, Pillow, python-pptx, reportlab, msoffcrypto-tool). The password is `wren`.
- `python3 scripts/make-feature-fixtures.py`: the files for the reading features in `fixtures/features/` (a PDF with pictures, comments, attachments, layers and wide margins, an EPUB and a locked one, a comic book, pictures in newer formats, a workbook with conditional formatting and a CSV in a Windows code page; needs reportlab, pypdf, Pillow, pillow-heif and openpyxl). `notes.md`, `data.json` and `wren.py` there are written by hand.
- `fixtures/legacy/` and `fixtures/odf/` are real files from the Apache POI and LibreOffice test suites; see the README in each.

### Translations

Interface text is written in English in the code (`t("Open file")`) and looked up by that text. The translations live in one table, `scripts/locales/strings.py`, one row per string with every language side by side; `python3 scripts/make-locales.py` writes `src/lib/locales/*.ts` from it. A unit test fails if a string in the code is missing from any language, or if a table has a string the code no longer uses.

The Urdu, Arabic, Chinese, Hindi, Spanish, French, Russian and Portuguese (Brazilian) texts were written without a native reviewer. Corrections are welcome: edit the row in `strings.py` and regenerate.

### Assets

SVG assets: `assets/icons/*.svg` (one per format), `assets/brand/wren.svg` and the app icons are exported from the same geometry the app renders: `npx vite-node scripts/export-assets.tsx`.

### Website

The marketing site (home, comparisons, privacy policy, security) lives in `website/`, built with Astro.

```bash
cd website
npm install
npm run dev            # http://localhost:4321/Paperwren/
npm run build          # astro check + static build into website/dist
```

## Architecture

One web layer runs everywhere; a thin Tauri 2 shell wraps it on Windows, macOS and Android.

```
src/
  lib/            pure logic, unit-tested
    formats.ts    format registry + magic-byte sniffing
    recents.ts    recents rules (dedupe, pinning, limits, migration)
    settings.ts   settings validation + migration
    backend.ts    the one platform boundary (Tauri or browser)
    env.ts        which layout this is: phone, or desktop (?desktop in a browser)
    windowState.ts, fullscreen.ts   the desktop window: where it was left, F11
    keys.ts, macMenu.ts   a Mac: shortcuts written with ⌘, and its menu bar
    i18n.ts       interface languages; locales/ holds the generated tables
    office/       legacy and ODF readers (.doc, .ppt, .odt, .odp, RTF),
                  and decryption of password-protected Office files
    pptx/         PowerPoint parser (theme, layout/master inheritance, charts)
    sheetStyles.ts  cell styles, frozen panes, charts and pictures of a workbook
    print.ts      lays a document out again for paper
    parseWorker.ts  SheetJS, legacy Office parsing and decryption, off the main thread
  state/          React providers: settings, recents, navigation/Back
  ui/             small component kit (CSS Modules)
  screens/        Home, Settings, viewer/ (one lazily loaded chunk per engine),
                  tools/ (fill & sign, the PDF tools)
    pdfTools.ts   the PDF tools on pdf-lib: fill and sign, build, number, mark, lock
src-tauri/
  src/            Rust core: store.rs (atomic JSON store), imports.rs (managed copies),
                  open.rs (desktop hand-offs, the files Finder asks for),
                  save.rs (saving a copy, renaming), trace.rs (PAPERWREN_TRACE
                  start-up timings), error.rs
  tauri.windows.conf.json   Windows only: no native frame, and the webview's
                  pinch reaches the app (the Android window is in tauri.android.conf.json)
  tauri.macos.conf.json     macOS only: the system's window buttons over the app's bar
  android/        MainActivity.kt: Open with / Share ingestion, Back bridge, picker bridge,
                  share, print and folder hand-offs, the system bars (slide show, theme)
scripts/          install-android.mjs (applies the activity + manifest), icon/signing helpers, fixtures
```

## Builds and releases

A push to `main` runs CI (lint, type check, unit tests, Rust tests). It does **not** bump the version, create a tag or publish a release.

For an installable test build, open [Actions → Test builds](https://github.com/Razee4315/Paperwren/actions/workflows/validate.yml), choose **Run workflow**, select `main` (or the branch to test), and run it. The workflow runs the checks and browser tests, and uploads these downloads under the run's **Artifacts** section:

- `Paperwren-windows-test`: Windows `.exe` and `.msi` installers. Extract the downloaded ZIP and run either installer.
- `Paperwren-test-android-arm64`: a size-optimized APK for an ARM64 Android device, built with the release compiler profile and signed with the cached test key. It can update a previous test APK signed with that key. Installing over an app signed with a different key requires uninstalling that app first, which removes its saved data. CI checks its signature, architecture and a 60 MiB size limit.
- `Paperwren-macos-universal`: a universal macOS `.dmg`.

Test builds keep the current version and never publish a release or upload to Google Play. The same workflow also runs on pull requests. From the CLI: `gh workflow run validate.yml --ref main`.

Only run [Actions → Release](https://github.com/Razee4315/Paperwren/actions/workflows/release.yml) when a new version is wanted. Select `main` and **Run workflow**, or use `gh workflow run release.yml --ref main`. If the current version is already tagged and there are new commits, it bumps the patch version, then publishes Windows installers, a universal macOS app and disk image, an Android APK and a Play bundle. Other branches cannot release. With the upload keystore in the repository's secrets the bundle is signed for Google Play; without it the build falls back to a debug key and is only good for testing.

Installed copies on Windows and macOS update from that release. The pipeline signs their updates with the key in the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets; its public half is `plugins.updater.pubkey` in `tauri.conf.json`, and the release's `latest.json` is the feed. Without the key secret a release still ships, with a warning, but installed copies are not offered it. Keep the private key safe: an update signed with any other key is refused, so losing it means installed copies can no longer update.


### Store metadata for F-Droid and IzzyOnDroid

`fastlane/metadata/android/en-US/` holds the title, short and full description, icon, phone screenshots and one changelog per released version for F-Droid-style catalogues. A changelog is named after the Android `versionCode`, which Tauri derives from the version as `major * 1000000 + minor * 1000 + patch` (1.7.0 is `1007000`). Add `changelogs/<versionCode>.txt` (500 characters at most) for each release. The Play Store text is in `store/LISTING.md`.
