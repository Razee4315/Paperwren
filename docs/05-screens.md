# 05 · Screen Inventory & Navigation

> **22 destinations total:** 1 splash · 3 onboarding · 1 home · 1 browser · 4 viewer modes · 7 overlays & sheets · 5 settings pages · about + licenses. That's the whole app — deliberately small.

---

## 1. Navigation model

Three tiers. Two tabs max. No hamburger menu, no bottom navigation bar — the app is small enough to not need them.

```
Tier 1  ROOT      → Home (the only tab)
Tier 2  FULLSCREEN→ Viewer (all 4 formats share one shell)
Tier 3  OVERLAY   → Sheets, dialogs, search, outline (dismiss back to what's under them)
```

- **Back** always reverses the transition that brought you here (container transform reverses; sheets slide down).
- **Up vs back:** the viewer's back arrow behaves exactly like system back — no divergence, ever.
- Re-entry via "open with" while the app is alive: routes to the viewer with the new file, preserving Home state underneath (single-task launch mode).

## 2. Navigation map

```mermaid
flowchart TD
    S[Splash] -->|first run| OB1[Welcome]
    S -->|returning| H
    OB1 -->|Skip / Next ×3| H[Home · Recents]

    H -->|FAB "Open a file"| SAF[(System file picker)]
    H -->|tap recent| V[Viewer shell]
    H -->|menu| B[Browse files · v1.1]
    H -->|toolbar ⚙| ST0[Settings]

    SAF --> V
    B --> V

    V --> PDF[PDF mode]
    V --> DOC[DOCX mode · v1.1]
    V --> XLS[XLSX mode]
    V --> PPT[PPTX mode · v1.2]

    V --> SH1[Search sheet]
    V --> SH2[Outline · PDF]
    V --> SH3[Thumbnails · PDF]
    V --> SH4[Viewer settings bottom sheet]
    V --> SH5[File details sheet]
    V --> DLG1[Password dialog]
    V --> DLG2[Error / file-changed dialogs]

    ST0 --> ST1[Appearance]
    ST0 --> ST2[Viewer defaults]
    ST0 --> ST3[Files & storage]
    ST0 --> ST4[Privacy & security]
    ST0 --> ST5[About]
    ST5 --> ST6[Open-source licenses]
```

## 3. Master screen inventory

IDs are stable — use them in tickets, designs, and tests. Version tags: **v1.0** launch, later tags = scheduled phase.

| ID | Screen | Purpose | Reached from |
|----|--------|---------|--------------|
| **SCR-01** | Splash | Brand unfold ≤ 480 ms; routes to onboarding or Home | Cold start |
| **SCR-02** | Onboarding 1/3 — "Open anything" | Value prop: formats | Splash (first run) |
| **SCR-03** | Onboarding 2/3 — "Private by design" | Zero permissions/telemetry | Onboarding 1 |
| **SCR-04** | Onboarding 3/3 — "Feather-light" | Speed & size | Onboarding 2 |
| **SCR-05** | **Home / Recents** ★ | Recent files grid/list, FAB "Open a file", search-all-files shortcut (v1.1), settings entry | Splash, onboarding, back from anywhere |
| **SCR-06** | Browse files | In-app SAF-backed storage browser with format filters | Home menu (v1.1) |
| **SCR-07** | Viewer shell — PDF ★ | Full document reading | Home, picker, "open with" |
| **SCR-08** | Viewer shell — DOCX | Reflow reading mode | Same (v1.1) |
| **SCR-09** | Viewer shell — XLSX | Sheet grid + tab bar | Same |
| **SCR-10** | Viewer shell — PPTX | Slide deck filmstrip | Same (v1.2) |
| **OVL-01** | Search sheet | Find-in-document (all formats) | Viewer toolbar |
| **OVL-02** | Outline / TOC panel | PDF bookmarks & headings | Viewer toolbar (PDF v1.0; DOCX headings v1.1) |
| **OVL-03** | Thumbnails grid | PDF page overview | Viewer toolbar |
| **OVL-04** | Viewer settings sheet | Zoom fit, brightness dim, rotate, text size (DOCX), sheet options | Viewer toolbar `sliders` |
| **OVL-05** | File details sheet | Path, size, dates, "Open with…", "Show in folder" (SAF) | Viewer ⋯ menu |
| **DIA-01** | Password dialog | Encrypted PDF unlock | PDF load |
| **DIA-02** | Error dialog(s) | Corrupt / legacy / too-large / moved (doc 09) | Any load |
| **SET-00** | Settings root | 5 groups, app version | Home toolbar |
| **SET-01** | Appearance | Theme, dynamic color, pure black, language | Settings |
| **SET-02** | Viewer defaults | Zoom mode, remember position, keep screen on, gestures | Settings |
| **SET-03** | Files & storage | Recents controls, cache size & clear | Settings |
| **SET-04** | Privacy & security | The "zero" page: what we don't collect; hide-in-switcher toggle | Settings |
| **SET-05** | About | Version, update check (Play), rate, share, licenses, policy | Settings → also Licenses subpage |

