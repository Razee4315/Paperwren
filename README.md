<p align="center">
  <img src="assets/brand/app-icon.svg" width="112" height="112" alt="Paperwren: a small wren on a pine-teal tile" />
</p>

<h1 align="center">Paperwren</h1>

<p align="center"><strong>Open anything. Instantly.</strong></p>

<p align="center">
  A small, fast document viewer for Android and Windows.<br />
  No ads, no accounts, no network, no permissions.
</p>

<p align="center">
  <a href="https://github.com/Razee4315/Paperwren/releases/latest">Download</a> ·
  <a href="https://razee4315.github.io/Paperwren/">Website</a> ·
  <a href="https://razee4315.github.io/Paperwren/privacy">Privacy</a> ·
  <a href="docs/README.md">Design docs</a>
</p>

<p align="center">
  <a href="https://github.com/Razee4315/Paperwren/releases/latest"><img src="https://img.shields.io/github/v/release/Razee4315/Paperwren?label=release&color=2b6e66" alt="Latest release" /></a>
  <a href="https://github.com/Razee4315/Paperwren/actions/workflows/ci.yml"><img src="https://github.com/Razee4315/Paperwren/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2b6e66" alt="MIT license" /></a>
</p>

![PDF, Word, Excel and PowerPoint files open in Paperwren](docs/screenshots/viewers.png)

Paperwren opens PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV, Markdown and plain-text files, and pictures. It reads them on the device and does nothing else: it never touches the network and the Android app requests zero permissions.

## Contents

