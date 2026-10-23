# Security audit — October 2026

A pass over every layer that touches untrusted bytes: the two trust
boundaries (the Tauri commands and the Android bridge), the parsers a
document reaches, everything that reaches the DOM, the dependency
tree, and the release pipeline. Every file under `src/` and
`src-tauri/` was read for this; the findings below are what came out,
what was done about each, and what was deliberately left as it is.

Nothing here changes what the app is: no network, no permissions, no
accounts. The audit was about keeping it that way even when a file is
a lie.

---

## Fixed

### DOMPurify carried five published XSS advisories (critical)

DOMPurify sanitises every byte of untrusted HTML in the app: the
chapters of an EPUB and a rendered Markdown file above all. Version
3.4.14, which the lockfile held, is covered by five advisories
(GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2, GHSA-cg2g-xh64-v4q7,
GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f) — mutation-XSS and hook
bypasses in the sanitizer itself, meaning the sanitised output could
carry executable markup. 3.4.17 fixes all five; nothing in the call
sites (`lib/epub.ts`, `screens/viewer/TextView.tsx`) needed to change.

### SheetJS 0.18.5: prototype pollution and a ReDoS (high)

A workbook a reader opens is parsed by SheetJS in a worker. 0.18.5 —
the last version npm has — is open to prototype pollution
(GHSA-4r6h-8v6p-xvw6) and a regular-expression denial of service
(GHSA-5pgg-2g8v-p4x9) from crafted input. npm has no fix: the project
left the registry. The dependency now points at the upstream 0.20.3
tarball on cdn.sheetjs.com, which fixes both. The API the app uses
(`read`, `CFB.read/find`, `utils.encode/decode`) is unchanged; the
whole unit suite passes on it.

### An archive could ask for unbounded memory (medium)

Every zip-borne format (EPUB, CBZ, ODF, XLSX styles, PPTX) is
inflated with fflate. Nothing bounded the inflation: a hostile EPUB
of a couple of megabytes could claim — or truly contain — gigabytes,
and `lib/epub.ts` inflated the whole archive at once. Now every unzip
goes through `guardedUnzip` (`lib/safeZip.ts`), which reads the
central directory before inflating anything and refuses an archive
with too many entries (8192) or an entry claiming more than 512 MB,
skips entries claiming to expand past 200× their compressed bytes, and
holds the total to 1 GB. A caller's own filter still decides which
entries it wanted; the guard only ever shrinks that set.

### A shared file could stream forever (medium)

On Android, the copy made of a file another app shared or handed over
("Open with") was written whole, whatever arrived: a sharing app can
report any size, or none, and stream indefinitely, filling the phone's
storage before the reader could ask anything. `copyIn` now counts
bytes and cuts off past 250 MiB — the imports store's own cap — and
throws the partial copy away. A picked file that cannot be copied
still falls back to opening straight from its URI, as before.

### The Android origin check was a prefix match (low)

Every JS bridge (`__paperwrenAndroid`, `__paperwrenAndroidExtras`)
and every `evaluateJavascript` into the page is gated on
`isAppOrigin(webView.url)`. It compared with `startsWith`, so a page
at `http://localhost.attacker.tld` would have been taken for the
app's own (unreachable in practice — the app never navigates away,
and links are guarded — but it is the one gate the bridges have). The
host is now parsed and compared whole.

---

## Left as it is, on purpose

**Desktop reads the whole file system (read-only).** The fs plugin's
desktop scope is `**`, read-only, because reopening a recent from a
previous session resolves a plain path with no fresh user gesture —
the dialog runtime scope cannot cover it. The exposure is read-only by
construction, the writes (`save.rs`) go through system dialogs, and
desktop builds are internal (docs/12). An XSS would gain *read*, which
is exactly why the sanitizer above is kept current.

**`rename_file` is reachable for any document.** From a compromised
page it can rename any file of a document type to another valid
document name in the same folder — never over another file, extension
preserved. It requires the XSS that would make it interesting, and it
cannot destroy or reveal anything.

**A lying zip header can still cost a tab.** The central directory
can lie about both sizes, and fflate inflates an entry whole before
anyone can measure it, so a crafted archive can still crash the tab —
a denial of service on a file the reader chose to open, with no code
run and no data touched. True hard-capping would need a streaming
inflater that is not in fflate's API; the cap on *claimed* sizes makes
the crash the worst case.

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
  are consumed so a configuration change cannot re-import.
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

## Re-running this audit

`npm audit --omit=dev` for the dependency tree, `cargo test
--manifest-path src-tauri/Cargo.toml` for the Rust commands, and a
read of any new code that reaches `innerHTML`, `evaluateJavascript`,
`unzip`, a file path, or an `Intent`. The checks that keep the
baseline: `npm test` (the `safeZip` suite among them), `node
scripts/install-android.mjs check`, and CI's lint, build and browser
tests.
