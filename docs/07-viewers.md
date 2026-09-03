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
| Pinch | zoom 25–500% | — (text size in sheet) | zoom 50–400% | zoom 50–300% |
| Double-tap | zoom cycle 100↔fit-width at point | — | zoom to cell region | zoom to fit/fill |
| Long-press | text-select | text-select | cell select | nothing (v1) |
| Edge-swipe (system) | back (reverses container transform) | same | same | same |

## 2. PDF (SCR-07) — the flagship

**Engine:** pdf.js, progressive rendering (first paint before full parse). Quality bar: *indistinguishable from Adobe for reading.*

### Features (v1.0)

| Feature | Behavior |
|---------|----------|
| Progressive load | Page 1 paints < 800 ms on a 10 MB file; remaining pages render at low priority |
| Continuous scroll | Vertical, page-gap 8 dp; virtualized — only ±3 pages live in memory |
| Zoom | Pinch 25–500%; double-tap cycle fit-width → 100% → fit-page at tap point; re-rasterizes at zoom (text stays crisp) |
| Fit modes | Width / page; remembered per orientation |
| Page scrubber | Bottom slider + "12 / 240" counter; drag to seek with haptic ticks |
| Text search | OVL-01: hit count, prev/next, ember-drawn highlights; searches progressively with "searching… 34%" status |
| Outline (bookmarks) | OVL-02 side panel; deep-links to page |
| Thumbnails | OVL-03 grid (lazy 100 px renders); current page ember-ringed |
| Text selection | Long-press → word, drag handles → copy only (no highlight-save in v1) |
| Password PDFs | DIA-01 dialog on load; wrong password inline error; **never** stores passwords |
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
| Frozen panes | Header row/columns from the file are pinned |
| Cell values | Rendered **cached** values (no formula recalculation — safe & fast); formula bar shows the formula for selected cell |
| Formatting | Number formats, colors, bold/italic, alignment, column widths, merged cells — honored |
| Charts/images | Rendered if stored as images in the file; live chart objects → static snapshot if embedded, else "chart not previewed" chip |
| Selection & copy | Long-press cell → select, drag → range, "3×4 selected · Copy"; copies TSV to clipboard |
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
| Page view | True pagination with page-gap visual |
| Reading mode | Reflow continuous text, adjustable text size 70–200%, serif toggle (Fraunces for reading!) |
| Search | OVL-01 with hit highlights |
| Outline | Document headings panel (from styles) |
| Selection/copy | Standard text selection |
| Position memory | Restores scroll position (mode-aware: page vs reading) |

Legacy `.doc` (pre-2007 binary) → honest unsupported dialog with guidance (doc 09 §3).

## 5. PPTX (SCR-10) — v1.2

**Engine:** custom OOXML slide renderer (evaluate PPTXjs as base; expect to fork — this is the hardest 20%). Quality bar: *text, images, tables and simple shapes correct; decks are for reading, not presenting.*

| Feature | Behavior |
|---------|----------|
| Slide rendering | Text boxes, images, solid/gradient/picture fills, basic shapes, tables, rounded/shadowed frames |
| Chart objects | Static snapshot if embedded preview exists; else placeholder chip "Chart not previewed" |
| Navigation | Horizontal swipe slides + scrubber ("7 / 34"); filmstrip thumbnail strip (OVL-03) |
| Zoom | Pinch 50–300% for the too-small footnote |
| Aspect | Letterboxed at slide aspect (16:9/4:3 from file) |
| Animations | **Ignored by design** — final-state render only (say so in details sheet: "animations not shown") |
| Speaker notes | Viewable via ⋯ → Notes sheet |
| Transitions | Instant crossfade 140 ms between slides (doc 04 §3.6) |

Legacy `.ppt` → honest unsupported dialog (doc 09 §3).

## 6. Cross-format behaviors

- **Recents integration:** every viewer open writes recents (path, format, position, timestamp) locally (doc 11 §3).
- **File changed on disk:** content watcher (where the platform allows) → banner "File changed — Reload?" (doc 09 §6).
- **Orientation:** all viewers support rotate; scroll position survives.
- **"Open a copy":** details sheet → system share intent (shares the original file, no re-export).
- **Print:** v1.3 via Android system print service (PDF direct; DOCX/XLSX/PPTX "print as laid out" best-effort).

---

*Next: [08 · Settings](08-settings.md) — every switch, every default.*
