# Security audit — October 2026

A pass over every layer that touches untrusted bytes: the two trust
boundaries (the Tauri commands and the Android bridge), the parsers a
document reaches, everything that reaches the DOM, the dependency
tree, and the release pipeline. Every file under `src/` and
`src-tauri/` was searched for this, and the code at each boundary
read; the largest viewers and the legacy Office parsers were searched
rather than read line by line, and an independent review afterwards
(REVIEW_SECURITY_AUDIT.md on the `review/security-audit-verification`
branch) found more there — see "Still open" below. The findings are
what came out, what was done about each, and what was deliberately
left as it is.

Nothing here changes what the app is: no network, no permissions, no
accounts. The audit was about keeping it that way even when a file is
a lie.

---

## Fixed

### DOMPurify carried five published XSS advisories (low here)

DOMPurify sanitises every byte of untrusted HTML in the app: the
chapters of an EPUB and a rendered Markdown file above all. Version
3.4.14, which the lockfile held, is covered by five advisories
(GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2, GHSA-cg2g-xh64-v4q7,
GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f) — mutation-XSS and hook
bypasses in the sanitizer itself. Every one of them needs a mode the
app never uses: `IN_PLACE` with hooks, `SAFE_FOR_TEMPLATES` with DOM
output, or `PARSER_MEDIA_TYPE: application/xhtml+xml`. Both call sites
(`lib/epub.ts`, `screens/viewer/TextView.tsx`) sanitise a string to a
string with only `FORBID_TAGS`/`FORBID_ATTR`, so none was reachable.
3.4.17 fixes all five anyway, so a later change of config cannot walk
into them; nothing in the call sites needed to change.

### SheetJS 0.18.5: prototype pollution and a ReDoS (low to medium here)

A workbook a reader opens is parsed by SheetJS in a worker. 0.18.5 —
the last version npm has — is open to prototype pollution
(GHSA-4r6h-8v6p-xvw6) and a regular-expression denial of service
(GHSA-5pgg-2g8v-p4x9) from crafted input. npm has no fix: the project
left the registry. The dependency now points at the upstream 0.20.3
tarball on cdn.sheetjs.com, which fixes both. The API the app uses
(`read`, `CFB.read/find`, `utils.encode/decode`) is unchanged; the
whole unit suite passes on it. The advisories are rated high, but here
SheetJS runs in a fresh worker per file that is terminated when the
reader leaves: pollution dies with the worker, and a ReDoS hangs only
that worker. A URL dependency is invisible to `npm audit` and
Dependabot, so new SheetJS releases have to be watched by hand.

### An archive could ask for unbounded memory (medium)

EPUB, CBZ, ODF, XLSX styles and PPTX are inflated with fflate.
Nothing bounded the inflation: a hostile EPUB of a couple of megabytes
could claim — or truly contain — gigabytes, and `lib/epub.ts`
inflated the whole archive at once. Now every fflate unzip goes
through `guardedUnzip` (`lib/safeZip.ts`). Before inflating anything
it reads the end record and central directory and refuses ZIP64, more
than 8192 entries, or an entry claiming more than 512 MB. As fflate
walks the entries it counts them again, skips any whose sizes cannot
be true (a compressed size past the archive's end, a stored entry
whose two sizes differ, a claimed expansion past 1100×, which deflate
cannot reach), and charges each what fflate really allocates — a
stored entry's copy, a deflated entry's claimed buffer — against a
1 GB total. A caller's own filter still decides which entries it
wanted; the guard only ever shrinks that set.

The first version of the guard charged stored entries their *claimed*
size and read a different entry count from fflate. The review showed a
1 MiB archive of stored entries sharing one payload could unpack to
300 MiB, and a ZIP64 record could make fflate walk four billion
entries. Both are closed and tested, and the ratio, first 200×, no
longer drops honest blank images and stylesheets.

This covers fflate only. DOCX is inflated by JSZip inside
docx-preview, and XLSX/ODS and legacy OLE files by SheetJS, with no
cap; see "Still open".

### A shared file could stream forever (medium)

On Android, the copy made of a file another app shared or handed over
("Open with") was written whole, whatever arrived: a sharing app can
report any size, or none, and stream indefinitely, filling the phone's
storage before the reader could ask anything. `copyIn` now counts
bytes and cuts off past 250 MiB — the cap the imports store documents —
and throws the partial copy away. (Whether the Rust imports store and
this copy share one folder on Android is still to be checked on a
device; see "Still open".) A picked file that cannot be copied
still falls back to opening straight from its URI, as before.

### The Android origin check was a prefix match (low)

Every JS bridge (`__paperwrenAndroid`, `__paperwrenAndroidExtras`)
and every `evaluateJavascript` into the page is gated on
`isAppOrigin(webView.url)`. It compared with `startsWith`, so a page
at `http://localhost.attacker.tld` would have been taken for the
app's own (unreachable in practice — the app never navigates away,
and links are guarded — but it is the one gate the bridges have). The
host is now parsed and compared whole. It still accepts any scheme and
port, and `localhost` in release builds; tightening it to exactly
`http://tauri.localhost` outside debug builds is a follow-up.

---

## Left as it is, on purpose

**Desktop reads the whole file system (read-only).** The fs plugin's
desktop scope is `**`, read-only, because reopening a recent from a
previous session resolves a plain path with no fresh user gesture —
the dialog runtime scope cannot cover it. The exposure is read-only by
construction for file contents, the writes (`save.rs`) go through
system dialogs, and desktop builds are internal (docs/12). An XSS would
gain *read*, which is exactly why the sanitizer above is kept current.
One correction: the grant is `fs:default` with a `**` scope, and
`fs:default` includes `mkdir`, so a compromised page could also
create folders. Replacing it with explicit read permissions is a
follow-up.

