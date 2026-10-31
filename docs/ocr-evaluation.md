# On-device OCR: size, speed and accuracy

Measured 2026-10-31 on `tesseract.js-core` 7.0.0 and `tessdata_fast`, on an
Intel i7-7820HQ laptop in Chrome. **No phone was used**, so the phone speeds are
a slowed-down desktop, and nothing here ran inside the real Tauri app.

## Decision

On 2026-10-31 the owner chose to ship all nine languages, as built on
`feat/pen-notes-markup`. That adds about 11 MB to what a phone downloads from
Play, and the universal APK on GitHub grows by 83%. Printed Latin, Cyrillic,
Arabic, Naskh Urdu, Hindi and Chinese scans read well. Two limits should be
stated plainly: **Nastaliq Urdu is poor** (about 35% of characters wrong on a
clean page), and so is a badly shaded Chinese scan.

To trim the size later, drop languages from `public/ocr/` and `OCR_NAMES`: each
saves 0.6 to 1.8 MB per binary.

## What it adds

Tauri packs the web assets with brotli (quality 9) into each native binary, so
the figures below are brotli sizes, and they count once per binary. The
universal APK holds three binaries and the universal macOS app two.

| Shipped | Raw | Per binary |
|---|---:|---:|
| Engine (`tesseract-core-simd-lstm.wasm`, worker) | 3.0 MB | 0.96 MB |
| English | 4.11 MB | 1.81 MB |
| Spanish | 2.29 MB | 1.06 MB |
| French | 1.13 MB | 0.58 MB |
| Portuguese | 1.98 MB | 0.95 MB |
| Russian | 3.86 MB | 1.47 MB |
| Arabic | 1.43 MB | 0.70 MB |
| Urdu | 1.40 MB | 1.02 MB |
| Hindi | 1.12 MB | 0.91 MB |
| Chinese (Simplified) | 2.47 MB | 1.68 MB |
| **All nine, with engine** | **22.8 MB** | **11.1 MB** |

| Download | v1.4.3 | With English only | With all nine |
|---|---:|---:|---:|
| Play, per device (one binary, estimated) | about 13.4 MB | +2.8 MB | +11.1 MB (about 24.5 MB) |
| Universal APK (three binaries) | 40.1 MB | 48.4 MB | 73.5 MB |
| Windows `setup.exe` | 10.4 MB | 13.2 MB | 21.5 MB |
| Windows `.msi` | 11.1 MB | 13.9 MB | 22.2 MB |
| macOS universal `.dmg` (two binaries) | 21.9 MB | 27.4 MB | 44.2 MB |

These add the measured sizes to the v1.4.3 release files. No installer was
built with OCR in it, so treat them as close estimates. The language files also
add 19 MB to the git repository, which is 18 MB today.

## Speed

Time for the wasm alone to read one full A4 page of 11 pt text at 200 dpi, on
one thread. Chrome's CPU throttle does not reach workers, so these ran on the
main thread. "Slowdown" is what was measured, not the throttle's setting.

| Page | This laptop | 2.7× slower | 6.9× slower | 11.7× slower |
|---|---:|---:|---:|---:|
| English | 5.9 s | 16 s | 40 s | 69 s |
| Urdu (Nastaliq) | 4.5 s | 12 s | 29 s | 55 s |
| Chinese | 11.9 s | 33 s | 78 s | 138 s |

My estimate, from memory of published benchmarks and not measured, is that a
recent mid-range phone is close to this laptop and a budget phone is near the
2.7× column. Expect about 10 to 30 seconds a page there.

The whole tool (draw the page, clean it, read it, save) took 7.5 s for English,
7.7 s Russian, 8.6 s Arabic, 9.4 s Hindi, 9.6 s Urdu and 11.3 to 12.3 s Chinese
on this laptop. A page is read on one thread; the wasm heap reached 41 to 57 MB.

## Accuracy

Share of characters wrong, read back from the saved PDF. The pages are synthetic:
real fonts drawn to a canvas, then blurred, tilted and speckled. **Real scans
have not been tested.** "Harsh" is 150 dpi, grey ink on tinted paper, heavy
noise, a shadow across the page and JPEG quality 50.

| Language | Clean, 200 dpi | Harsh, 150 dpi |
|---|---:|---:|
| English | 0.0% | 5.2% |
| Arabic | 0.0% | 18.1% |
| Urdu (Naskh font) | 0.2% | 27.8% |
| Russian | 1.5% | 19.4% |
| Chinese | 2.2% | 81.6% |
| Hindi | 2.9% | 4.5% |
| Urdu (Nastaliq font) | 34.7% | 60.3% |

Without the clean-up step in `cleanPage`, every language on the harsh page was
86 to 100% wrong, so it is what makes a poor photo readable at all.

A larger model did not earn its place for Nastaliq. In the best test, `tessdata_best`
Urdu scored 13.1% against 14.5% for the fast model, and it costs 6.4 MB more.
Nastaliq with this engine needs a purpose-trained model, which is a separate job.

## Other options looked at

| Option | Why not |
|---|---|
| `tesseract.js` wrapper | Its defaults point at CDNs. The core alone is enough, and has no network code of its own beyond fetching its wasm from the path it is given |
| PaddleOCR on the app's ONNX Runtime | Models are about 8 MB per script against about 1 MB here, so about 45 MB raw or more for the same scripts. Compared on size only: not benchmarked |
| ML Kit (Android) | About 4 MB per script per architecture bundled, and Android only. The bundled scripts I found are Latin, Chinese, Devanagari, Japanese and Korean, with no Arabic among them |
| Windows and macOS system OCR | No extra size, but depends on language packs, and does nothing for Android |

## Licences

Engine, language data and the blank font are Apache-2.0. The data licence is in
`public/ocr/LICENSE.txt`. The language files come from
`tesseract-ocr/tessdata_fast` at commit `87416418657359cb625c412a48b6e1d6d41c29bd`.

## How it works

`src/lib/ocr.ts` starts a worker (`ocrWorker.ts`) with the one language file
chosen. Each page is drawn at 200 dpi, cleaned, read, and its words laid over the
original in `addTextLayer` (`pdfTools.ts`), unseen, in Tesseract's blank font. The
page's pictures are not touched: the saved copies held the original JPEG bytes
and grew by about 12 KB. Pages that already have text are skipped.

A run under the app's exact CSP made no outside requests. Search was confirmed in
pdf.js and in MuPDF, for all seven test scripts on clean pages.

## Not tested

- A real phone, the Tauri app on any platform, or WKWebView. Older macOS without
  wasm SIMD or `OffscreenCanvas` (before about Safari 16.4) will show the tool's
  general error.
- Real scans, multi-column pages, tables, and pages with photographs.
- Documents in two languages: one language is chosen per run, and words in
  another script come out wrong.
- Long documents, for memory over hundreds of pages.
- Search in Adobe Acrobat.
