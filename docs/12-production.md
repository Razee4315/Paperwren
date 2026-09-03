# 12 · Production Readiness & Launch

> The gate between "works on my phone" and "deserves 5 stars." Definition of done, test corpus, store listing copy, and the release runbook.

---

## 1. Definition of done (every release)

A release ships only when **all** boxes check:

- [ ] All CRITICAL/HIGH QA issues closed (§4)
- [ ] Performance budgets met on reference device (doc 10 §7)
- [ ] Crash-free sessions ≥ 99.5% on the testing track (2 weeks / ≥ 100 sessions)
- [ ] Accessibility pass (§5) — TalkBack can complete every core flow
- [ ] New copy proofread (tone rules, doc 09 §8)
- [ ] Licenses page regenerated; no dependency license changes
- [ ] Privacy claims still literally true (doc 11 §1) — re-verified per release
- [ ] APK size ≤ 25 MB; manifest has zero permissions (automated check)
- [ ] Changelog written; version bumped (semver; `major.minor.patch`)

## 2. Reference device matrix

| Tier | Device class | Examples | Must-pass |
|------|--------------|----------|-----------|
| **R1 — Low-end reference** ★ | 2 GB RAM, API 26–28, mid WebView | Moto E-class, Galaxy A01 | Every budget + every flow |
| R2 — Current mid | 4–6 GB, API 30+ | Pixel A-series, Redmi Note | Every flow |
| R3 — Flagship | 8+ GB, latest API, 120 Hz | Pixel Pro, S-series | Polish: motion smoothness, tablet/split-screen |
| R4 — OEM quirks | Heavy OEM file managers | Xiaomi Files, Samsung My Files, WhatsApp/Gmail "open with" | Intent pipeline (§3 P2) |

Rule: **if it stutters on R1, it doesn't ship** — R1 is the persona the app exists for (doc 01 §4).

## 3. The test corpus ★ (keep in `fixtures/`, versioned)

The file set every release must chew through. Curate deliberately — weird files are where viewers die.

| Category | Files | What it proves |
|----------|-------|----------------|
| PDF happy path | 1-page text · 240-page book · scanned image PDF · PDF/A · resume layout | Correct render, search, selection |
| PDF hostile | password-protected (user + owner) · corrupt/truncated · 0-byte · 300 MB · PDF 1.3 legacy · RTL document · CJK text | E-01/E-02 flows, no crashes |
| XLSX | 10 rows · 100k rows · formulas (cached) · merged cells · frozen panes · 25 sheets · charts · dates/currency formats · CSV (comma/semicolon/UTF-8/BOM) | Virtual grid, tabs, formats |
| DOCX | school notes · invoice tables · images+captions · multi-column · tracked changes · comments · 500-page novel · RTL | Fidelity tiers (doc 07 §4) |
| PPTX | 4:3 and 16:9 · charts · tables · speaker notes · animations · 200-slide deck | v1.2 scope |
| Legacy | `.doc` · `.xls` · `.ppt` | E-03 honest dialog |
| Delivery paths | same files via: SAF picker · WhatsApp · Gmail attachment · Drive offline · OEM Files "open with" · first-run-via-intent (skips onboarding) | §3 pipeline, all URIs |

Each release: corpus runs through a scripted manual pass (per-viewer checklist in repo) + any crash from corpus blocks release.

## 4. QA checklists (per release, manual — scripted later)

**Open-with pipeline (P2 in the corpus above):** every delivery path opens the right viewer within budget; "Always" set → next open goes direct; cold-start-from-intent skips brand animation (doc 04 §3.1).

**Viewer core (each format):** open/scroll/zoom/search/select-copy/close; rotate mid-read; background/foreground mid-read; position resume; file-changed banner; back reverses transform.

**Settings:** every key in doc 08 flips, persists across restart, applies instantly; clear-cache frees bytes shown in snackbar; recents-off mode wipes and stops recording.

**States:** every state in doc 09 §2 visited per surface; every error E-01…E-08 triggered on purpose with exact copy verified.

**Privacy:** airplane-mode full pass (everything works); fresh-install "no permissions" verified; uninstall wipes everything (nothing survives on SD/shared storage).

