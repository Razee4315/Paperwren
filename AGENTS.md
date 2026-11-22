# Rules for agents working on Paperwren

Paperwren is an offline document viewer: Tauri 2 shell, React 18 page, Android shell in Kotlin. These rules come from the performance, UI and state-machine project (`audit/px/`). Each says what to do and why. Read `docs/development.md` for commands.

## Do not run these here

- Do not run test suites, release builds or Android builds on the owner's PC. CI builds and tests. Looking at the app in the dev server is fine.
- Do not commit, push or open pull requests unless asked.
- Do not name the private reader study (kept out of git) in any tracked file. Keep personal details out of files and commits.

## Performance

- Budgets are in [PERFORMANCE.md](PERFORMANCE.md) section 2. Do not make a budgeted number worse without saying why in the commit.
- After any web build, `scripts/check-dist.mjs` must pass: no script, style or page may have `%PDF` in its first 1,024 bytes. Tauri 2.12 serves such a file as a PDF and the window stays blank. Never write the literal in source; build it from character codes.
- In components that redraw often or sit under every tab, read narrow: `useSetting`, `useSettingsOf`, `useRecentsActions`, `useIsRecent`, `useNavActions`, `useNavScreens`, `useTheme`. Not `useSettings()`, `useRecents()` or `useNav()`. One change to a whole-context value redraws every kept document.
- Do not keep a reading position in the recents list. Use `setPosition`; it writes on leaving, on `visibilitychange` or after 5 s idle.
- Release what a document holds when it closes: `v.setDocument(null)` for pdf.js, revoke object URLs in the effect that made them, end workers after their last job. A leak of 2,100 DOM nodes a round came from skipping this.
- Do not call `is_maximized` or `is_fullscreen` per resize event. Use `src/lib/settle.ts`.
- Load heavy screens and tools lazily. Check the entry chunk size when you add an import to `App.tsx` or Home.
- Do not add polling loops when an event or observer exists (`onFocusChanged`, `ResizeObserver`, `IntersectionObserver`). Share observers across list rows instead of creating one per row.
- Do not run background work while minimized, unfocused, or covered: stop file-check timers when unfocused/minimized, skip style/layout of hidden tabs and covered Home with `content-visibility: hidden`, and gate closed `Sheet`/`Dialog` children behind their open flag.
- Avoid per-frame and per-scroll allocations in hot paths (no template-string map keys, uncached `measureText`, or redundant `Date` formatting per row/cell), and run multi-megabyte hashes off the main thread via `crypto.subtle.digest`.
- Bound and clean up every cache, listener, timer, and worker on unmount or close.
- Prefer byte-range streaming (`read_file_range`) and on-demand scans or metadata parsing over loading whole files into memory on open.
- Never force synchronous style or layout (`getComputedStyle`, `scrollWidth`, `scrollIntoView`) immediately after mutating root attributes (`data-theme`, `#root[inert]`) or on initial screen mount. Measure before and after on a release build when possible, and revert any change that does not measurably help.

## State

- Never write a stored value directly. Use `createStoredValue` in `src/lib/storedValue.ts`. It gives a load gate, one write queue, one trailing write per burst, and a said failure. Direct writes lost data to races (SM-11 to SM-14).
- Every way of leaving a screen goes through the leave registry, `src/state/leave.ts`. A screen with unsaved work calls `useLeaveGuard`. Do not add a close path (shortcut, button, Back) that skips `askLeave`.
- A global key handler must check `ownsKeys(depth)` from `src/ui/Overlay.tsx` first. Otherwise a key reaches a document under a modal tool.
- An action with an awaited step needs a synchronous in-flight guard (a ref), and a disabled, `aria-busy` button. A second click must not run twice.
- Say the truth. Show "Deleted" only after the delete succeeded; on failure keep the data and show a message with Try again.
- Undo and the stored copy share one lifetime. Release managed copies in the toast's `onExpire`, not on a separate timer.

## Interface

- Use the tokens in `src/styles/global.css` (list in [docs/tokens.md](docs/tokens.md)). No raw colours, durations or easings in a module.
- Text needs 4.5:1, a control's boundary needs 3:1 (`--line-control`). Never dim text with `opacity`; use `--text-3`. Every theme (five) must define every colour token.
- Shadows: floating layers (dialogs, menus, toasts, popovers) may lift; nothing else.
- Every selected, pressed or current state needs a rule under `forced-colors: active`, or it disappears in a Windows contrast theme.
- Every control needs a visible focus ring and an accessible name. Groups of radios or buttons use `KeyboardGroups` (arrows, Home, End; RTL aware). Search fields turn spellcheck off.
- Motion rules are in [MOTION.md](MOTION.md). Animate only `transform` and `opacity`. Use `--t-instant`, `--t-fast`, `--t-med`, `--t-slow`, `--t-progress`, `--ease`, `--ease-exit`. No handler waits for an animation. Exits use `useExitPresence`; loaders use `useDelayed` (200 ms). Scripted smooth scrolling calls `scrollBehavior()` from `src/lib/motion.ts`.
- Screen entrances on a phone animate `transform` only. An opacity keyframe can freeze at 0 in Android WebView.
- The Android shell fills `--native-inset-*`; use `--safe-*`, not `env()` directly.

## Translations

- Write English in code: `t("Open file")`. Add translations in a new per-branch module, `scripts/locales/<name>.py`, with a `ROWS` list, and import it in `strings.py`. Do not edit the big table by hand. Then run `python3 scripts/make-locales.py` and format the generated files. Per-branch modules avoid merge conflicts.
- Reuse an existing string when its words fit. A unit test fails if any string is missing from any language.

## Tauri permissions

- `build.removeUnusedCommands` is on. Capabilities (`src-tauri/capabilities/desktop.json`, `mobile.json`) list exact permissions, not `core:default`. A command with no permission fails only in a packaged build.
- When you add a frontend call to a Tauri command, add its exact permission and the file and line to `docs/unused-commands.md`. Then click through the feature in a CI build.
- Window placement and first colour happen in Rust (`src-tauri/src/placement.rs`). Change the stored format there and in `src/lib/windowState.ts` together.

## Process

- Record how a flow behaves now before you change it, and add the change to [BEHAVIOR_NOTES.md](BEHAVIOR_NOTES.md) with what to confirm on which platform.
- Check changes in the dev server, and say what you could not check. Never claim a native, phone or release result you did not see.
- Measure before and after, and log it in PERFORMANCE.md section 6. Say if a number is from the dev server. Keep a change only if it helps.
- Do not rebase a pushed branch. Keep each item on its own branch.
- Follow the house style in docs and commits: plain, short sentences, explain why, no marketing words.
