# Paperwren

**Open anything. Instantly.**

Paperwren is a small, fast document viewer. It opens PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV, Markdown and plain-text files. It has no ads and no accounts, never touches the network, and asks for no permissions.

![PDF, Word, Excel and PowerPoint files open in Paperwren](docs/screenshots/viewers.png)

## What it opens

| Format | How it is shown |
|---|---|
| PDF | pdf.js viewer: fast virtualised pages, text selection, links, find with highlights, contents, rotate, pinch/Ctrl+wheel zoom, password-protected files |
| Word `.docx` | The document's own page layout (docx-preview), fit to width, zoom, find |
| Excel `.xlsx` `.xlsm` `.xlsb`, `.xls`, `.ods`, `.csv` `.tsv` | Virtualised grid with frozen headers, merged cells, sheet tabs, cell details and copy, find |
| PowerPoint `.pptx` | Slides drawn from their own shapes, theme colours, layouts, pictures and tables, plus speaker notes |
| Legacy `.doc` `.ppt`, OpenDocument `.odt` `.odp`, `.rtf` | Clean reading view of the text (layout and images are not shown, and the viewer says so) |
| Markdown, text, logs, JSON, XML | Rendered Markdown (sanitised) or plain text with encoding detection |

The bytes decide the format, not the file name: content URIs without extensions and files with the wrong extension still open in the right viewer.

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

## Privacy

- No network access and no analytics. The release APK requests zero Android permissions.
- Recents and settings live in app-private storage. On Android, files opened from the picker or shared into the app are kept as private copies (deduplicated by content hash, capped at 250 MB) so recents still reopen after the app is closed; they can be deleted in Settings.
- PDF passwords are used once and never stored.

## Windows

The same app ships as a small Windows installer.

![Paperwren on Windows](docs/screenshots/windows.jpg)

## Website

The marketing site (home, comparisons, privacy policy, security) lives in
`website/`, built with Astro. See `docs/14-website.md` for the design
direction and where the comparison data comes from.

```bash
cd website
npm install
npm run dev            # http://localhost:4321/Paperwren/
npm run build          # astro check + static build into website/dist
```

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

Real Office/ODF/RTF fixtures are generated with `python3 scripts/make-office-fixtures.py` (needs python-pptx, python-docx and LibreOffice).

## Architecture

```
src/
  lib/            pure logic, unit-tested
    formats.ts    format registry + magic-byte sniffing
    recents.ts    recents rules (dedupe, pinning, limits, migration)
    settings.ts   settings validation + migration
    backend.ts    the one platform boundary (Tauri or browser)
    office/       text extraction: .doc, .ppt, ODF, RTF
    pptx/         PowerPoint parser (theme, layout/master inheritance)
    parseWorker.ts  SheetJS + legacy Office parsing off the main thread
  state/          React providers: settings, recents, navigation/Back
  ui/             small component kit (CSS Modules)
  screens/        Home, Settings, viewer/ (one lazily loaded chunk per engine)
src-tauri/
  src/            Rust core: store.rs (atomic JSON store), imports.rs (managed copies), error.rs
  android/        MainActivity.kt: Open with / Share ingestion, Back bridge, picker bridge
scripts/          install-android.mjs (applies the activity + manifest), icon/signing helpers, fixtures
```

See `docs/13-redesign.md` for the audit that led to this structure.

## Builds and releases

A push to `main` runs CI (lint, type check, unit tests, Rust tests) and the release pipeline, which bumps the patch version and publishes a Windows installer and an Android APK. The APK is signed with a debug key and is meant for testing.

## License

MIT. Bundled libraries keep their own licenses, listed in the app under Settings, About.
