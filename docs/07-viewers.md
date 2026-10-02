# 07 · Viewer Specifications

> The heart of the app. One shared shell, four formats, each with an honest fidelity contract: what renders perfectly, what degrades gracefully, and what says so out loud.

---

## 1. Shared viewer shell

All formats share SCR-07..10's chrome (doc 05 §4):

- **Toolbar:** back · filename + format color dot · format actions · overflow ⋯ (details sheet, share, open-with…)
- **Ink-underline progress** while parsing/rendering (doc 04 §5)
- **Tap-center chrome toggle**, auto-hide after 2.5 s while reading
- **Position memory** per file (where you stopped), on by default
- **Brightness dim** slider in the viewer sheet — an overlay, not a system change

Universal gesture set:

| Gesture | PDF | DOCX | XLSX | PPTX |
|---------|-----|------|------|------|
| Tap center | toggle chrome | toggle chrome | toggle chrome | toggle chrome |
| Vertical scroll | continuous pages | reflow text | grid scroll | — |
| Horizontal swipe | page (fit-page mode) | — | — | next/prev slide |
| Pinch | zoom 25–800% | zoom 50–500% | zoom 40–300% | zoom 50–500% |
| Double-tap | zoom in at point ↔ fit width | zoom in at point ↔ fit width | — (taps select cells) | zoom in at point ↔ fit width |
| Long-press | text-select | text-select | cell select | nothing (v1) |
| Edge-swipe (system) | back (reverses container transform) | same | same | same |

### One zoom engine (`useZoom`)

Every viewer zooms through the same hook, so the gesture feels the same everywhere:

- **Inputs:** two-finger pinch, Ctrl/Cmd+wheel (which is also how a trackpad pinch arrives), double-tap, Ctrl/Cmd `+` `-` `0`, and the `−  level  +` capsule in the bottom bar.
- **The point under the fingers stays put**, including while the two fingers drag.
- **Compositor first, layout once.** While a gesture is in flight the page is only scaled with a GPU transform, so it follows the fingers at full frame rate however heavy the document is. The real layout (pdf.js re-rasterising, the Word page re-flowing) happens once, when the gesture ends. Nothing re-renders mid-pinch.
- **The spreadsheet is the exception:** its grid is windowed, so it re-flows on every frame instead. Cells stay sharp and the frozen headers stay pinned while zooming.
- A small badge shows the level during the gesture; the bottom-bar capsule shows it at rest and resets it on tap.
- Text-only viewers (legacy Word, ODF, RTF, Markdown, plain text) use the same gestures to change the **text size**: the text re-flows to the screen width instead of overflowing it.

### What every viewer shares (as built)

- **The file menu** (`FileMenu.tsx`): share or save a copy, open in another app, show in folder, print, details. Items the platform cannot do are left out.
- **Print** (`lib/print.ts`): the screen layout is virtualised, so a print job lays the document out again in `#pw-print`, which is all that shows on paper. PDF pages are rasterised at about 150 dpi; a sheet prints as a real table; Word, slides and text print their own DOM.
- **A very large file asks first** (`isLargeFile`): 200 MB for PDF, 60 MB for pictures, 40 MB for Office and text files, going by the name and the size before any byte is read. An unknown size is never called large.
- **Password-protected Office files** (`lib/office/crypto.ts`): a protected `.docx/.xlsx/.pptx` is an OLE container around the enciphered package. `ViewerScreen` recognises it, asks for the password, deciphers it in the worker (ECMA-376 "agile" and "standard" encryption; AES through WebCrypto, the 50,000 to 100,000 rounds of password hashing in `office/sha.ts`), and hands the real file to its viewer. Nothing is kept. Certificate and rights-management protection, and protected legacy binary files, are refused with a message.
- **Keep the screen on** (`lib/wake.ts`): the Screen Wake Lock where the engine has one, the Android shell's keep-screen-on flag where it does not; held only while a viewer is on top.
- **Page handle** (`Scrubber.tsx`, PDF and Word): on touch screens a handle appears on the right edge while scrolling; dragging it scrubs the whole document with the page number beside it.
- **Interface language** (`lib/i18n.ts`): the chrome follows the app's language and mirrors for Arabic and Urdu; the document area is pinned left-to-right and each paragraph, cell or line takes its own direction from its text.

## 2. PDF (SCR-07) — the flagship

