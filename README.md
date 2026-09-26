# Paperwren

**Open anything. Instantly.**

Paperwren is a small, fast document viewer. It opens PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV, Markdown and plain-text files. It has no ads and no accounts, never touches the network, and asks for no permissions.

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

## Privacy

- No network access and no analytics. The release APK requests zero Android permissions.
- Recents and settings live in app-private storage. Files shared into the app are kept as private copies (deduplicated by content hash, capped at 250 MB) so they can be reopened, and can be deleted in Settings.
- PDF passwords are used once and never stored.

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