**`rename_file` is reachable for any document.** From a compromised
page it can rename any file of a document type, anywhere, to another
name in the same folder, never over another file. The extension is
**not** kept: the new name only has to be a type the app opens, and
that list includes scripts (`.bat`, `.ps1`, `.sh`, `.py`, `.js`)
and `.html`/`.svg`, so `report.pdf` can become `report.bat`, and a
right-to-left override character can disguise the result. It still
needs an XSS first, but "cannot destroy or reveal anything" undersold
it. Keeping the extension and refusing bidi characters is a follow-up,
and this acceptance should be decided again on these facts.

**A lying zip header can still cost a tab.** fflate decodes a deflated
entry into a buffer of exactly its claimed size, so a header that lies
small cannot overrun; one that lies large is held to the caps, which
still allow 1 GB in total — enough to crash a tab on a small phone.
That is a denial of service on a file the reader chose to open, with
no code run and no data touched. The archives that do not go through
the guard at all (DOCX, XLSX/ODS, legacy OLE) are the larger residual
risk; see "Still open".

**macOS is ad-hoc signed.** Documented on the download page; Gatekeeper
asks once. The Windows installers and the Android APK are signed in CI
from repository secrets.

---

## Checked and found sound

- **The Rust commands** (`src-tauri/src/`): every path a web layer can
  pass is validated — absolute, existing, a document type
  (`open.rs`); managed-copy paths are one or two plain components
  inside the imports store (`imports.rs`); store keys are
  `[A-Za-z0-9_-]` (`store.rs`); names for renames refuse Windows'
  forbidden and reserved names, trailing dots and spaces
  (`save.rs`). Writes are atomic; tests cover the traversal attempts.
- **The Android bridge**: every method checks the page origin; share
  and open-elsewhere only ever expose the imports store (the
  FileProvider's paths file lists exactly `imports/`); display names
  are stripped to plain characters before they become file names;
  folder scans are bounded (2000 files, 400 folders, depth 4); intents
  are consumed so a configuration change cannot re-import. Two
  harmless methods, `keepAwake` and `stopSpeaking`, take no origin
  check.
- **The manifest** (`scripts/install-android.mjs`): zero permissions
  (the template's INTERNET is stripped and a check fails if one
  returns), `allowBackup="false"`, `singleTask`, and both FileProviders
  scoped; CI validates the hardening is idempotent.
- **Untrusted HTML paths**: EPUB chapters and Markdown are sanitised
  with DOMPurify (scripts forbidden, `style` and `class` dropped for
  EPUB); KaTeX renders with `trust: false`, `maxExpand` and `maxSize`;
  highlight.js escapes its own output; SheetView's print path renders
  through React, which escapes; SVG pictures are shown through
  `<img>`, where their scripts cannot run; HTML and source files are
  shown as text, never rendered.
- **Links**: a capture-phase guard (`ui/LinkGuard.tsx`) prevents every
  link from navigating; within-document anchors scroll, web/mail
  addresses are offered to copy.
- **pdf.js** runs with `isEvalSupported: false`, under a CSP that
  allows only `'self'` and `'wasm-unsafe-eval'` for scripts (the wasm
  is the on-device scanner's model), `object-src 'none'`,
  `form-action 'none'`.
- **Passwords** (PDF and Office) live in one worker call, decrypt in
  memory through WebCrypto, and are never stored or logged.
- **The workflows**: no untrusted expression reaches a `run:` block;
  release runs from `main` only, test builds never publish; the
  Android release job verifies signature, architecture and size.

## Still open

Found by the independent review. None was introduced by this audit;
each is a follow-up rather than part of it.

- **The mobile capability is not what it says.** `mobile.json` grants
  `fs:default`, which brings read access to the whole app-private
  data directory (`$APPDATA/**`, `$APPCACHE/**`, …), not only
  `content://` and the imports store as its description claims.
- **The Android imports folder may be two folders.** Rust uses
  `app_data_dir()/imports`, Kotlin `filesDir/imports`. If they differ
  on a device, the imports stats, Clear and the store's size cap never
  touch the copies.
- **DOCX** (docx-preview): an `altChunk` becomes an unsandboxed
  same-origin `<iframe srcdoc>` the link guard cannot see, so one
  click can send the window to a web page; font names and style IDs
  can inject page-wide CSS. Pass `renderAltChunks: false`, isolate
  the output, and add a native navigation allowlist.
- **Links the guard misses**: `<area href>` and SVG `xlink:href` in
  Markdown and EPUB.
- **`lib/sniff.ts` `isSvg`**: its regex backtracks exponentially on a
  few hundred bytes of empty comments, freezing the app on any file.
- **Parsers**: hangs and large allocations from crafted TIFF (IFD
  cycle), PPTX (self-referencing diagram), ODF (`start-value`,
  `text:c`), legacy Word and PowerPoint, Office encryption
  parameters, and SheetJS's CFB reader; `runWorker` has no watchdog
  timeout.
- **Archives outside the guard**: DOCX through JSZip, XLSX/ODS and OLE
  through SheetJS.
- **Windows network paths** are accepted by the path commands.

## Re-running this audit

`npm audit --omit=dev` for the dependency tree, `cargo test
--manifest-path src-tauri/Cargo.toml` for the Rust commands, and a
read of any new code that reaches `innerHTML`, `evaluateJavascript`,
`unzip`, a file path, or an `Intent`. The checks that keep the
baseline: `npm test` (the `safeZip` suite among them), `node
scripts/install-android.mjs check`, and CI's lint, build and browser
tests.