**Engine:** pdf.js, progressive rendering (first paint before full parse). Quality bar: *indistinguishable from Adobe for reading.*

### Features (v1.0)

| Feature | Behavior |
|---------|----------|
| Progressive load | Page 1 paints < 800 ms on a 10 MB file; remaining pages render at low priority |
| Continuous scroll | Vertical, page-gap 8 dp; virtualized — only ±3 pages live in memory |
| Zoom | Pinch 25–500%; double-tap cycle fit-width → 100% → fit-page at tap point; re-rasterizes at zoom (text stays crisp) |
| Fit modes | Width / page; remembered per orientation |
| Page scrubber | "12 / 240" pill in the bottom bar (tap: go to a page by number) and, on touch, the handle on the right edge |
| Text search | OVL-01: hit count, prev/next, ember-drawn highlights; searches progressively with "searching… 34%" status |
| Outline (bookmarks) | OVL-02 side panel; deep-links to page |
| Thumbnails | "Pages" in the file menu: a grid of page pictures (`PdfThumbs.tsx`), drawn one at a time as they scroll into view and dropped when they leave, opening on the current page. Tap one to go there |
| Text selection | Long-press → word, drag handles → copy only (no highlight-save in v1) |
| Password PDFs | DIA-01 dialog on load; wrong password inline error; **never** stores passwords. The bytes are handed to pdf.js once (they move to its worker, not copied) and a password retry reuses the same load |
| Position memory | Restores page + zoom + scroll offset; CM-3 explains it once |
| Dark reading | "Darken pages" toggle in viewer sheet: CSS invert on page canvas with images re-inverted; off by default |

### Error paths (doc 09 details)
Corrupt → honest dialog. Encrypted owner-password (restrictions-only) PDF → opens (viewing allowed), prints/copy restrictions ignored-by-honesty: copy button simply present; we show "This PDF restricts copying" note once.

## 3. XLSX (SCR-09) — v1.0

**Engine:** SheetJS (community) parse → custom virtualized grid renderer. Quality bar: *everyday sheets scroll like butter; the CFO's 200k-row export won't melt the phone.*

| Feature | Behavior |
|---------|----------|
| Sheet tabs | Bottom strip, swipeable; active tab ember underline; overflow (">20 sheets") into list sheet |
| Virtualized grid | Only visible rows/columns render; 100k+ rows scroll smoothly |
| Frozen panes | Rows and columns the file freezes are pinned (dropped when they would take more than 60% of the screen). Long text runs over empty neighbours, across the freeze line too |
| Columns | Drag a column edge to resize; double-click to fit the text on screen. Charts and pictures hang from their columns and move with them |
| Cell values | Rendered **cached** values (no formula recalculation — safe & fast); formula bar shows the formula for selected cell |
| Formatting | Number formats, column widths, merged cells — honored. `.xlsx`/`.xlsm`: bold/italic/underline/strike, text colours, solid fills (rgb, indexed and tinted theme colours), horizontal alignment and wrap, read from the workbook's own style table (`sheetStyles.ts`). A filled cell carries its own ink so it reads the same in every app theme; an unfilled cell keeps the theme's ink (file "black" is not forced onto the dark theme). Authored borders are drawn. Other formats (`.xls`, `.ods`) keep the neutral look |
| Charts/images | Pictures and charts on a sheet are drawn where their anchors put them, including to the right of or below the used cells (`workbookModel.ts`). Charts use the same renderer as slides; one without cached values reads its ranges from the cells |
| Selection & copy | Click or tap a cell; drag, shift-click, shift-arrows or the corner grip (touch) for a range. The bar shows "4 × 3 cells" with sum, average and count; copy puts tab-separated text on the clipboard |
| Search | OVL-01 across all sheets; jump-to-cell |
| Types | Dates/currency/percent per file format; long text truncates with tap-to-view cell card |
| CSV | Parsed as a 1-sheet workbook; delimiter sniffed; encoding UTF-8 (+BOM), fallback windows-1252 |

Limits: > 500 MB file → caution dialog before parse (doc 09); pivot tables show their cached result (fine for 99% of viewing).

## 4. DOCX (SCR-08) — v1.1

**Engine:** docx-preview → HTML/CSS, paginated view; plus a **Reading mode** (reflow, user text size). Quality bar: *school notes, letters, invoices, and reports read as they should — pixel-perfection with Word is explicitly not promised anywhere in the UI.*