## 5. Accessibility gates

- **TalkBack:** onboarding completable, recents navigable, viewer chrome operable, settings fully labeled; format glyphs announced as "PDF file, quarterly-report" etc.
- Contrast: all pairings from doc 02 ≥ AA (automated lint on token changes).
- Font scale 200%: no clipped controls, layouts wrap (screenshots at 200% in QA).
- Reduced motion honored (doc 04 §7); haptics toggle works (doc 08).
- Touch targets ≥ 48 dp verified with the Layout Inspector pass.

## 6. Play Store listing (draft copy)

| Field | Content (char counts) |
|-------|----------------------|
| **App name** (30) | `Paperwren: PDF & Office Viewer` |
| **Short description** (80) | `Open PDF, Word, Excel & PowerPoint instantly. No ads, no account, no tracking.` (78 ✓) |
| **Category** | Productivity → "Office" / "File management" per Play taxonomy |
| **Tags** | pdf viewer, office viewer, document reader |

**Full description (draft):**

> Your files. Your device. Opened instantly.
>
> Paperwren is a feather-light document viewer that opens PDF, Word, Excel, and PowerPoint files in about a second — with no ads, no accounts, and no tracking.
>
> **What it does**
> 📄 Read PDFs with crisp zoom, search, bookmarks, and resume-where-you-left-off
> 📊 View Excel sheets with frozen headers, sheet tabs, and copyable cells
> 📝 Read Word documents in page or comfortable reading mode
> 📽️ Flip through PowerPoint decks slide by slide
> …
>
> **What it doesn't do**
> No ads. No sign-up. No "upgrade to continue." No internet connection — your files never leave your phone. Paperwren doesn't even ask for a single permission.
>
> Set it as your default ("Always") and every document opens straight into Paperwren. That's it. That's the app.

**Graphic assets storyboard (8 screenshots):**
1. Hero: Home + tagline "Open anything. Instantly."
2. PDF reading (dark mode) — "Crisp, fast, focus-mode PDFs"
3. "Open with" sheet mid-choose — "Set Paperwren as default. Done."
4. XLSX grid — "Spreadsheets that scroll like butter"
5. Zero-privacy card — "Zero permissions · Zero tracking · Zero ads"
6. Onboarding illustration — "Designed like paper, not like an ad"
7. 15 MB size chip vs bloat competitors (no names/logos!) — "Feather-light"
8. Reader mode DOCX — "Comfortable reading, your text size"

Feature graphic: fanned-stack mark on ember-50 field, tagline in Fraunces.

## 7. Release engineering runbook

1. **Versioning:** semver. Store versionCode = monotonic build number (CI-injected).
2. **Signing:** one upload keystore, backed up in 2 places + Play App Signing enrolled. Losing it is unrecoverable — treat the key like the product.
3. **Tracks:** `main` → CI build → **internal** (instant) → **closed** (2 weeks soak, corpus QA) → **production staged 20% → 50% → 100%**, halting on crash-rate regression.
4. **Changelog template:** what's new in user words, ≤ 500 chars, no jargon.
5. **Rollback:** halt staged rollout + previous AAB promoted; hotfix branch off the release tag.
6. **Post-launch watch (48 h):** Play vitals crash/ANR dashboards; review triage twice daily for week one.

## 8. Support & feedback

- Support = one email address (mailto from About) — human replies, no ticket maze.
- Review playbook: thank positives warmly but briefly; for bug reports reply with "what file type + what device" and set expectations; **never** argue with a complaint about ads (we have none) or ask anyone to change a rating.
- Feature requests land in a public roadmap note (keep honest: v2 editing = "exploring", not "coming soon").

## 9. Docs maintenance

This documentation set is a living product artifact:

- Any decision change = edit the doc in the same PR as the change (docs drift = no docs).
- Copy decks are the source of truth for strings; engineering imports from here.
- Each release review updates: README decision snapshot, roadmap table, corpus, budgets.

---

*That's the full blueprint. Start building: v0.9 scaffold + PDF viewer, per doc 01 §7. Lesss go. 🚀*