- [Download](#download)
- [What it opens](#what-it-opens)
- [Around the document](#around-the-document)
- [On Windows](#on-windows)
- [Zoom and keyboard](#zoom-and-keyboard)
- [Look and feel](#look-and-feel)
- [Privacy](#privacy)
- [Development](#development)
- [Architecture](#architecture)
- [Builds and releases](#builds-and-releases)
- [License](#license)

## Download

Every release is on the [releases page](https://github.com/Razee4315/Paperwren/releases/latest).

| Platform | File | Notes |
|---|---|---|
| Windows 10 and 11, 64-bit | `Paperwren_<version>_x64-setup.exe` or `Paperwren_<version>_x64_en-US.msi` | Registers Paperwren for the document types it opens. Drop a file on the window, double-click one, or press Ctrl+O |
| Android 8.0 and later | `Paperwren-v<version>-android.apk` | One universal APK. Open a file from any app with "Open with", share one into Paperwren, or pick one inside it |

## What it opens

| Format | How it is shown |
|---|---|
| PDF | pdf.js viewer: fast virtualised pages, text selection, find with highlights, contents, rotate, two pages side by side, password-protected files. Its character maps and standard fonts ship with the app, so Chinese, Japanese and Korean files that name a font without carrying it still read. Go to a page by number (or by the document's own label, such as "iv"), pick one from the page thumbnails, or drag the handle on the right edge. A form is shown as it was saved; nothing can be typed into it and lost. A long file asks which pages to print before it draws any |
| Word `.docx` | The document's own page layout (docx-preview), fit to width, find, "3 / 12" page counter and go to page, and a list of its headings to jump by. **Reading view** lets the text flow to the width of the screen instead, for a phone. Comments can be shown when a document has them. Long documents only lay out the pages near the screen |
| Excel `.xlsx` `.xlsm` `.xlsb`, `.xls`, `.ods`, `.csv` `.tsv` | Virtualised grid: frozen rows and columns, merged cells, sheet tabs, find across every sheet, go to a cell by its address, zoom that keeps the headers pinned. Select a range (drag, shift-click, or the corner grip on touch) to copy it and see its sum, average and count. Drag a column edge to resize, double-click to fit. `.xlsx` cells keep their bold/italic, text colours, fills, borders and alignment; long text runs over empty neighbours; charts and pictures on a sheet are drawn where the file puts them. A cell's link and its note are shown beside the cell. Sheets a workbook hides stay hidden |
| PowerPoint `.pptx` | Slides drawn from their own shapes, theme colours, layouts, freeform outlines, gradients, shadows, cropped pictures and tables, plus speaker notes. Bar, line, area, pie, doughnut and scatter charts are drawn from the numbers stored in the file; SmartArt is drawn from the shapes the file saved for it. Jump to a slide by its number or pick it from a grid of small slides. The slide show takes the whole screen, one slide at a time (on a phone it hides the status bar and turns the screen sideways): swipe, tap a side, click, or use the arrow keys; it passes over slides the author hid, and can show the speaker notes |
| Legacy `.doc`, OpenDocument `.odt` | A flowing document with its formatting, lists, tables and pictures (the page layout is not reproduced, and the viewer says so). Word 6/95 files and `.rtf` show their text |
| Legacy `.ppt`, OpenDocument `.odp` | Drawn as slides, like `.pptx`: shapes, text, pictures, tables and backgrounds |
| Markdown, text, logs, JSON, XML | Rendered Markdown (sanitised; its source is a tap away) or plain text with encoding detection. JSON and XML written on one line are laid out for reading. Long lines wrap or keep their length, and lines can be numbered |
| Pictures `.png` `.jpg` `.gif` `.webp` `.bmp` | Fitted to the screen, zoomable, and turned the right way up when taken sideways: a scan or a photo of a page is a document too |

Password-protected `.docx`, `.xlsx` and `.pptx` files open with their password (both the Office 2007 and the Office 2010+ encryption). The password is used in memory, once, and never stored. Protected `.doc`/`.xls`/`.ppt` files, and files locked with a certificate or rights management, are not opened; the app says so.

Right-to-left text (Arabic, Urdu, Hebrew) reads from the right in slides, documents, text files and sheet cells, whether or not the file says so.

The bytes decide the format, not the file name: content URIs without extensions and files with the wrong extension still open in the right viewer.

## Around the document

- **The file menu** in every viewer: share (or save a copy), open in another app, show in folder, print, details. What a platform cannot do is left out rather than greyed out.
- **Print** lays the whole document out again for paper, including pages that were never scrolled into view.
- **Folders**: pick a folder on Home to browse the documents inside it, with the same search and type filters as recents.
- **Large files**: a file big enough to be slow, or to be more than a phone can hold, asks before it is read. A sheet with more cells than can be held is shown up to its last whole row that fits, and says so.
- **Links** in a document are never followed (the app has no network access): a link within the document scrolls to its target, and a web or mail address is shown so it can be copied.
- **Recents** can be sorted by last opened, name or size; removing one, clearing them or turning them off can be undone for a few seconds. A file reopens at the page and zoom it was left at.
- **Keep the screen on** while a document is open (off by default; no permission needed).
- **Languages**: English, 中文, हिन्दी, Español, Français, العربية and اردو, following the phone or chosen in Settings. Arabic and Urdu mirror the app; documents keep their own direction. See "Translations" below.

## On Windows

The same web layer, laid out for a mouse and a keyboard:

- **One bar.** The app draws the window's frame itself, so the bar that names the document is also the title bar: back, the file's name, the page number, zoom, find, the menu, and the window's own buttons. Drag it to move the window, double-click it to maximise. Nothing sits at the foot of a document except a workbook's sheet tabs.
- **A side panel** that stays open while reading: a PDF's pages and contents, a Word document's headings, a deck's slides.
- **Menus open at the pointer**, and a right click on selected text offers Copy, Select all and Find.
- **Full screen** for any document with F11; the bar returns while the pointer is at the top edge.
- **The window opens where it was left**, as large as it was left. Each document opened from the file manager is a window of its own, and they share one list of recent files.
- Type a page number straight into the bar; the zoom level opens a menu of sizes.

## Zoom and keyboard

Every viewer zooms the same way: pinch or double-tap on a touch screen, Ctrl+wheel with a mouse, Ctrl `+` `-` `0`, or the zoom control (in the top bar on Windows, at the foot of the screen on a phone). The point under your fingers or the cursor stays put, and the page follows without re-rendering until you let go. In the text-only viewers the same gestures change the text size.

On Windows the keyboard works from the moment a file opens, and keeps working after a click on the bar. The list is also in the app, under Settings, Keyboard.

| Keys | What they do |
|---|---|
| Ctrl+O | Open a file |
| Ctrl+W, Alt+Left | Close the document |
| Ctrl+F | Find in the document (on Home: search your files) |
| F3, Shift+F3 (or Enter, Shift+Enter in the field) | Next and previous match. Esc closes the search |
| Ctrl+P | Print |
| Ctrl `+`, Ctrl `-`, Ctrl `0` | Zoom in, zoom out, back to the natural fit |
| F11 | Full screen. Esc leaves |
| Space, Shift+Space, Page Up, Page Down, arrows | Scroll |
| Home, End (also with Ctrl) | The start and the end of the document |
| Left, Right | The previous and the next page, slide or picture |
| Ctrl+A | Select the whole document |
| Ctrl `]`, Ctrl `[` | PDF: turn the pages |
| F5 | Slides: start the slide show. A click or the wheel goes on, a right click goes back, Esc leaves |
| Arrows, Shift+arrows, Home, End, Page Up, Page Down, Enter | Sheets: move the selection (Shift extends it) |
| Ctrl+arrow, Ctrl+Home, Ctrl+End | Sheets: to the edge of the data, the first cell, the last cell |
| Ctrl+Page Up, Ctrl+Page Down | Sheets: the previous and the next sheet |
| Ctrl+C | Sheets: copy the selection |

## Look and feel

- Flat and calm: solid colours, no gradients, blur or drop shadows, and only short one-shot transitions.
- Three themes tuned for long reading, plus Auto (Paper by day, Ink at night):
  - **Paper**: warm off-white with a faint paper-fibre texture and a pine-teal accent.
  - **Sand**: low-blue-light parchment with a fine sand grain and a terracotta accent.
  - **Ink**: soft charcoal (not pure black) with ink splatters in the corners and a mint accent.
  Textures sit on page backgrounds only; cards and documents stay plain.

  ![The home screen in the Paper, Sand and Ink themes](docs/screenshots/themes.png)
- A flat wren mascot (also the app icon), a four-step welcome with a live theme picker. Files opened from other apps skip it.
- Motion respects the system "reduce motion" setting.
- SVG assets: `assets/icons/*.svg` (one per format), `assets/brand/wren.svg` and the app icons are exported from the same geometry the app renders: `npx vite-node scripts/export-assets.tsx`.

The same app on Windows (an older build; the window now has one bar):

![Paperwren on Windows](docs/screenshots/windows.jpg)

## Privacy

- No network access and no analytics. The release APK requests zero Android permissions, and the release pipeline fails if one appears.
- Recents and settings live in app-private storage. On Android, files opened from the picker or shared into the app are kept as private copies (deduplicated by content hash, capped at 250 MB) so recents still reopen after the app is closed; they can be deleted in Settings.
- Passwords (PDF and Office) are used once, in memory, and never stored.

The full policy is at [razee4315.github.io/Paperwren/privacy](https://razee4315.github.io/Paperwren/privacy).

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

The browser shows the phone layout. Add `?desktop` to the address for the desktop one, and `?desktop&frame` to see the window buttons the app draws on Windows (`tests/e2e/desktop.spec.ts` covers both).

Run all four checks (`lint`, `build`, `test`, `cargo test`) before pushing.

### Fixtures

- `python3 scripts/make-office-fixtures.py`: the basic Office/ODF/RTF samples (needs python-pptx, python-docx and LibreOffice).
- `python3 scripts/make-rich-fixtures.py`: styled and frozen workbooks, chart and effect decks, right-to-left text, a picture, and password-protected PDF and Office files (needs openpyxl, Pillow, python-pptx, reportlab, msoffcrypto-tool). The password is `wren`.
- `fixtures/legacy/` and `fixtures/odf/` are real files from the Apache POI and LibreOffice test suites; see the README in each.

### Translations

Interface text is written in English in the code (`t("Open file")`) and looked up by that text. The translations live in one table, `scripts/locales/strings.py`, one row per string with every language side by side; `python3 scripts/make-locales.py` writes `src/lib/locales/*.ts` from it. A unit test fails if a string in the code is missing from any language, or if a table has a string the code no longer uses.

The Urdu, Arabic, Chinese, Hindi, Spanish and French texts were written without a native reviewer. Corrections are welcome: edit the row in `strings.py` and regenerate.

### Website

The marketing site (home, comparisons, privacy policy, security) lives in `website/`, built with Astro. See `docs/14-website.md` for the design direction and where the comparison data comes from.

```bash
cd website
npm install
npm run dev            # http://localhost:4321/Paperwren/
npm run build          # astro check + static build into website/dist
```

## Architecture

One web layer runs everywhere; a thin Tauri 2 shell wraps it on Windows and Android.

```
src/
  lib/            pure logic, unit-tested
    formats.ts    format registry + magic-byte sniffing
    recents.ts    recents rules (dedupe, pinning, limits, migration)
    settings.ts   settings validation + migration
    backend.ts    the one platform boundary (Tauri or browser)
    env.ts        which layout this is: phone, or desktop (?desktop in a browser)
    windowState.ts, fullscreen.ts   the desktop window: where it was left, F11
    i18n.ts       interface languages; locales/ holds the generated tables
    office/       legacy and ODF readers (.doc, .ppt, .odt, .odp, RTF),
                  and decryption of password-protected Office files
    pptx/         PowerPoint parser (theme, layout/master inheritance, charts)
    sheetStyles.ts  cell styles, frozen panes, charts and pictures of a workbook
    print.ts      lays a document out again for paper
    parseWorker.ts  SheetJS, legacy Office parsing and decryption, off the main thread
  state/          React providers: settings, recents, navigation/Back
  ui/             small component kit (CSS Modules)
  screens/        Home, Settings, viewer/ (one lazily loaded chunk per engine)
src-tauri/
  src/            Rust core: store.rs (atomic JSON store), imports.rs (managed copies),
                  open.rs (desktop hand-offs), error.rs
  tauri.windows.conf.json   Windows only: no native frame, and the webview's
                  pinch reaches the app (the Android window is in tauri.android.conf.json)
  android/        MainActivity.kt: Open with / Share ingestion, Back bridge, picker bridge,
                  share, print and folder hand-offs, the system bars (slide show, theme)
scripts/          install-android.mjs (applies the activity + manifest), icon/signing helpers, fixtures
```

The product and design documentation is in [`docs/`](docs/README.md); `docs/13-redesign.md` is the audit that led to this structure.

## Builds and releases

A push to `main` runs CI (lint, type check, unit tests, Rust tests) and the release pipeline, which bumps the patch version and publishes a Windows installer, an Android APK and a Play bundle. With the upload keystore in the repository's secrets the bundle is signed for Google Play; without it the build falls back to a debug key and is only good for testing. Pull requests run the browser tests as well and build a debug APK (`validate.yml`).

## License

MIT. Bundled libraries keep their own licenses, listed in the app under Settings, About.
