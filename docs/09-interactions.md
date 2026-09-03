# 09 · Interaction & States

> The unglamorous half of great UX: how the app acknowledges, waits, fails, and recovers. Rule zero: **there is no such thing as a dead tap.**

---

## 1. Global response rules

| Rule | Spec |
|------|------|
| Acknowledge everything | Every touch gets visual feedback within **100 ms** (press tint/scale) |
| Optimistic UI | Opened file appears in recents instantly; undo if open fails |
| Never block input | No full-screen modal loaders; content area shows state, chrome stays responsive |
| Back is always safe | Back cancels/dismisses in reverse order of appearance; never exits the app from a viewer directly to launcher **without** returning to Home first |
| One undo level | Destructive actions (clear recents, remove recent) → snackbar Undo, 4 s |
| Interruption-safe | Any dialog/sheet survives rotation & process death via state restore |

## 2. The state machine (every surface)

Each surface implements all five states. No exceptions.

| State | When | Presentation |
|-------|------|--------------|
| **Loading** | > 300 ms wait | Ink-underline + skeletons (doc 04 §5); < 300 ms shows nothing (avoids flash) |
| **Empty** | No content possible | Illustration + one-line headline + one action (copy deck below) |
| **Content** | Normal | — |
| **Partial** | Some content, some failed | Content renders; inline chips mark degraded parts (e.g., "chart not previewed") |
| **Error** | Cannot proceed | Honest dialog (§3) or inline banner; specific cause, one action |

## 3. Error taxonomy — exact copy

Every error: **what happened → why → what to do.** No error codes, no "Oops", no blame.

| ID | Trigger | Dialog |
|----|---------|--------|
| **E-01 Corrupt file** | Parser can't read structure | Title: "Can't open this file" · Body: "The file seems to be damaged or isn't a valid {format}. It may not have downloaded completely." · Actions: [OK] |
| **E-02 Encrypted PDF** | Password required | DIA-01: "This PDF is password-protected" + password field + [Cancel] [Unlock]. Wrong password → inline "That password didn't work. Try again." 3 fails → [OK] dismiss |
| **E-03 Legacy format** | `.doc` / `.xls` / `.ppt` (pre-2007) | Title: "Older Office format" · Body: "This {ext} file uses a legacy format Paperwren doesn't read yet. Save it as the newer format ({new ext}) from Word/Excel/PowerPoint, or try another viewer." · Actions: [OK] |
| **E-04 Too large** | > limits (XLSX 500 MB, PPTX 200 MB) | Title: "Big file" · Body: "This file is {size}. Opening it may be slow or run out of memory on this device." · Actions: [Cancel] [Try anyway] |
| **E-05 Out of memory** | Renderer killed mid-open | Title: "Ran out of memory" · Body: "'{name}' is too large to display fully on this device. Part of it may be missing." · Actions: [OK] — **never a crash**; graceful page with as much as rendered |
| **E-06 File moved/deleted** | Source vanished before/while reading | Title: "File not found" · Body: "'{name}' isn't where it was. It may have been moved or deleted." · Actions: [Remove from recents] [OK] |
| **E-07 Unsupported** | Random binary | Title: "Unsupported file type" · Body: "Paperwren reads PDF, Word, Excel, and PowerPoint files." · Actions: [OK] |
| **E-08 WebView failure** | Renderer process died | Auto-restore attempt ×1 with position snapshot; on 2nd failure → E-05-style page. User never sees a blank screen without words |

## 4. Empty states — exact copy

| Surface | Headline (Fraunces) | Body | Action |
|---------|---------------------|------|--------|
| Home, no recents | "Nothing here yet." | "Files you open will appear here — only on this device." | [Open a file] |
| Recents cleared | "All clear." | "Your recent files were removed." | [Open a file] |
| Search, no hits | "No matches." | "Try a shorter or different word." | — |
| Outline missing | "No outline." | "This document doesn't include bookmarks." | — |
| Sheet, no tabs (XLSX search off-state) | — | "Search all sheets from the toolbar." | — |

## 5. Loading choreography (open a file, end to end)

```
t=0      tap card      press feedback + container transform starts
t≈100ms  viewer shell  toolbar + scrim visible (chrome is instant)
t≈100ms+ parse start  ink-underline progress appears (determinate if possible)
t<800ms  first paint  PDF page 1 / first sheet / first slide visible
t=done   settle       progress bar completes + fades; position restored
```

Rules: chrome never waits for content; progress always moves visibly at least every 400 ms (indeterminate draw otherwise); cancel = back (reverses transform, aborts parse).

## 6. Reactive behaviors (the "live" details)

| Event | Response |
|-------|----------|
| File changes on disk while open | Top banner (warning): "File changed — Reload?" [Reload] [Dismiss] · position preserved on reload |
| Storage nearly full during cache copy | Banner in viewer: "Low storage — some features may fail." |
| Dark theme switch mid-read | 180 ms crossfade; page darkening (if on) reapplies without reload |
| Rotate in viewer | Layout reflows; scroll/page preserved; XLSX gains/loses columns gracefully |
| Split-screen / resize | All surfaces reflow (no fixed-px layouts anywhere) |
| Interruption (call, notification shade) | Nothing closes; viewer state intact on return |
| Second "open with" while viewing file A | File B opens in a new viewer instance stacked on A's; back returns to A (recents-aware) |
| App killed while viewing | Relaunch → Home; tapping that recent resumes exactly (position memory is per-file, persisted immediately on scroll-idle 500 ms) |

## 7. Gesture conflict rules

| Conflict | Resolution |
|----------|------------|
| Horizontal page swipe vs system back | System back zone (edge) wins; page swipe starts ≥ 24 dp inside |
| Pinch while chrome animating | Gesture wins instantly; chrome animation cancels |
| Scrubber drag vs scroll | Scrubber is in its own hit area; no overlap with scrollable content |
| Long-press text-select vs chrome toggle | Long-press always starts selection; toggle is tap-only |

## 8. Copy principles for every state

1. Name the object ("'report.pdf'"), not "the file".
2. Say the cause in one clause, the fix in one clause.
3. One primary action per dialog; cancel is always available and always first in reading order when destructive is primary.
4. Never exclamation marks. Never "error", "failed", or "unexpected" alone — always *what* failed.
5. Humor budget: zero in errors, small and warm in empty states only.

---

*Next: [10 · Technical Architecture](10-architecture.md) — how the Tauri app is put together.*