**Count check:** 5 (splash+onboarding) + 2 (home, browse) + 4 (viewers) + 7 (overlays/dialogs) + 6 (settings incl. licenses) = **24 destinations**, of which **16 ship in v1.0** — a deliberately tiny surface area.

## 4. Screen-by-screen layout specs

### SCR-05 · Home (the front door)

```
┌──────────────────────────────────┐
│ status bar (bg-tinted)           │
│ Paperwren            ⌕(v1.1)  ⚙     │ ← toolbar, title-l "Paperwren"
│                                  │
│ Recent                          │ ← caption label
│ ┌──────┐ ┌──────┐ ┌──────┐      │
│ │ ⟐    │ │ ▤    │ │ ▦    │      │ ← 2-col grid (≥3-col tablet)
│ │ Q3…  │ │ Notes│ │ Deck │      │   glyph · name · meta
│ └──────┘ └──────┘ └──────┘      │
│                                  │
│              (＋) FAB            │ ← "Open a file", bottom-right
└──────────────────────────────────┘
Empty state: paper-collage illustration (doc 03 §4), Fraunces line
"Nothing here yet." + body "Files you open will appear here —
only on this device." + filled button "Open a file".
```

- Recents sorted most-recent-first; pinned files stick to a "Pinned" group.
- Each card: format glyph badge (40 dp), name (1 line ellipsis), `small` meta "PDF · 2.4 MB · Tue".
- Long-press card → sheet: Pin, Remove from recents, File details.
- Scrolling down hides the FAB; up brings it back (doc 04 §3).

### SCR-07..10 · Viewer shell (shared chrome)

```
┌──────────────────────────────────┐
│ ←  quarterly-report.pdf  ⟐  ⋯   │ ← toolbar (auto-hide)
│ ─────────────────────────────    │ ← ink-underline progress
│                                  │
│           DOCUMENT               │ ← content area
│                                  │
│ ◀ ────────●─────── ▶   12 / 240 │ ← scrubber bar (PDF/PPTX)
└──────────────────────────────────┘
```

- Top bar: back, filename (1 line, format color dot beside it), format-specific actions (search, outline/thumbnails/sheets), overflow ⋯.
- Bottom bar varies by mode: PDF/PPTX scrubber; XLSX sheet-tab strip; DOCX reading-progress hairline.
- Toolbar actions in `OVL-04` sheet: zoom fit (width/page), rotate (PDF), brightness dim slider (nice-at-night detail), text size (DOCX).

### Settings (SET-00…05)

Standard list pages: grouped cards (`surface`, radius-l), icon + title-s + `small` description, chevron for subpages. The Privacy page (SET-04) is intentionally sparse and written in plain language — it's a brand moment (doc 11).

## 5. Cross-cutting chrome rules

- **Edge-to-edge** everywhere; scroll content under the status bar with a bg-matched scrim on scroll.
- Status bar icons: `ink-1` in Paper, `#F2EDE4` in Midnight (theme-aware, not a fixed style).
- Every icon-only control gets a content description + long-press tooltip (a11y).
- No screen (except viewer) scrolls horizontally. Ever.
- Orientation: Home/settings lock portrait on phones; **viewer supports all orientations** (spreadsheets benefit hugely).

---

*Next: [06 · Onboarding & Welcome Flow](06-onboarding.md) — the first 20 seconds, scripted.*
