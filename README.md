# Paperwren

**Open anything. Instantly.**

Paperwren is a feather-light document viewer for Android. It opens PDF, Word, Excel, and PowerPoint files in about a second, with no ads, no accounts, and no tracking. The app has no internet access and requests zero permissions.

This repository contains the product documentation in `docs/` and the app source.

## What Paperwren is

A viewer, and nothing else. Paperwren does one job, showing you your files, and does it with respect. The long-term goal is that you set it as the default ("Always") for your documents and every file opens straight into Paperwren.

## Current status

Version 0.9 (internal) is in active development.

| Working now | Planned |
|---|---|
| PDF viewer with zoom, rotation, thumbnails, outline, position memory, text search | PowerPoint viewer, v1.2 |
| Word (DOCX) reader with layout-faithful pages | Reading mode for Word documents |
| Excel viewer with sheet tabs and a virtualized grid | "Open with" from every file manager, verified on device |
| CSV and plain text viewing | In-app storage browser |
| Recents with pinning, onboarding, light and dark themes | Search highlights, print via system service |
| Settings, cache management, honest error dialogs | |

Files are opened through the in-app system picker in this build. The Android "open with" pipeline (viewing a file straight from another app) is implemented and ships in the test APK; it needs on-device verification before it is called done.

See `docs/README.md` for the full product plan and release phases.

## Privacy

The short version, and the whole brand: zero permissions, zero accounts, zero tracking, zero network.

- Paperwren never connects to the internet. There is nothing to connect with.
- Files open on the device and stay on the device.
- The recents list, settings, and a deletable cache live in app-private storage.
- PDF passwords are used in memory for one session and never saved.

The complete policy ships inside the app under Settings, Privacy and security.

## Tech stack

- Tauri 2 with a Rust core and the system WebView
- React 18, TypeScript, styled-components, Vite
- pdf.js (PDF), SheetJS Community Edition (spreadsheets)
- Manrope and Fraunces fonts, Lucide icons, bundled locally
- Design language: "Paper and Ink" (see `docs/02-design-system.md`)

## Development

Requirements: Node 18 or newer. Rust is only needed to run the desktop shell locally; all packaging builds run on GitHub Actions.

```bash
npm install
npm run dev        # web preview at http://localhost:1420
npm run lint       # biome
npm run build      # tsc + vite production build
```

In a browser, the app runs against an in-memory backend so every screen is testable without a native shell. To try a real file, open the dev server and use the "Open a file" button.

Generate test fixtures (PDF, XLSX, CSV, TXT) for manual testing:

```bash
node scripts/make-fixtures.mjs
```

### Desktop shell (optional, requires Rust)

```bash
npm run tauri dev
```

### Builds and releases

Everything is automated. A push to `main` runs CI (lint, type check, build, Rust check) and a release pipeline that bumps the patch version, builds the Windows installer and an Android APK on GitHub's runners, and publishes them as a GitHub Release. No local build step is required.

The Android APK produced by CI is signed with the debug key on purpose. It is a test artifact: install it directly to try the app. A Play-ready signed build will be added before the public launch.

## Repository layout

```
docs/                  product and design documentation
src/                   React application (screens, ui kit, viewers, state)
src-tauri/             Rust core and Tauri configuration
assets/brand/          icon sources (SVG)
fixtures/              test corpus starter files
scripts/               fixture generator and Android CI patch scripts
.github/workflows/     CI and release pipelines
```

## License

MIT. Bundled libraries keep their own licenses, listed in the app under Settings, About, Open-source licenses.
