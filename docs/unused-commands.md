# Unused Tauri commands (plan D)

`src-tauri/tauri.conf.json` enables `build.removeUnusedCommands`. The installed
CLI schema (2.12.0) and locked Rust sources (Tauri 2.12.5, tauri-build 2.7.4,
tauri-plugin 2.7.2) support it. See the official
[size guide](https://v2.tauri.app/concept/size/#remove-unused-commands) and
[configuration reference](https://v2.tauri.app/reference/config/#buildconfig).
The CLI activates command filtering during a production build; plain Cargo does
not activate it just by reading this setting.

Inventory below refers to the source at this commit. Only capabilities, the
shared build configuration and this document change. Platform overlays
`tauri.windows.conf.json`, `tauri.macos.conf.json` and `tauri.android.conf.json`
do not replace the shared build setting or capabilities. There are exactly two
capability files: desktop (Windows/macOS/Linux) and mobile (Android/iOS), both
limited to the `main` window. Desktop keeps its existing shared platform coverage;
permissions used on one desktop OS are not newly granted to another capability.

## Desktop permission mapping

Prefixes in the table are literal permission prefixes; each comma-separated
suffix is a separate permission with that prefix. Explicit file scopes stay
`**` and `**/*`, supporting previous-session recents, file drops and adjacent
pictures. No command or path access is added.

| Before in `capabilities/desktop.json` | After | Use (file:line) |
| --- | --- | --- |
| `core:default` | `core:event:allow-listen`, `core:event:allow-unlisten` | `src/lib/backend.ts:1077` open-file handoff; `src/lib/backend.ts:974` native drop listeners; `src/lib/windowState.ts:106` resize/move subscriptions; `src/lib/fullscreen.ts:336` fullscreen follow; `src/ui/WindowControls.tsx:40` resize subscription. SDK event helpers use these commands for subscription and cleanup. |
| `core:default` | `core:window:allow-inner-size`, `core:window:allow-outer-position` | `src/lib/windowState.ts:65` and `:66`, persist normal window bounds. |
| `core:default` | `core:window:allow-is-fullscreen`, `core:window:allow-is-minimized`, `core:window:allow-is-maximized` | `src/lib/windowState.ts:92`, `:91`, `:95`; `src/lib/fullscreen.ts:59` and `:327`; `src/ui/WindowControls.tsx:36`. |
| `core:default` | `core:window:allow-internal-toggle-maximize` | Double-click a `data-tauri-drag-region`, e.g. `src/screens/home/Home.tsx:331`, `src/screens/TabStrip.tsx:256`, `src/screens/viewer/Shell.tsx:1014`. Injected Tauri 2.12.5 `src/window/scripts/drag.js:103,124` uses this distinct command. |
| `core:default` | `core:menu:allow-new` | `src/lib/macMenu.ts:60` predefined items, `:63` menu items, `:72` submenus, `:155` menu. SDK constructors use `plugin:menu\|new`, including inline item arrays; they do not call append/insert. |
| `core:default` | `core:menu:allow-set-enabled` | `src/lib/macMenu.ts:145`, document-dependent menu state. |
| `core:default` | `core:menu:allow-set-as-app-menu` | `src/lib/macMenu.ts:156`. |
| `core:default` | `core:menu:allow-set-as-windows-menu-for-nsapp` | `src/lib/macMenu.ts:157`. |
| `core:default` | `core:resources:allow-close` | `src/lib/macMenu.ts:155,161`, menu replacement/obsolete menu cleanup through SDK `Resource.close()`. |
| `core:window:allow-set-title` | unchanged | `src/lib/backend.ts:936`, document title. |
| `core:window:allow-minimize` | unchanged | `src/ui/WindowControls.tsx:62` via dispatcher at `:13`. |
| `core:window:allow-toggle-maximize` | unchanged | `src/ui/WindowControls.tsx:71` via dispatcher at `:13`; maximize AND restore button. |
| `core:window:allow-close` | unchanged | `src/ui/WindowControls.tsx:85`; `src/lib/macMenu.ts:50` closes window when Cmd+W has no document to close. |
| `core:window:allow-start-dragging` | unchanged | Same drag regions above; Tauri's injected drag helper `drag.js:103`. |
| `core:window:allow-maximize`, `core:window:allow-set-size`, `core:window:allow-set-position` | removed | Restoration now directly calls Rust window methods in `src-tauri/src/placement.rs:118`. No frontend maximize/unmaximize/setSize/setPosition calls remain. Native menu Zoom is a predefined native action, not window IPC. |
| `core:window:allow-set-fullscreen` | unchanged | `src/lib/fullscreen.ts:59,62`, reading and slideshow fullscreen. |
| `core:window:allow-set-background-color` | unchanged | `src/lib/windowBackground.ts:47`, Windows theme changes. |
| `core:webview:allow-print` | unchanged | `src/lib/print.ts:145`, `window.print()`; Tauri's macOS `src/webview/scripts/print.js:6` invokes the command. |
| `dialog:allow-open` | unchanged | `src/lib/backend.ts:943,957,1012`, document/picture/multiple-file/folder picker. |
| `updater:default` | `updater:allow-check`, `updater:allow-download-and-install` | `src/lib/updates.ts:50,92`. SDK `downloadAndInstall` invokes the combined command directly; separate download/install are unused. |
| `process:allow-restart` | unchanged | `src/lib/updates.ts:80`, relaunch after installing. |
| scoped `fs:default` | scoped `fs:allow-read-file` with identical explicit allow paths | `src/lib/backend.ts:1255`, document bytes. Removes mkdir and unused read/open/seek/watch/etc. commands plus implicit grants to app directories. |
| `fs:default` nested deny rules | `fs:deny-webview-data-linux`, `fs:deny-webview-data-windows` | Security invariants, retained verbatim from `deny-default`; protect Linux WebKit data and Windows EBWebView data. These are scope-only denies, not command grants. |
| scoped `fs:allow-stat` | unchanged, same paths | `src/lib/backend.ts:923,1266`, file size and modification date. |
| scoped `fs:allow-read-dir` | unchanged, same paths | `src/lib/backend.ts:1098`, adjacent-picture navigation. Folder browsing primarily uses the custom `list_folder` command. |

All other command grants inherited through `core:default` are removed, including
path, app, image, tray and unused window/webview/menu/event commands. Neither
frontend path API imports nor opener plugin calls exist. `getCurrentWindow()` and
`getCurrentWebview()` use injected metadata; they need no get-all command.
Channels used by menu actions/updater progress use Tauri's always-retained channel
handler and require no added capability.

## Mobile permission mapping

| Before in `capabilities/mobile.json` | After | Use (file:line) |
| --- | --- | --- |
| `core:default` | `core:event:allow-listen`, `core:event:allow-unlisten` | `src/lib/backend.ts:1077,1080,1086` non-Android fallback handoff and cleanup; native drop helper at `:974`. Kept conservatively: Android normally takes the intent bridge and skips the open-file listener, but the same capability covers iOS and fallback branches. |
| `dialog:allow-open` | unchanged | `src/lib/backend.ts:943,957,1012`, fallback system pickers when the Android bridge is unavailable, also iOS. |
| scoped `fs:default` | scoped `fs:allow-read-file` | `src/lib/backend.ts:1255`; explicit paths remain `content://**`, `$APPDATA/imports/**`, `$APPDATA/imports/*`. Implicit default access to other app directories and mkdir/read helpers is removed. |
| `fs:default` nested deny rules | `fs:deny-webview-data-linux`, `fs:deny-webview-data-windows` | Preserve inherited denies exactly; platform restrictions make them inert on Android/iOS. |

All other inherited core grants are removed. No updater/process plugins are
registered on mobile. Android's picker, folder, print, save and other extras use
the existing native JavaScript bridge rather than Tauri plugin commands. Mobile
never had set-title/stat/read-dir grants; none are added for dormant fallback
calls. Native mobile bridge and platform configuration are untouched.

## Custom commands and direct Rust calls

The 14 app commands registered at `src-tauri/src/lib.rs:390` stay exactly as
before. There is no app ACL manifest; Tauri 2.7.4 macro code explicitly keeps all
app handlers when no app manifest exists. No build.rs change is needed.

| Registered command | Frontend call |
| --- | --- |
| `store_get`, `store_set` | `src/lib/backend.ts:1271,1272` |
| `imports_stats`, `imports_clear`, `imports_remove`, `imports_prune` | `src/lib/backend.ts:1273,1274,1276,1279` |
| `list_folder` | `src/lib/backend.ts:856` |
| `launch_files` | `src/lib/backend.ts:1062` |
| `open_external`, `reveal_in_folder` | `src/lib/backend.ts:1165,1168` |
| `rename_file`, `save_as` | `src/lib/backend.ts:1210,1195` |
| `trace_enabled`, `trace_mark` | `src/lib/trace.ts:22,40` |

Rust registers dialog/fs and, on desktop, single-instance/updater/process at
`src-tauri/src/lib.rs:361-370`. Single-instance has no frontend commands.
`save_as` uses `app.dialog().file().blocking_save_file()` (`lib.rs:322,327`),
so frontend `dialog:allow-save` is unnecessary. Rust uses ordinary filesystem
operations for storage/imports/folder/save, not plugin-fs IPC. `hand_over`
(`lib.rs:198`) emits from Rust and directly unminimizes/shows/focuses the window;
no frontend emit/unminimize/show/focus grants are needed. `placement.rs:92-181`
directly reads monitors/theme, sets position/size/background, centers/maximizes
and shows the window. Pruning IPC wrappers does not remove these Rust APIs.

## Validation and release gate

Permission expansion against the installed ACL manifest gives **117 -> 28**
allowed plugin/core commands for desktop and **100 -> 4** for mobile (excluding
the unchanged app handlers). Each resulting command set is a subset of its
original; explicit file allow scopes and inherited deny scopes are preserved.
These are command counts, not binary measurements.

Passed one `cargo check --manifest-path src-tauri/Cargo.toml` with
a shared `CARGO_TARGET_DIR`
and `REMOVE_UNUSED_COMMANDS` pointing to this worktree's absolute `src-tauri`
directory. The latter is Tauri's documented internal CLI switch, used only in
the checking process to exercise filtering too. No persistent environment or
build-script override is introduced. The check completed successfully in 31.57 s,
regenerated the desktop ACL/schema, and reported removal of unused core, fs,
dialog, updater and process handlers. Mobile JSON permission identifiers also
resolve against the generated manifests; Android itself was not compiled.

No app/release build, automated tests, installed-app launch, native dialogs or
Android compilation are run here, per the owner. A web preview cannot validate
native ACLs and is not useful for this configuration-only change. The lead must
compare like-for-like CI release sizes and retain D only if the saving is at
least **300 KB**, per the approved plan. Size impact is currently unmeasured.

A missed permission can appear only in a packaged app. Click through on the
pruned CI build and check for denied-command errors:

- Windows: minimize, maximize/restore repeatedly, close; drag each title bar and
  double-click it. Change themes and resize with no unpainted background.
- Every desktop: move/resize, close/reopen, restore maximized and normal bounds,
  and restart after disconnecting a monitor. Enter/exit fullscreen from normal
  and maximized state using F11/buttons/Escape; enter/exit slideshow fullscreen.
- Desktop: open one/multiple documents and pictures through the picker, drop
  files, navigate adjacent pictures, browse a folder and reopen old recents
  after restart. Confirm metadata and changed-file detection still work.
- Desktop: open a file while closed, then open another through a second launch
  or Finder while running. Confirm handoff brings the existing window forward.
- macOS: native menu creation/actions, document-dependent enabled state, switch
  language to rebuild the menu, Cmd+W with/without a document, Window menu Zoom,
  green-button fullscreen and print sheet; print on Windows/Linux as well.
- Supported desktop updater builds: check with no update and an available
  update, download/install with progress, then restart. Check failure/retry too.
- Every platform: settings/recents/notes persist; imported-copy stats, remove,
  prune and clear work; with PAPERWREN_TRACE enabled, milestones still arrive.
- Every desktop: save a tool-created copy, cancel saving, rename, open in default
  app and reveal in folder. These exercise preserved custom commands.
- Android phone: picker single/multiple/picture, open-with content URI and
  managed copy, reopen after restart, browse a tree, save/share/rename/print via
  the bridge. Confirm no new file access beyond picked/import paths. iOS, if
  shipped: fallback picker and file reading/event cleanup need device coverage.

Conservative keeps: mobile listen/unlisten and dialog open cover bridge-absent
and iOS fallback behavior; WebView deny permissions remain even where inert.
No other uncertain command is dropped on an assumption about framework internals.
