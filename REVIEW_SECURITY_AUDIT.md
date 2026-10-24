# Independent review of the security audit (PR #34, `security/audit-hardening`)

Reviewed 2026-10-24. Audited branch tip `5aa533a`, merge base `d7fbf12`,
current main `f06ca15`. All evidence below comes from code, git, and CI
runs on the throwaway branch `review/security-audit-verification`. Nothing
was built locally. The audited branch, main and PR #34 were not touched.

CI runs used as evidence:

- **R1**: [review experiments, run 40077674814](https://github.com/Razee4315/Paperwren/actions/runs/40077674814) (safeZip proofs, mutants, bypasses, merge-state CI steps, test counts, cargo test, cargo-audit). Green.
- **R2**: [review experiments, run 40077878992](https://github.com/Razee4315/Paperwren/actions/runs/40077878992) (R1 plus the docx-preview evidence). Green.
- **R3**: [Test builds (validate.yml) on the merge state, run 40077676566](https://github.com/Razee4315/Paperwren/actions/runs/40077676566). All 6 jobs green: Frontend, Rust, Browser (Playwright), Windows installers, macOS DMG, Android APK.
- The audit's own runs, [39986129765](https://github.com/Razee4315/Paperwren/actions/runs/39986129765) and [39986129551](https://github.com/Razee4315/Paperwren/actions/runs/39986129551), are real. Both succeeded on head `5aa533a` on 2026-10-23, against the old main.

"Merge state" means commit `d4125c4` on the review branch: a clean
`--no-ff` merge of `origin/security/audit-hardening` into `origin/main`
(`f06ca15`). It had zero conflicts.

---

## 1. Verdict: APPROVE WITH CHANGES

The branch is honest and clean, and every change it makes points the right
way. Merged into today's main, it passes the full suite: 415 unit tests,
Playwright, all three desktop and mobile builds, and the production
`npm audit`. Its headline fix, the zip guard (PW-SEC-03), works against
the cases it tests. The CI proof shows four of its seven tests fail
without it.

The guard is still not complete. Two cheap hostile zips get straight
past it:

- **Stored-entry overlap.** A 1 MiB file unpacks to 300 MiB with every
  entry accepted, and the budget is only checked after the memory is
  spent.
- **ZIP64 count.** A tiny file walks billions of entries, which works
  out to about 8 minutes of a frozen tab on a CI runner.

Its 200x ratio also silently drops honest parts, such as a blank BMP or
a repetitive stylesheet. And it only covers fflate: DOCX goes through
JSZip and spreadsheets through SheetJS, both unguarded.

The two dependency findings are real but overstated:

- None of the five DOMPurify advisories can be reached with the way the
  app calls DOMPurify.
- SheetJS runs in a fresh, abortable worker.

The independent pass found issues the audit missed that matter more than
some it fixed:

- docx-preview renders a DOCX `altChunk` as an unsandboxed same-origin
  `<iframe srcdoc>`, which can send the whole window to an attacker page
  on one click.
- A DOCX can inject page-wide CSS.
- `rename_file` can change `.pdf` to `.bat`, contrary to the audit's own
  write-up.
- The Android `fs:default` grant exposes the app's whole private data
  directory.
- A 280-byte file of empty comments freezes the app through the `isSvg`
  regex in `sniff.ts`.

Merge after the safeZip fixes and the corrections to
`docs/16-security-audit.md` listed in section 5. The docx-preview and
navigation issues are pre-existing and can follow, but should come next.

---

## 2. Findings table

| ID | Claim verified | Fix correct | Fix is best practice | Regression test meaningful |
|---|---|---|---|---|
| PW-SEC-01 DOMPurify 3.4.14 | **Partial** | **Yes** | **Yes** | **N-A** |
| PW-SEC-02 SheetJS 0.18.5 | **Yes** (severity overstated) | **Yes** | **Partial** | **N-A** |
| PW-SEC-03 Zip bomb | **Yes** | **Partial** | **Partial** | **Partial** |
| PW-SEC-04 Android unbounded ingest | **Yes** | **Yes** | **Partial** | **N-A** |
| PW-SEC-05 Android origin prefix match | **Yes** | **Partial** | **Partial** | **N-A** |

Evidence for each cell:

### PW-SEC-01: DOMPurify 3.4.14

- **Claim verified: Partial.**
  - main `package.json:25` has `"dompurify": "^3.4.14"`.
  - The GitHub advisory database confirms all five GHSAs cover 3.4.14:
    - p98j and 6688: fixed in 3.4.16.
    - cg2g, mrv2 and c6gr: fixed in 3.4.17.
  - Every one of them needs a non-default mode:
    - `IN_PLACE` plus hooks (p98j, 6688, mrv2);
    - `SAFE_FOR_TEMPLATES` with DOM output (cg2g);
    - `PARSER_MEDIA_TYPE: application/xhtml+xml` (c6gr).
  - The app has exactly two calls: main `src/lib/epub.ts:235` and `src/screens/viewer/TextView.tsx:130`. Both are string-in, string-out with only `FORBID_TAGS`/`FORBID_ATTR`. A grep for `IN_PLACE|SAFE_FOR_TEMPLATES|PARSER_MEDIA_TYPE|RETURN_DOM|addHook` under `src/` finds nothing.
  - **Not exploitable here; "Critical" is wrong for this app. Correct rating: Low (hygiene).** The desktop `**` read scope is a real impact multiplier for any *future* XSS, but these advisories don't create one.
- **Fix correct: Yes.** `15af411`; the lockfile resolves 3.4.17 (sha512 pinned).
- **Best practice: Yes.** A patch bump, plus the new CI audit gate (`5aa533a`).
- **Regression test: N-A.** No PoC is possible without the vulnerable modes, so the gap is accepted. A cheap guard against regressions: a unit test asserting both call sites never pass `IN_PLACE`/`RETURN_DOM`. Nice-to-have.

### PW-SEC-02: SheetJS 0.18.5

- **Claim verified: Yes; severity overstated.**
  - main `package.json:37` has `"xlsx": "^0.18.5"`.
  - GHSA-4r6h-8v6p-xvw6 covers `< 0.19.3`; GHSA-5pgg-2g8v-p4x9 covers `< 0.20.2`. 0.18.5 is in both.
  - Parsing happens only in `src/lib/parseWorker.ts:8,38` and `src/lib/workbookModel.ts:444`, inside a **fresh worker per parse** that is terminated on abort (`src/screens/viewer/runWorker.ts:9-17`):
    - pollution dies with the worker realm (results are structured-cloned back);
    - ReDoS hangs only that worker, until the user leaves.
  - **Real rating here: Low to Medium, not High.**
- **Fix correct: Yes.** `15af411`; the lockfile resolves `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` with a sha512 integrity, so `npm ci` verifies it.
- **Best practice: Partial.** A URL tarball dependency is invisible to `npm audit` and Dependabot, so the new audit step will never flag a future SheetJS advisory. This needs a manual watch, documented.
- **Regression test: N-A.** No PoC. Accepted, because the upstream fix versions are authoritative. R3's Playwright run and the 415 unit tests are the drop-in evidence.

### PW-SEC-03: Zip bomb

- **Claim verified: Yes.** main `src/lib/epub.ts:125` has `entries = unzipSync(bytes);` with no filter.
- **Fix correct: Partial.**
  - On the branch, every production `fflate` import is the one in `src/lib/safeZip.ts:29`. The other `unzipSync` users are only `*.test.ts`. `ToolsScreen.tsx:20` uses `zipSync`, which is compression.
  - Bypassed by stored-entry overlap and by ZIP64 (section 4, N3 and N4).
  - DOCX goes through JSZip in docx-preview and XLSX/ODS through SheetJS's own inflate; neither is guarded (N12).
- **Best practice: Partial.** A pre-scan plus filter is the right idea. But the budget charges the *claimed* size, while fflate allocates the *stored* size for method-0 entries, and the pre-scan reads different EOCD fields from fflate. Section 4 has a tested fix.
- **Regression test: Partial.** Proved in R1:
  - Job **3a**: on current main the test file fails, because `Failed to resolve import "../safeZip"`. That failure is trivial.
  - Job **3b**: the same 7 tests, with only the import line changed to plain `unzipSync`:
    - **4 fail**: entries, enormous, ratio, budget.
    - **3 pass**, and are not security tests: "reads what a caller's own filter asks for", "unpacks a big, honest archive whole", and "never decodes past what an entry claims to be" (it characterises fflate).
    - With the branch guard, all 7 pass.
  - Job **3c** mutation check: ratio, budget and scan are **killed**. **entrycap** and **postcheck** **survive**: no test covers the filter's entry cap or the post-inflate total. The post-inflate check is not "nearly unreachable" as the audit says; it is the only thing that catches the stored-overlap bomb (N3).
  - The tests never cover stored entries or ZIP64.

### PW-SEC-04: Android unbounded ingest

- **Claim verified: Yes.** main `src-tauri/android/MainActivity.kt:602` has `stream.copyTo(out, 64 * 1024)`.
- **Fix correct: Yes.**
  - On the branch, `MainActivity.kt:600-634` checks a counted loop before each write.
  - The temp file is deleted in `finally` on every path (line 632). The native reviewer independently confirmed this.
  - R3's Android job compiles it.
- **Best practice: Partial.**
  - There is no read timeout: a provider whose pipe never closes still blocks the single ingest thread forever.
  - There is no cap on URIs per `SEND_MULTIPLE`.
  - The user sees only the generic "couldn't open" message.
  - The premise "matches the imports store's cap" may be moot, because Rust and Kotlin appear to use different imports folders on Android (N8).
- **Regression test: N-A.** There is no JVM test infrastructure. Accepted for merge, but one manual device check is needed (section 6).

### PW-SEC-05: Android origin prefix match

- **Claim verified: Yes.** main `MainActivity.kt:1068-1073` uses `startsWith("http://localhost")`.
- **Fix correct: Partial.**
  - On the branch, `MainActivity.kt:1088-1096` compares the host exactly. That closes `localhost.attacker.tld`.
  - All 5 `evaluateJavascript` sites (392, 553, 657, 757, 814) and every bridge method go through it, except `keepAwake` and `stopSpeaking`, which are harmless.
  - It still accepts any scheme and port, and `localhost`/`127.0.0.1` in release builds. So `content://localhost/...` and `file://localhost/...` pass.
  - Production `http://tauri.localhost` and dev `http://localhost:1420` both still pass.
- **Best practice: Partial.** Should require scheme `http`, host `tauri.localhost` and no port, allowing localhost only when `BuildConfig.DEBUG`. Better still: `WebViewCompat.addWebMessageListener` with `allowedOriginRules`, which checks each calling frame.
- **Regression test: N-A.** There is no JVM test infrastructure. The origin check is a pure function and could be a Kotlin/JUnit test if a JVM test module is ever added. Accepted for merge.

---

## 3. Git hygiene and CI integrity

### Git

- **Main untouched by the branch: confirmed.**
  - `git merge-base` is `d7fbf12`.
  - `d7fbf12..origin/security/audit-hardening` holds exactly the 5 listed commits: `15af411`, `1e6e1c2`, `2c84efe`, `157df4b`, `5aa533a`.
  - All are authored by Razee4315 and are clean Conventional Commits.
  - The diff is exactly the 14 listed files: +496 / −124.
- **No rewritten history.**
  - The local worktree `Paperwren-audit` is at `5aa533a`, the same as `origin/security/audit-hardening` and the PR head `5aa533a`.
  - Re-checked `origin/main` (`f06ca15`) and the branch before each push: unchanged.
- **No new tags or releases.** The latest tag is `v1.4.0`, released 2026-10-23T14:46:51Z, which is before the branch's CI runs at 16:21Z. PR #34 is OPEN and MERGEABLE, with 5 commits.
- **No secrets.**
  - `git log -p d7fbf12..branch` grepped for keys, tokens, passwords, private keys, `ghp_`/`AKIA`/`AIza`/`xox`: it found only prose in the audit doc.
  - Across **all history**, no `.env`, `.jks`/`.keystore`/`.p12`/`.pem`/`.key`, service-account or google-services file was ever added.
  - Release signing lives only in GitHub secrets, referenced by name in `release.yml`. No secret needs rotation.
- **No existing tests weakened.** `git diff d7fbf12..branch -- '*.test.*' tests/` shows only the new `src/lib/__tests__/safeZip.test.ts`. Counts (R1, job 4):

  | Ref | Tests | Passed |
  |---|---|---|
  | `d7fbf12` | 396 | 396 |
  | branch | 403 | 403 |
  | main | 408 | 408 |
  | merge | 415 | 415 |

  None failed or were skipped at any of the four refs. 415 = 408 + 7 exactly.
- **Workflows touched:** `git diff d7fbf12..branch -- .github/` shows only `ci.yml`. `release.yml` and `website.yml` are untouched.

### CI

- **No suppression in the four repo workflows.** No `continue-on-error`, no `|| true` on a gate, no `if: false`.
  - `ci.yml` has a push `paths-ignore` for `**.md`, `docs/**` and `website/**`. That is reasonable, and PRs are not path-filtered.
  - `release.yml:184` has a `|| true` on two `find … | head` lines inside a step that then fails explicitly if the outputs are missing. Fine.
- **Branch change: `npm audit --omit=dev --audit-level=high` (ci.yml). Endorsed.** In R1 it reports `found 0 vulnerabilities` on the merge state. Limits:
  - (a) it cannot see the SheetJS URL dependency;
  - (b) it runs only in `ci.yml`, not in `validate.yml`;
  - (c) dev dependencies have 8 advisories (2 critical, 3 high, 3 moderate) in `vitest` ≤4.1.10 (tinypool), `vite`/`esbuild` ≤0.24.2 (dev server reads cross-origin, GHSA-67mh-4wv8-2f99), `source-map-js` and `undici`. None of them ship, but the esbuild one bites the developer while `npm run dev` is up. Upgrade, separately.
- **Thresholds:**
  - `ZIP_LIMITS.maxEntries 8192`, `maxBytes 1 GiB`, `maxEntryBytes 512 MiB`: **endorsed** as caps, but they are bypassable (N3, N4).
  - `maxRatio 200`: **not endorsed.** Deflate's ceiling is about 1032x, so any honest entry can be up to that. R2 proves a blank 1000×1000 BMP (1022x) and a repetitive stylesheet (481x) are silently dropped. Use about 1100, which rejects only impossible claims.
  - `MAX_INGEST_BYTES 250 MiB`: **endorsed** as a DoS bound. It is a user-visible change, and the "same as the imports cap" rationale needs re-checking (N8).
- **Pre-existing exceptions:**
  - The `biome-ignore noDangerouslySetInnerHtml` comments have moved on the merge state: `TextView.tsx:448`, `EpubView.tsx:334`, plus two highlight.js ones at `TextView.tsx:462,475`. All four are justified: the HTML is sanitized, or escaped by highlight.js, and inserted in the same context it was sanitized for.
  - Two gaps in the sanitizer configs: `area`/`map` and SVG `xlink:href` links are kept (N10), and Markdown keeps `class`.
- **Permissions:**
  - `validate.yml` has `contents: read` and runs on `pull_request` (not `_target`). Fork PRs get no secrets.
  - `ci.yml` has **no `permissions:` block**, so it gets the repository default token. Add `contents: read`.
  - `release.yml` is `workflow_dispatch` only, gated to `refs/heads/main`, with `contents: write` workflow-wide.
  - `website.yml` gives `pages: write` and `id-token: write` to the build job too, where only deploy needs them.
- **Script injection:** the `${{ }}` uses in `run:` blocks are:
  - `needs.check-and-bump.outputs.version`, from `tauri.conf.json` via jq;
  - `steps.signing.outputs.suffix`, a constant;
  - `steps.collect.outputs.aab`, derived from the version.

  None is attacker-controlled from outside, because all require write access.
- **Supply chain (pre-existing):**
  - No action is SHA-pinned. That includes third-party actions that handle secrets: `r0adkll/upload-google-play@v1`, `tauri-apps/tauri-action@v0`, `softprops/action-gh-release@v2`.
  - In `release.yml` the Android job exports all five signing and Play secrets as **job-level env**, so every step sees them, including `npm ci` install scripts, `npx tauri`, and Gradle. Move them to the steps that need them.
  - There is no `.npmrc` with `ignore-scripts`. The `allowScripts` field in `package.json:56` is not enforced by stock npm (unverified for the runner's npm version; treat it as inert).
- **cargo-audit (new evidence, R1).** No vulnerabilities in 431 crates. Four warnings:
  - `proc-macro-error` 1.0.4 is unmaintained (RUSTSEC-2024-0370, build-time only);
  - `glib` 0.18.5 is unsound (RUSTSEC-2024-0429, Linux, not reachable);
  - `tokio` 1.53.1 is unsound (RUSTSEC-2026-0386, `AsyncFd`);
  - `yoke-derive` 0.8.3 is yanked.

  Adding cargo-audit to `ci.yml` is recommended (nice-to-have).
- **Re-run on the current merge state:** R1/R2 run the `ci.yml` frontend steps and cargo test; R3 runs `validate.yml`. All green.

---

## 4. New issues, ranked by severity

Status labels:

- **Confirmed (CI)**: proven by a test in R1, R2 or R3.
- **Confirmed (code)**: traced in the source, not executed.
- **Plausible**: needs a device or real-browser check.

"Pre-existing" means the issue is on main and was not introduced by the branch.

### Medium

**N1. DOCX `altChunk` becomes a same-origin, unsandboxed `<iframe srcdoc>` that LinkGuard cannot see.** Confirmed (CI, R2); pre-existing.

- **Where:**
  - `src/screens/viewer/DocxView.tsx:119-128` (and the print call around 373) calls `renderAsync` without `renderAltChunks: false`.
  - docx-preview 0.4.0 defaults it to `true` (`docx-preview.mjs:3973`) and sets `iframe.srcdoc` to the raw part (`:3585-3592`).
  - The output is moved straight into the page at `DocxView.tsx:131`.
- **Attack:** a link inside the frame with `target="_top"` sends the whole Tauri window to an attacker URL on one click.
  - LinkGuard's listener sits on the parent document and never sees clicks inside the frame (`src/ui/LinkGuard.tsx:38`).
  - Neither the CSP nor any `on_navigation` handler stops top-level navigation (none exists in `src-tauri/src`).
  - Combined with N2's CSS, the frame can be made full-window and transparent, so the first click anywhere navigates away.
- **Impact:**
  - A frameless phishing page, and the app goes online despite its offline promise.
  - Script inside the frame is blocked by the inherited CSP.
  - Residual risk: the frame is same-origin with `parent.__TAURI_INTERNALS__`, so any future script gadget would mean file read on desktop.
- **Fix:**
  - Pass `renderAltChunks: false` in both calls, and remove `iframe, frame, object, embed` from `staging` before inserting it.
  - Add a Rust `on_navigation` handler that allows only the app origin, and deny new windows.

**N2. A DOCX can inject page-wide CSS.** Confirmed (CI, R2); pre-existing.

- **Where:** docx-preview builds `<style>` text by concatenation (`styleToString`, `:3857`; font names via `parseFont`, `:2537-2542`; style IDs as selectors, `:3043`, `:3370-3378`), and the `<style>` nodes land in the live page (`DocxView.tsx:131`).
- **Proof:** a `w:rFonts` value of `x;}body{visibility:hidden}.z{` produces a real `body{visibility:hidden}` rule (R2).
- **Impact:** hide or restyle any app UI, spoof prompts, enable N1's overlay. Data cannot leave: `url()` and `@import` are blocked.
- **Fix:** render the docx output into a shadow root or a sandboxed iframe without `allow-scripts`/`allow-same-origin`. Cheaper partial fix: strip `{`, `}` and `;` from font names and style IDs before rendering.

**N3. safeZip: stored entries that share one payload bypass the budget.** Confirmed (CI, R1); **introduced in scope**, since it defeats the PW-SEC-03 fix.

- **Where:** `src/lib/safeZip.ts`:
  - the filter (lines 77-89 of the new file) charges `file.originalSize`;
  - fflate slices stored entries at the compressed size (`slc(data, b, b + sc)`).
- **Effect:** a central directory with N entries all pointing at one stored payload, each claiming size 0, is accepted whole.
  - R1 measured 1 MiB on disk → **300 MiB** in memory, all 300 entries accepted, at default limits.
  - With a 16 MiB budget it throws only from the post-inflate sum, after 64 MiB was allocated.
  - At the default 8192 entries, that is about 8 GiB per MiB of file.
- **Fix** (tested in `review/safeZip.fixed.ts`, R1):
  - charge stored entries their `size`;
  - skip stored entries whose two sizes differ;
  - skip any `size > bytes.length`.

**N4. safeZip: a ZIP64 record smuggles in billions of entries.** Confirmed (CI, R1); pre-existing in fflate, but the guard's `maxEntries` promise is bypassed.

- **Cause:**
  - The pre-scan reads the classic end record: entries at offset 10, offset at 16.
  - fflate reads entries at offset **8** and follows a ZIP64 locator found 20 bytes before the end record (`fflate/esm/index.mjs:2678-2690`).
- **Effect:** a ~200-byte file with a ZIP64 count of 2³²−1 is walked entry by entry. R1 measured 1e6 entries in 117 ms, which extrapolates to **about 8 minutes of a frozen tab**. A 9000-entry ZIP64 archive is not refused.
- **Fix** (tested):
  - count entries inside the filter and throw past `maxEntries`;
  - refuse a ZIP64 locator in the pre-scan;
  - read `max(u16(at+8), u16(at+10))`.

**N5. `rename_file` lets a document become a script.** Confirmed (code); pre-existing, and the audit doc misstates it.

- **Where:** `src-tauri/src/save.rs:56-68` accepts any new name that passes `open::is_document`, which also accepts `SCRIPT_EXTENSIONS` (`open.rs:28-30, 39-45`: `bat`, `ps1`, `sh`, `py`, `js`, …) plus `html`/`svg`.
- **Effect:**
  - `report.pdf → report.bat` is allowed, contradicting `docs/16-security-audit.md:85-88` ("extension kept").
  - `valid_name` lets U+202E (RLO) through, which can disguise a name.
  - Any absolute path works, not just the open document.
- **Precondition:** XSS, or a tampered recents store.
- **Fix:**
  - Require the new extension to equal the old one, compared case-insensitively.
  - Reject Unicode format (Cf) and bidi characters.
  - Optionally, rename only paths Rust has seen opened.
- **Accepted risk #2 needs re-deciding on these facts.**

**N6. The Android `fs:default` grant exposes the whole private data directory.** Confirmed (code, against tauri-plugin-fs 2.5.2 sources); pre-existing.

- **Cause:** `src-tauri/capabilities/mobile.json:11-16` adds `fs:default`, which brings `read-app-specific-dirs-recursive` (`$APPDATA/**`, `$APPCACHE/**`, …) and `create-app-specific-dirs`.
- **Effect:** script in the webview could read store files, shared_prefs, WebView data, and cached filled-in forms. The capability's own description ("A parser bug can therefore not read arbitrary app-private files") is false.
- **Fix:** replace `fs:default` with explicit `fs:allow-read-file`/`read-text-file`/`exists`/`read-dir`, scoped to `content://**` and the real imports folder.
- The desktop `fs:default` + `**` likewise grants `mkdir` anywhere (`desktop.json:21-31`), contradicting "read-only by construction" (Low).

**N7. Rust and Kotlin appear to use different imports folders on Android.** Plausible; needs a device check; pre-existing.

- **Where:**
  - Rust: `data_dir(app, "imports")` = `app_data_dir()/imports` (`src-tauri/src/lib.rs:65-67`). On Android, Tauri's `app_data_dir` is the data dir.
  - Kotlin: `File(filesDir, "imports")` (`MainActivity.kt:603`).
- **If true:**
  - `imports_stats` reports 0;
  - Clear, Remove and Prune do nothing on Android;
  - `IMPORTS_MAX_BYTES` is never enforced;
  - files open only because of N6's over-broad scope.
- **Privacy note:** "Clear" would claim copies are gone when they are not.
- **Fix:** derive both paths from one place, and test stats and clear on a device.

### Low

**N8. safeZip's 200x ratio drops honest parts silently.** Confirmed (CI, R2). Introduced by the branch.

- A blank 1000×1000 BMP (ratio 1022) and a repetitive CSS file (ratio 481) are dropped with no error.
- Real Office files embed BMP, TIFF, EMF and WMF images that compress like this.
- Fix: set `maxRatio` to about 1100. Deflate's own ceiling makes a ratio above about 1032 impossible, which is the only claim worth refusing. Tested in `review/safeZip.fixed.ts`.

**N9. Not every archive goes through safeZip.** Confirmed (code). This is a coverage gap in PW-SEC-03's "all paths" claim.

- DOCX is inflated by JSZip inside docx-preview (`DocxView.tsx:118`; `jszip` 3.10.1 in the lockfile).
- XLSX and ODS are inflated by SheetJS (`workbookModel.ts:444`, in a worker), and legacy CFB by `XLSX.CFB.read` (`parseWorker.ts:38`).
- None has a size cap.
- Fix: pre-check these archives with the safeZip central-directory scan, or reject them by size before handing them over. The worker's abort contains SheetJS somewhat.

**N10. LinkGuard misses `<area href>` and SVG `<a xlink:href>`.** `area`: Confirmed in jsdom at the sanitizer and selector level. `xlink`: Plausible, needs a real WebView.

- `LinkGuard.tsx:38` uses `closest("a[href]")`.
- DOMPurify 3.4.17 keeps `<map><area href>` and `<svg><a xlink:href>` under both app configs.
- `epub.ts:212-218` rewrites only `a[href]`.
- A Markdown or EPUB image map can navigate the top window on click (same impact as N1).
- Fix: `closest("a, area")` plus an `xlink:href` read; add `area`/`map` to both `FORBID_TAGS`; add the native `on_navigation` backstop from N1.

**N11. Windows network (UNC) paths are accepted** by `open_external`, `reveal_in_folder` and `rename_file` (`src-tauri/src/open.rs:56-68`). Confirmed (code).

- The `is_file()` probe on `\\host\share\x.pdf` opens an SMB connection and leaks the NTLM hash.
- Needs XSS or a tampered recents list.
- Fix: reject `Prefix::UNC`, `VerbatimUNC` and `DeviceNS`.

**N12. The Android origin gate is still looser than needed.** Covered under PW-SEC-05: any scheme and port, and localhost in release.

**N13. A symlink rename can destroy a file.** Confirmed (code). `save.rs:74-86`: the `same_file` exception canonicalizes through links, so renaming `a.pdf` (a link to `b.pdf`) to `b.pdf` replaces the real file with a link to itself. Separately, `exists()` followed by `fs::rename` races, because the rename replaces existing files. Fix: allow the same-file exception only for case-only changes, and use a no-replace rename.

**N14. Android intent handling.**

- The VIEW filter accepts the `file` scheme and BROWSABLE (`scripts/install-android.mjs:99-100`), so another app can make Paperwren copy in its own private files.
- There is a single ingest thread with no read timeout.
- `SEND_MULTIPLE` has no count cap.
- Fix: accept `content://` only, refusing the app's own authorities; add a timeout; cap the count.

**N15. Android save flow.** Plausible (code).

- A second `saveBegin` while a picker is open overwrites `saveToken`/`saveFile` (`MainActivity.kt:968-1015`), leaving an empty file and an unresolved promise.
- `cache/saving` is never swept, so a killed save leaves a filled-in form behind.

**N16. The manifest hardening check does not test the real manifest.** Confirmed (code).

- `install-android.mjs check` (288-340) validates a sample string, not the generated or merged manifest.
- `verify-android-release.mjs:99-100` only warns when `aapt2` is missing.
- Fix: run `aapt2 dump xmltree` on the release APK and assert `exported`, `debuggable`, `allowBackup`, cleartext and permissions; make a missing aapt2 fatal.

**N17. CI and supply chain** (pre-existing; details in section 3):

- unpinned actions;
- job-level secret env in `release.yml`'s Android job;
- no `permissions:` block in `ci.yml`;
- the URL dependency invisible to `npm audit`;
- dev-dependency advisories.

**N18. Store hygiene.** Info.

- `store.rs:50-62` has no size cap on values and no limit on key count.
- Its temp file leaks on `write_all`/`sync_all` errors.
- Keys are case-sensitive while the Windows and macOS file systems are not.
- Error messages carry OS error text but not paths (`error.rs:43-64`), so the audit's path-leak worry is unfounded, except that `rename_file`/`save_as` return paths by design.

### Parser robustness (honesty-section areas: office/, exif, pptx, odf, sniff)

These are all pre-existing. In JavaScript the realistic harm is a hang or
an out-of-memory crash, not code execution. A hang on the main thread
freezes the whole app. A hang in the parse worker lasts until the reader
leaves the viewer: `runWorker.ts` starts a fresh worker per parse and
terminates it on abort, but has no timeout.

**N19. `isSvg` regex has catastrophic backtracking.** Medium. Confirmed (my local repro, Node 24 / V8).

- **Where:** `src/lib/sniff.ts:37` runs `/^\s*(<\?xml…)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE…)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i`.
- **Reach:** called from `sniffImageType` (`sniff.ts:62`) and so from format sniffing (`sniff.ts:232`), on the main thread, for any file that is not a known binary type.
- **Input:** `"<!---->".repeat(n) + "x"`. Measured: 16 comments (113 B) 22 ms, 18 comments 107 ms, 20 comments (141 B) 407 ms, about ×4 per two comments. A ~280-byte file freezes the app for days.
- **Fix:** scan without a regex: skip whitespace, the XML declaration, comments (`indexOf("-->")`) and the DOCTYPE, then test for `<svg`.

**N20. Other hangs and out-of-memory crashes on the main thread.** Medium. The parser reviewer reproduced or traced each one; I did not re-run them.

| # | Where | Crafted input → effect | Fix |
|---|---|---|---|
| a | `pictures.ts:68` → utif2 `UTIF.decode` | A 26-byte TIFF whose next-IFD pointer points at itself → endless IFD list (3M objects in 4.7 s), hang then OOM | Walk the IFD chain first with a visited set and a cap of about 1024 |
| b | `pptx/parse.ts:1263-1300, 1328` `readDiagram` | A diagram drawing whose relationship points at itself, with two diagram frames → 2^depth recursion | A visited set of diagram parts, depth cap of about 4 |
| c | `office/doc.ts:548-553` `letters()` via `odf.ts:279-291` | ODT `text:start-value="Infinity"` with letter numbering → endless loop, OOM | Clamp `n` to a finite range |
| d | `odf.ts:351, 744-747` | One paragraph with ~200k spans → quadratic join | Track the last character, not a full join |
| e | `odf.ts:357, 755` | `text:c="500000000"` → `" ".repeat` of 500 MB | Clamp to about 1000 |
| f | `odf.ts:1133` | 50k master shapes × 50k pages → 2.5e9 elements | Build master shapes once per master |
| g | `epub.ts:168-198` | 40k spine refs to one chapter → re-parsed and re-sanitized 40k times | De-duplicate the spine by path; filter the unzip to the parts needed |
| h | `pdfTools.ts:64` `PDFDocument.load` | FlateDecode bomb in an object stream (Plausible) | Size check before the PDF tools load a file |

**N21. Hangs and out-of-memory crashes in the parse worker.** Low (the reader can leave to abort).

- Legacy Word:
  - piece-table amplification (`doc.ts:651-661`, `legacy.ts:226-241`);
  - quadratic `cleanWordText` (`legacy.ts:177-192`, measured 60k chars in 895 ms);
  - quadratic field handling (`doc.ts:917, 933`);
  - an unbounded `lfoCount` (`doc.ts:513-515`) and SPA count (`doc.ts:784-801`).
- PowerPoint amplification through repeated persist and text references (`ppt.ts:913-942, 703-715`).
- Quadratic `sheetStyles.ts` regexes (lines 452-463, 601, 257; 380 KB took 9.6 s).
- `office/crypto.ts:66-71`: a `blockSize`/`keyBits` from the file allocates gigabytes before the password is checked. Whitelist 16 and 128/192/256.
- `workbookModel.ts:500-528`: per-sheet arrays sized from `<dimension>`, with no budget across sheets.
- SheetJS `CFB.read`: a FAT self-loop (`xlsx.mjs:1863-1878`, `chkd` written but never read) loops forever. This is in the library; a watchdog timeout in `runWorker` is the practical mitigation.

**N22. pdf.js runs with no size limits.** Low. `pdfEngine.ts:32-39` and `PdfView.tsx:331-337` leave `maxImageSize` and `canvasMaxAreaInBytes` unlimited (-1). Set them; consider `disableFontFace: true`.

**N23. Lookups by attacker-chosen names crash PPTX parsing** (`pptx/parse.ts:404-410`). Low. `<a:schemeClr val="constructor"/>` returns a function from a plain-object lookup, so the deck refuses to open. There is no global pollution, because only strings are assigned. Use `Object.hasOwn` or `Map`.

Checked and found sound by the parser pass:

- **escher** record walk: always advances, bounds-checked, depth cap 24.
- **legacy PPT** walk: depth cap 32.
- **doc.ts** sprm, run, style and font readers: bounded.
- **ppt.ts** shapes and masters: depth caps and caches.
- **RTF:** a single linear pass.
- **EXIF:** bounds-checked, no IFD chain followed.
- **ODF** style chain: a visited set and a cap of 20.
- **Chart and workbook** point, row and column caps.
- **pptx** theme and clrMap: assigned strings only, so no pollution.
- **crypto** spin count: capped at 10M.

### Checked and found sound (independent pass)

- **CSP** (`tauri.conf.json:27`): `script-src 'self' 'wasm-unsafe-eval'` (no inline, no eval in release), `object-src 'none'`, `form-action 'none'`, `base-uri 'self'`; frames fall back to `default-src 'self'`. HTML injection cannot become script; it can still become CSS and navigation (N1, N2, N10).
- **EPUB sanitizing** (`epub.ts:235-251`): a strong `FORBID_TAGS`/`FORBID_ATTR` list. The output is inserted in the same HTML context it was sanitized for. No mXSS path found.
- **KaTeX** runs with `trust: false`. highlight.js gets escaped `textContent`.
- **pdf.js** 4.10.38 runs with `isEvalSupported: false` (`PdfView.tsx:333`, `pdfEngine.ts:35`), with no scripting or XFA.
- **PPTX, ODF and Office links** are limited to `http`, `https` and `mailto` (`pptx/parse.ts:952`, `office/doc.ts:684`, `odf.ts:261`).
- **SVG images** are shown only through `<img>` from blob URLs.
- **The app's own code** has no `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`, `window.open`, or `iframe`/`object`/`embed`.
- **Rust paths:**
  - store keys use an ASCII allowlist of up to 64 characters;
  - `imports::resolve` rejects `..`, absolute paths, `\` and NUL;
  - imports walk, remove and clear never follow symlinks;
  - `save_as` takes its path only from the OS dialog;
  - `open_with_default` passes the path with no shell and excludes scripts;
  - no `dangerous*` flags, `withGlobalTauri` is false, and there is no asset protocol.
- **Android:**
  - the FileProvider is not exported and serves only `files/imports`;
  - `outgoingUri`/`openStream` canonicalize and check the prefix;
  - `safeFileName` uses an allowlist and maps `..`;
  - every `evaluateJavascript` call is origin-gated, with JSON-quoted arguments;
  - the `saving` map is synchronized;
  - URI grants are read-only and temporary.
- **New main features** (folder tree, swipe pages, save page picture) add no HTML sink and no Rust command. The folder tree adds `fs:allow-stat` and `fs:allow-read-dir` under the existing `**` scope (`desktop.json:32-53`), and the Android `pickFolder`/`listFolder` bridges are origin-gated.

---

## 5. Required before merge vs nice-to-have

### Required before merging PR #34

1. **Close the safeZip bypasses (N3, N4) and the ratio regression (N8)** in `src/lib/safeZip.ts`:
   - charge stored entries their `size`;
   - skip stored entries whose sizes differ, and any `size > bytes.length`;
   - count entries in the filter;
   - refuse a ZIP64 locator;
   - read the entry count fflate uses;
   - set `maxRatio` to about 1100.

   `review/safeZip.fixed.ts` does all of this and passes the branch's 7 tests plus 4 new ones (R1, R2).
2. **Add regression tests** for the stored-overlap and ZIP64 archives (port `review/zipcraft.ts` and the "suggested fix" block of `review/bypass.test.ts`), and a test for the filter's entry cap (it survives mutation today).
3. **Correct `docs/16-security-audit.md`:**
   - PW-SEC-01 is not reachable (none of the vulnerable modes are used), so it is Low, not Critical.
   - PW-SEC-02 is worker-contained.
   - `rename_file` does **not** keep the extension (N5).
   - The mobile capability is not "only content:// and imports" (N6).
   - Residual risk #3 is wrong in both directions: the real residual risks are N3, N4 and N9, not a lying deflate header (fflate's preallocated output already bounds that).
4. **Bring the branch up to date with main** and re-run Test builds on the PR itself. This review tested the merge (R3, green), but the PR's own checks are from the old main.

### Next, in follow-up PRs (pre-existing, ranked)

1. **N19:** replace the `isSvg` regex with a linear scan. Any file can trigger it, and the fix is small.
1. **N1:** `renderAltChunks: false`, strip frames from the docx output, add a Rust `on_navigation` allowlist and deny new windows.
1. **N20:** fix the main-thread parser hangs (TIFF IFD cycle, PPTX diagram recursion, ODF clamps, EPUB spine de-duplication); add a watchdog timeout to `runWorker` for N21.
2. **N6, N7:** replace `fs:default` on mobile (and desktop) with explicit read permissions; unify the Android imports folder.
3. **N5:** keep the extension on rename; reject bidi characters.
4. **N2:** isolate docx CSS (shadow root or sandboxed iframe).
5. **N10:** LinkGuard should catch `area` and `xlink:href`; forbid `area`/`map`.
6. **N9:** size-check DOCX, XLSX and ODS archives before JSZip or SheetJS.

### Nice-to-have

- **Android origin gate (PW-SEC-05):** exact origin plus `BuildConfig.DEBUG`; or `addWebMessageListener`.
- **Android ingest (PW-SEC-04, N14):** read timeout, URI count cap, a "too large" message.
- **UNC paths (N11):** reject them.
- **Rename (N13):** symlink handling and a no-replace rename.
- **Android save (N15):** save-flow guard and a `cache/saving` sweep.
- **Manifest check (N16):** check the real APK manifest with aapt2.
- **CI:**
  - add cargo-audit;
  - add `permissions: contents: read` to `ci.yml`;
  - pin actions to SHAs;
  - move release secrets to step-level env;
  - add `ignore-scripts` with an explicit allowlist;
  - upgrade vitest/vite (dev advisories).
- **Store:** caps and lowercase-only keys (N18).
- **DOMPurify:** a test asserting its call sites never use the vulnerable modes.

---

## 6. Manual steps for you

1. **Update the branch.** Merge `main` into `security/audit-hardening` (or rebase it). The 3-way merge is clean (verified: commit `d4125c4` on the review branch). Then let PR #34's checks run on the new head. R3 shows the merged tree passes all Test builds jobs.
2. **Apply the safeZip changes** from section 5 (required items 1-3) on the audit branch, or let the original agent do it with this report as the brief.
3. **Decide the accepted risks again, with corrected facts:**
   - Desktop `**` read scope: keeping it is defensible for recents, but replace `fs:default` with explicit read-only permissions so it is really read-only (N6, last line).
   - `rename_file` scope: today it can turn any document into a `.bat`/`.ps1`. Recommended: keep the extension, not accept.
   - Residual zip DoS: replace with N3, N4 and N9 as described.
   - macOS ad-hoc signing: no change.
   - Behaviour changes:
     - Android shares over 250 MiB are refused (OK);
     - archives over the caps show as "damaged" (OK);
     - the 200x ratio drops honest images (fix it, N8);
     - SheetJS 0.20.3 passed every unit test and Playwright run (R1, R3), but no differential test against real-world workbooks was done.
4. **On an Android device:**
   - share a file larger than 250 MiB (expect the generic error);
   - open a file via "Open with", then check Settings → storage (`imports_stats`). If it shows 0, N7 is real.
5. **Delete the throwaway branch** `review/security-audit-verification` when you are done. It also holds `.github/workflows/review-verification.yml`, which runs only on that branch.
6. Consider adding `cargo audit` to `ci.yml`. It found no vulnerabilities today (R1).

---

## 7. Summary

- **Verdict: APPROVE WITH CHANGES.**
- **Findings verified:**
  - 5 of 5 existed on main.
  - 2 of 5 are overstated in severity: PW-SEC-01 is not reachable, and PW-SEC-02 is worker-contained.
  - Fixes are fully correct for 3 of 5 (01, 02, 04) and partial for 2 (03, 05).
- **Regression tests meaningful:**
  - 1 of 5 findings has tests (PW-SEC-03). 4 of its 7 tests are proven meaningful by failing without the guard. 2 of 5 mutants survive.
  - The other 4 findings have no test, and that is accepted (N-A).
- **New issues:**
  - 0 Critical, 0 High.
  - **9 Medium:**
    - N1-N7, with N7 needing a device check;
    - N19, the `isSvg` regex freeze, which any opened file can trigger;
    - N20, main-thread parser hangs.
  - **14 Low or Info:** N8-N18 and N21-N23.
  - N3, N4 and N8 are in the branch's own new code. Everything else is pre-existing on main.
- **Top 5 fixes before merge:**
  1. Stored-overlap budget bypass (N3)
  2. ZIP64 entry count (N4)
  3. Ratio threshold to about 1100 (N8)
  4. Tests for both bypasses and the entry cap
  5. Corrected audit doc (rename, mobile scope, severities)

  Right after merge:
  - the `isSvg` regex (N19), a one-function fix to a freeze any file can cause;
  - docx `renderAltChunks: false` plus a navigation allowlist (N1).