### Fidelity contract

| Tier | Elements | Behavior |
|------|----------|----------|
| ✅ **Full** | Headings, body, bold/italic/underline, colors, lists, tables, images (inline & floating), hyperlinks, page breaks, headers/footers, page numbers | Rendered as authored |
| ⚠️ **Degraded** | Complex multi-column layouts, text-wrap-around-shapes, SmartArt, equations (OMML), tracked changes, comments | Simplified render; changes/comments hidden; SmartArt/equations → static representation or placeholder chip |
| ❌ **Skipped** | Macros, embedded OLE objects, fonts-not-on-device (substituted) | Never crash; substitution note in details sheet |

| Feature | Behavior |
|---------|----------|
| Page view | True pagination with page-gap visual. "3 / 12" pill: the page under the upper third of the screen; tap it to go to a page. Pages away from the screen are skipped by layout and paint (`content-visibility`), which made re-layout of a 300-page file about ten times cheaper |
| Reading mode | Reflow continuous text, adjustable text size 70–200%, serif toggle (Fraunces for reading!) |
| Search | OVL-01 with hit highlights |
| Outline | Document headings panel (from styles) |
| Selection/copy | Standard text selection |
| Position memory | Restores scroll position (mode-aware: page vs reading) |

Legacy `.doc` (Word 97-2003) and `.odt` open in the flowing reader (`ReflowView`, `office/doc.ts`, `office/odf.ts`): formatting, lists, tables and pictures, without the page layout, and a banner says so. Word 6/95 and `.rtf` show their text.

## 5. PPTX (SCR-10) — v1.2

**Engine:** custom OOXML slide renderer (evaluate PPTXjs as base; expect to fork — this is the hardest 20%). Quality bar: *text, images, tables and simple shapes correct; decks are for reading, not presenting.*

| Feature | Behavior |
|---------|----------|
| Slide rendering | Text boxes, images (with their crop and round frames), solid/gradient/picture fills, basic and freeform shapes, tables. Gradients are SVG paint, so they fill any outline; outer shadows are drawn as a drop shadow of the shape |
| SmartArt | Drawn from the shapes the authoring app saved for it (the diagram's drawing part, named by the data model's `dataModelExt`); not laid out again. A diagram saved without them shows a labelled box |
| Full screen | One slide at a time on black (`Present.tsx`): swipe, tap a side, arrow keys; Escape or Back leaves at the slide shown |
| Chart objects | Bar/column (clustered, stacked, 100%), line, area, pie, doughnut and scatter are drawn as SVG from the values cached in the chart part (`pptx/chart.ts`, `SlideChart.tsx`); the embedded workbook is never opened and nothing is recalculated. Other types (radar, bubble, surface, stock) show a labelled placeholder rather than a wrong picture |
| Navigation | Horizontal swipe slides + scrubber ("7 / 34"); filmstrip thumbnail strip (OVL-03) |
| Zoom | Pinch 50–500% for the too-small footnote |
| Aspect | Letterboxed at slide aspect (16:9/4:3 from file) |
| Animations | **Ignored by design** — final-state render only (say so in details sheet: "animations not shown") |
| Speaker notes | Viewable via ⋯ → Notes sheet |
| Transitions | Instant crossfade 140 ms between slides (doc 04 §3.6) |

Legacy `.ppt` and `.odp` are read into the same slide model (`office/ppt.ts`, `office/odf.ts`) and drawn by the same viewer; a `.ppt` whose drawing layer cannot be read falls back to slides of its text, with a note. A long `.pptx` is parsed with pauses between slides so the app stays responsive.

## 6. Cross-format behaviors

- **Recents integration:** every viewer open writes recents (path, format, position, timestamp) locally (doc 11 §3).
- **File changed on disk:** content watcher (where the platform allows) → banner "File changed — Reload?" (doc 09 §6).
- **Orientation:** all viewers support rotate; scroll position survives.
- **"Open a copy":** details sheet → system share intent (shares the original file, no re-export).
- **Print:** see "What every viewer shares" above.
- **Pictures** (`ImageView.tsx`): PNG, JPEG, GIF, WebP and BMP open fitted to the screen, never enlarged past their own pixels, with the shared zoom.

---

*Next: [08 · Settings](08-settings.md) — every switch, every default.*
