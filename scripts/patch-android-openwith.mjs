/**
 * Adds the "open with" pipeline to the generated Android project
 * (docs/10 section 3): intent filters for ACTION_VIEW and
 * ACTION_SEND on the document MIME types, and a MainActivity patch
 * that ingests the incoming content:// stream asynchronously into
 * an app-private managed-imports store and hands the real path and
 * the provider's DISPLAY_NAME to the webview. Also installs the
 * system Back bridge: the web layer consumes Back when an overlay
 * or screen is open, otherwise the activity finishes.
 *
 * The MainActivity patch is PIECEWISE idempotent (docs/15 #1): an
 * activity patched by an older revision of this script — e.g. one
 * without the picker name bridge — is upgraded in place by adding
 * only the missing imports, hooks, fields, and methods, and the
 * structural validation always runs on the final file. The previous
 * revision returned early whenever `handleIncomingIntent` was
 * present, so an older patched activity silently skipped every new
 * bridge addition and all validation.
 *
 * Template anchors are verified against the tauri-cli 2.11.4
 * template (scripts/fixtures/MainActivity.template.kt), with the
 * structural checks the platform lessons demand: brace balance,
 * methods inside the class body, imports present, and the
 * dry-run mode to test a template before CI runs it.
 *
 * Usage:
 *   node scripts/patch-android-openwith.mjs check   # dry-run: clean template, upgrade of a legacy-patched activity, idempotency
 *   node scripts/patch-android-openwith.mjs apply   # patch the generated project
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "apply";

// ---------- MainActivity patch pieces ----------

const MAINACTIVITY_IMPORTS = [
	"import android.content.Intent",
	"import android.net.Uri",
	"import android.provider.OpenableColumns",
	"import android.webkit.JavascriptInterface",
	"import android.webkit.WebView",
	"import androidx.activity.OnBackPressedCallback",
	"import androidx.core.content.IntentCompat",
	"import android.os.Handler",
	"import android.os.Looper",
	"import android.widget.Toast",
	"import org.json.JSONObject",
	"import java.io.File",
];

const MAINACTIVITY_ONCREATE_HOOKS = [
	"handleIncomingIntent(intent)",
	"installBackBridge()",
	"installNameBridge(0)",
];

const BLOCK_ONNEWINTENT = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleIncomingIntent(intent)
  }`;

const BLOCK_FIELDS = `
  private var pendingPath: String? = null
  private var pendingName: String? = null
  private var pendingSize: Long = 0L`;

const BLOCK_BACK_BRIDGE = `
  /** System Back bridge (audit section 5.3): ask the web layer first;
   * when it did not consume Back (nothing to dismiss or pop), briefly
   * disable the callback so the dispatcher performs the default
   * finish behavior instead of looping back into this callback. */
  private fun installBackBridge() {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = findWebView()
        if (webView == null || !isAppOrigin(webView.url)) {
          setEnabledAndFinish()
          return
        }
        webView.evaluateJavascript(
          "window.__paperwrenHandleBack ? window.__paperwrenHandleBack() : 'false'"
        ) { result ->
          if (result == "true") return@evaluateJavascript
          setEnabledAndFinish()
        }
      }

      private fun setEnabledAndFinish() {
        isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        isEnabled = true
      }
    })
  }`;

const BLOCK_HANDLE_INCOMING = `
  private fun handleIncomingIntent(intent: Intent?) {
    if (intent == null) return
    if (intent.action != Intent.ACTION_VIEW && intent.action != Intent.ACTION_SEND) return
    val uri: Uri? = if (intent.action == Intent.ACTION_SEND) {
      IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.data
    }
    if (uri == null) return
    // Ingest off the main thread: a 250 MB scan must never freeze
    // onCreate/onNewIntent, and Back must stay responsive while the
    // copy runs (audit section 4.4).
    Thread { ingestIncomingFile(uri, intent.type) }.start()
  }`;

const BLOCK_QUERY_DISPLAY_NAME = `
  /** Provider metadata first: DISPLAY_NAME is the real file name the
   * user recognizes; the URI's last segment is only a fallback. */
  private fun queryDisplayName(uri: Uri): String {
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (idx >= 0) {
            val name = cursor.getString(idx)
            if (!name.isNullOrBlank()) return name
          }
        }
      }
    } catch (e: Exception) {
      // Fall through to the last segment.
    }
    return uri.lastPathSegment ?: "document"
  }`;

const BLOCK_QUERY_SIZE = `
  private fun querySize(uri: Uri): Long {
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val idx = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (idx >= 0 && !cursor.isNull(idx)) return cursor.getLong(idx)
        }
      }
    } catch (e: Exception) {
      // Unknown size is fine; the read reports it later.
    }
    return 0L
  }`;

const BLOCK_INBOX_NAME = `
  private fun inboxName(displayName: String, mime: String?): String {
    var name = displayName
    if (name.contains("/")) name = name.substring(name.lastIndexOf('/') + 1)
    val known = listOf("pdf", "docx", "xlsx", "pptx", "csv", "txt", "md")
    if (known.any { name.endsWith(".$it", true) }) return name
    val ext = when (mime) {
      "application/pdf" -> "pdf"
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" -> "docx"
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" -> "xlsx"
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" -> "pptx"
      "text/csv" -> "csv"
      "text/plain", "text/markdown" -> "txt"
      else -> null
    }
    return if (ext != null) "$name.$ext" else name
  }`;

const BLOCK_SANITIZE_NAME = `
  private fun sanitizeName(s: String): String {
    val cleaned = s.filter { it.isLetterOrDigit() || it in " .-_()" }.trim()
    return cleaned.ifEmpty { "document" }
  }`;

const BLOCK_INGEST = `
  /** Ingest into the managed imports store (app_data/imports): a
   * reopen-critical copy that "Clear cache" never touches. Opening
   * the same file twice dedupes by name + size instead of stacking
   * "report (1).pdf" copies (audit section 4.4 item 8). */
  private fun ingestIncomingFile(uri: Uri, mime: String?) {
    try {
      val displayName = queryDisplayName(uri)
      val imports = File(filesDir, "imports").apply { mkdirs() }
      val base = sanitizeName(inboxName(displayName, mime))
      var target = File(imports, base)
      var n = 1
      while (target.exists() && target.length() != querySize(uri)) {
        val dot = base.lastIndexOf('.')
        val candidate = if (dot > 0) base.substring(0, dot) + " ($n)" + base.substring(dot) else "$base ($n)"
        target = File(imports, candidate)
        n++
      }
      if (!target.exists() || target.length() == 0L) {
        // createTempFile is unique per call: a double-dollar suffix is
        // a literal in Kotlin string templates, NOT the pid, so two
        // concurrent ingests of the same name used to share one temp
        // path and could delete or publish each other's half-written
        // copy. The finally below only ever deletes OUR temp file.
        val tmp = File.createTempFile(".$base.", ".tmp", imports)
        try {
          contentResolver.openInputStream(uri)?.use { input ->
            tmp.outputStream().use { output -> input.copyTo(output) }
          } ?: run {
            tmp.delete()
            return
          }
          if (tmp.length() == 0L) {
            tmp.delete()
            return
          }
          if (target.exists()) target.delete()
          if (!tmp.renameTo(target)) return
        } finally {
          tmp.delete()
        }
      }
      val copiedName = target.name
      val copiedSize = target.length()
      Handler(Looper.getMainLooper()).post {
        pendingPath = target.absolutePath
        pendingName = copiedName
        pendingSize = copiedSize
        deliverPendingFile(0)
      }
    } catch (e: Exception) {
      // The file does not open, but silence reads as a broken app:
      // say so on the main looper instead of failing quietly.
      Handler(Looper.getMainLooper()).post {
        Toast.makeText(this, "Paperwren couldn't open the shared file.", Toast.LENGTH_LONG).show()
      }
    }
  }`;

const BLOCK_IS_APP_ORIGIN = `
  private fun isAppOrigin(url: String?): Boolean {
    if (url == null) return false
    return url.startsWith("http://tauri.localhost") ||
      url.startsWith("https://tauri.localhost") ||
      url.startsWith("http://localhost") ||
      url.startsWith("http://127.0.0.1")
  }`;

const BLOCK_DELIVER = `
  private fun deliverPendingFile(attempt: Int) {
    val path = pendingPath ?: return
    val name = pendingName ?: return
    if (attempt > 200) {
      // 30 seconds of retries. The imports copy remains on disk; a
      // delivery is never dropped silently before this cap.
      return
    }
    val webView = findWebView()
    if (webView == null || !isAppOrigin(webView.url)) {
      Handler(Looper.getMainLooper()).postDelayed({ deliverPendingFile(attempt + 1) }, 150)
      return
    }
    // The bridge answers accepted only when the app actually took
    // the payload. An eval that lands before the page's inline
    // script ran returns pending, and the file is retried: firing
    // into a not-yet-ready page used to lose the delivery.
    val script =
      "window.__paperwrenOpenFile(" +
        JSONObject.quote(path) + "," + JSONObject.quote(name) + "," + pendingSize + ") ? \\"accepted\\" : \\"pending\\""
    webView.evaluateJavascript(script) { result ->
      if (result == "\\"accepted\\"") {
        pendingPath = null
        pendingName = null
        pendingSize = 0L
      } else {
        Handler(Looper.getMainLooper()).postDelayed({ deliverPendingFile(attempt + 1) }, 150)
      }
    }
  }`;

const BLOCK_FIND_WEBVIEW = `
  private fun findWebView(): WebView? {
    val root = window?.decorView as? android.view.ViewGroup ?: return null
    return findWebViewInGroup(root)
  }`;

const BLOCK_FIND_WEBVIEW_IN_GROUP = `
  private fun findWebViewInGroup(group: android.view.ViewGroup): WebView? {
    for (i in 0 until group.childCount) {
      val child = group.getChildAt(i)
      if (child is WebView) return child
      if (child is android.view.ViewGroup) {
        val found = findWebViewInGroup(child)
        if (found != null) return found
      }
    }
    return null
  }`;

const BLOCK_NAME_BRIDGE = `
  /** Picker name bridge: the in-app document picker hands the web
   * layer a content:// URI whose last segment is an opaque id, so
   * the recents list would show "Document.pdf" for everything. The
   * web layer calls these @JavascriptInterface methods to ask the
   * provider for the real DISPLAY_NAME and SIZE. Retried because the
   * WebView does not exist yet when onCreate runs. */
  private fun installNameBridge(attempt: Int) {
    val webView = findWebView()
    if (webView == null || !isAppOrigin(webView.url)) {
      if (attempt < 200) {
        Handler(Looper.getMainLooper()).postDelayed({ installNameBridge(attempt + 1) }, 150)
      }
      return
    }
    // addJavascriptInterface exposes the object to EVERY frame of
    // this WebView for its lifetime, so each method re-checks the
    // page origin at call time instead of trusting install time.
    val bridge = object : Any() {
      private fun originStillOk(): Boolean = isAppOrigin(webView.url)
      @JavascriptInterface
      fun displayName(uri: String): String {
        if (!originStillOk()) return ""
        return try {
          queryDisplayName(Uri.parse(uri))
        } catch (e: Exception) {
          ""
        }
      }

      @JavascriptInterface
      fun contentSize(uri: String): Long {
        if (!originStillOk()) return 0L
        return try {
          querySize(Uri.parse(uri))
        } catch (e: Exception) {
          0L
        }
      }
    }
    webView.addJavascriptInterface(bridge, "__paperwrenAndroid")
  }`;

/** Class-body pieces in canonical order. `marker` is a string that
 * appears exactly once in a correctly patched file, so each piece is
 * added only when missing and never duplicated (docs/15 #1 step 4).
 * `upgradeWhen` names a substring present ONLY in a superseded
 * revision of the same block: when it is found in an already-patched
 * activity, the whole function is replaced in place — otherwise the
 * activity patched by an older script revision would keep its stale
 * code forever. The string must therefore never appear in the new
 * code (the dry run's idempotency check enforces this). */
const CLASS_BLOCKS = [
	{ marker: "override fun onNewIntent", code: BLOCK_ONNEWINTENT },
	{ marker: "private var pendingPath", code: BLOCK_FIELDS },
	{ marker: "private fun installBackBridge(", code: BLOCK_BACK_BRIDGE },
	{ marker: "private fun handleIncomingIntent(", code: BLOCK_HANDLE_INCOMING },
	{ marker: "private fun queryDisplayName(", code: BLOCK_QUERY_DISPLAY_NAME },
	{ marker: "private fun querySize(", code: BLOCK_QUERY_SIZE },
	{ marker: "private fun inboxName(", code: BLOCK_INBOX_NAME },
	{ marker: "private fun sanitizeName(", code: BLOCK_SANITIZE_NAME },
	{
		marker: "private fun ingestIncomingFile(",
		code: BLOCK_INGEST,
		// The old per-ingest temp path literal (double-dollar, not the
		// pid) — unique temp files replaced it. Never appears in the
		// new block's code or comments.
		upgradeWhen: ".$base.$$.tmp",
	},
	{ marker: "private fun isAppOrigin(", code: BLOCK_IS_APP_ORIGIN },
	{ marker: "private fun deliverPendingFile(", code: BLOCK_DELIVER },
	{ marker: "private fun findWebView(", code: BLOCK_FIND_WEBVIEW },
	{
		marker: "private fun findWebViewInGroup(",
		code: BLOCK_FIND_WEBVIEW_IN_GROUP,
	},
	{
		marker: "private fun installNameBridge(",
		code: BLOCK_NAME_BRIDGE,
		// The old bridge registered an inline object directly; the
		// upgraded one binds a named val and re-checks origin per call.
		upgradeWhen: '}, "__paperwrenAndroid")',
	},
];

const ACTION_VIEW_FILTER = `
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <data android:scheme="content" />
            <data android:scheme="file" />
            <data android:mimeType="application/pdf" />
            <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
            <data android:mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <data android:mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation" />
            <data android:mimeType="text/csv" />
            <data android:mimeType="text/plain" />
            <data android:mimeType="text/markdown" />
        </intent-filter>
        <intent-filter>
            <action android:name="android.intent.action.SEND" />
            <category android:name="android.intent.category.DEFAULT" />
            <data android:mimeType="application/pdf" />
            <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
            <data android:mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <data android:mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation" />
            <data android:mimeType="text/csv" />
            <data android:mimeType="text/plain" />
            <data android:mimeType="text/markdown" />
        </intent-filter>`;

const braces = (s) => {
	let n = 0;
	for (const ch of s) {
		if (ch === "{") n++;
		if (ch === "}") n--;
	}
	return n;
};

function fail(message, content) {
	console.error(`${message}\n---- file content ----\n${content}`);
	process.exit(1);
}

/** Index of the closing brace of the function whose header matches
 * `header`, or -1. Brace counting only (the generated activity has
 * no brace-bearing string literals in onCreate). */
function functionBodyEnd(src, header) {
	const start = src.indexOf(header);
	if (start === -1) return -1;
	const open = src.indexOf("{", start);
	if (open === -1) return -1;
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		if (src[i] === "{") depth++;
		else if (src[i] === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** Add every missing import; leave present ones untouched. */
function ensureImports(original, { nameBridge = true } = {}) {
	const missing = MAINACTIVITY_IMPORTS.filter(
		(imp) =>
			!(imp === "import android.webkit.JavascriptInterface" && !nameBridge) &&
			!new RegExp(`^${imp.replace(/\./g, "\\.")}$`, "m").test(original),
	);
	if (missing.length === 0) return { src: original, added: [] };
	const lastImport = original.lastIndexOf("\nimport ");
	if (lastImport === -1)
		fail("No import lines found in MainActivity.", original);
	const lineEnd = original.indexOf("\n", lastImport + 1);
	const src = `${original.slice(0, lineEnd + 1)}${missing.join("\n")}\n${original.slice(lineEnd + 1)}`;
	return { src, added: missing };
}

/** Add any missing onCreate hook line right after super.onCreate. */
function ensureOnCreateHooks(original, { nameBridge = true } = {}) {
	const anchor = original.indexOf("super.onCreate(savedInstanceState)");
	if (anchor === -1) fail("onCreate anchor missing.", original);
	const bodyEnd = functionBodyEnd(original, "override fun onCreate");
	if (bodyEnd === -1) fail("onCreate body not found.", original);
	const body = original.slice(anchor, bodyEnd);
	const missing = MAINACTIVITY_ONCREATE_HOOKS.filter(
		(hook) =>
			!(hook === "installNameBridge(0)" && !nameBridge) && !body.includes(hook),
	);
	if (missing.length === 0) return { src: original, added: [] };
	const lineEnd = original.indexOf("\n", anchor);
	const src = `${original.slice(0, lineEnd + 1)}${missing.map((hook) => `    ${hook}`).join("\n")}\n${original.slice(lineEnd + 1)}`;
	return { src, added: missing };
}

/** Replace the body of the function starting at `block.marker` with
 * the block's current code, keeping everything around it intact. */
function upgradeClassBlock(src, block) {
	const start = src.indexOf(block.marker);
	if (start === -1)
		fail(`Upgradable block marker missing: ${block.marker}`, src);
	const end = functionBodyEnd(src, block.marker);
	if (end === -1) fail(`Upgradable block body not found: ${block.marker}`, src);
	return `${src.slice(0, start)}${block.code}${src.slice(end + 1)}`;
}

/** Add each missing class-body piece before the class's closing
 * brace, in canonical order, never duplicating a present one. A
 * piece whose `upgradeWhen` signature is found replaces the stale
 * revision of itself in place. */
function ensureClassBlocks(original, { nameBridge = true } = {}) {
	const classIdx = original.indexOf("class MainActivity");
	if (classIdx === -1) fail("MainActivity class not found.", original);
	const added = [];
	let src = original;
	for (const block of CLASS_BLOCKS) {
		if (block.marker === "private fun installNameBridge(" && !nameBridge) {
			continue;
		}
		if (src.includes(block.marker)) {
			if (block.upgradeWhen && src.includes(block.upgradeWhen)) {
				src = upgradeClassBlock(src, block);
				added.push(`${block.marker} upgraded`);
			}
			continue;
		}
		const lastBrace = src.lastIndexOf("}");
		if (lastBrace < classIdx) fail("Class closing brace not found.", src);
		src = `${src.slice(0, lastBrace)}\n${block.code}\n${src.slice(lastBrace)}`;
		added.push(block.marker);
	}
	return { src, added };
}

/** Structural validation of the final activity. Runs on every patch
 * (fresh, upgraded, or already current) so an older patched file can
 * no longer skip the checks (docs/15 #1 step 4). */
function validatePatched(src, { nameBridge = true } = {}) {
	if (braces(src) !== 0) fail("Brace balance broken by patch.", src);
	for (const imp of MAINACTIVITY_IMPORTS) {
		if (imp === "import android.webkit.JavascriptInterface" && !nameBridge) {
			continue;
		}
		if (!new RegExp(`^${imp.replace(/\./g, "\\.")}$`, "m").test(src)) {
			fail(`Import missing after patch: ${imp}`, src);
		}
	}
	const classIdx = src.indexOf("class MainActivity");
	const bodyEnd = src.lastIndexOf("}");
	const injected = src.indexOf("private fun handleIncomingIntent(");
	if (injected === -1 || injected > bodyEnd) {
		fail("Injected methods landed outside the class body.", src);
	}
	const classBody = src.slice(classIdx, bodyEnd);
	if (!classBody.includes("override fun onNewIntent")) {
		fail("onNewIntent missing from the class body.", src);
	}
	if (/(^|\n)override fun/.test(src.slice(bodyEnd))) {
		fail("An override sits after the class body.", src);
	}
	// onCreate must keep its original call then our hooks, in order.
	const onCreateAnchor = src.indexOf("super.onCreate(savedInstanceState)");
	const onCreateEnd = functionBodyEnd(src, "override fun onCreate");
	const onCreateBody = src.slice(onCreateAnchor, onCreateEnd);
	for (const hook of MAINACTIVITY_ONCREATE_HOOKS) {
		if (hook === "installNameBridge(0)" && !nameBridge) continue;
		if (onCreateBody.indexOf(hook) === -1) {
			fail(`onCreate hook missing: ${hook}`, src);
		}
	}
	if (!classBody.includes("OnBackPressedCallback")) {
		fail("Back bridge callback missing from the class body.", src);
	}
	if (!classBody.includes("OpenableColumns.DISPLAY_NAME")) {
		fail("Display-name query missing from the class body.", src);
	}
	if (nameBridge && !classBody.includes("__paperwrenAndroid")) {
		fail("Picker name bridge missing from the class body.", src);
	}
	const bridgeExpression = String.raw`JSONObject.quote(path) + "," + JSONObject.quote(name) + "," + pendingSize + ") ? \"accepted\" : \"pending\""`;
	if (!src.includes(bridgeExpression)) {
		fail("Bridge expression has invalid Kotlin string quoting.", src);
	}
}

function patchMainActivity(original, { nameBridge = true } = {}) {
	// PIECEWISE, not all-or-nothing (docs/15 #1): the previous
	// revision returned early on any activity already containing
	// handleIncomingIntent, so an older patched file skipped new
	// bridge additions and validation forever.
	const imports = ensureImports(original, { nameBridge });
	let src = imports.src;
	const hooks = ensureOnCreateHooks(src, { nameBridge });
	src = hooks.src;
	const blocks = ensureClassBlocks(src, { nameBridge });
	src = blocks.src;
	validatePatched(src, { nameBridge });
	const added = imports.added.length + hooks.added.length + blocks.added.length;
	if (added === 0) {
		console.log("MainActivity.kt already fully patched; validation passed.");
	} else {
		console.log(
			`MainActivity.kt patched: +${imports.added.length} imports, ` +
				`+${hooks.added.length} onCreate hooks, +${blocks.added.length} class pieces ` +
				`(${blocks.added.join(", ") || "none"}); validation passed.`,
		);
	}
	return src;
}

function patchManifest(original) {
	let src = original;
	if (src.includes("android.intent.action.VIEW")) {
		console.log(
			"AndroidManifest.xml already patched; checking intent filters.",
		);
	} else {
		// Anchor: the end of the launcher intent filter inside the activity.
		const anchor = src.indexOf("</intent-filter>");
		if (anchor === -1) fail("No intent-filter found in manifest.", src);
		const insertAt = anchor + "</intent-filter>".length;
		src = src.slice(0, insertAt) + ACTION_VIEW_FILTER + src.slice(insertAt);
		if (braces(src) !== 0 || (src.match(/<intent-filter/g) || []).length < 2) {
			fail("Manifest patch produced unexpected structure.", src);
		}
	}
	// Upgrade, applied to fresh and existing patches alike:
	// application/octet-stream made Paperwren a candidate in every
	// "Open with" sheet on the device (APKs, archives, anything
	// binary), each ending in the unsupported dialog. Properly typed
	// documents reach the app through their MIME types.
	if (src.includes("application/octet-stream")) {
		src = src
			.split("\n")
			.filter((line) => !line.includes("application/octet-stream"))
			.join("\n");
		console.log("Removed application/octet-stream from the intent filters.");
	}
	return src;
}

function countOccurrences(src, needle) {
	let n = 0;
	let i = src.indexOf(needle);
	while (i !== -1) {
		n++;
		i = src.indexOf(needle, i + needle.length);
	}
	return n;
}

if (mode === "check") {
	const template = readFileSync(
		"scripts/fixtures/MainActivity.template.kt",
		"utf8",
	);

	// 1. Clean template: full patch applies and validates.
	const patched = patchMainActivity(template);

	// 2. Idempotency: patching the output again adds nothing.
	if (patchMainActivity(patched) !== patched) {
		fail("Dry run: re-patching the output was not a no-op.", patched);
	}
	console.log("Dry run OK: patch is idempotent on its own output.");

	// 3. Upgrade: an activity patched by the pre-name-bridge revision
	// (0.9.16/0.9.17 era — open-with pipeline present, name bridge
	// absent) gains exactly the missing pieces, with no duplication.
	const legacy = patchMainActivity(template, { nameBridge: false });
	if (legacy.includes("__paperwrenAndroid")) {
		fail("Legacy simulation unexpectedly contains the name bridge.", legacy);
	}
	const upgraded = patchMainActivity(legacy);
	for (const marker of [
		"__paperwrenAndroid",
		"private fun installNameBridge(",
		"import android.webkit.JavascriptInterface",
	]) {
		if (!upgraded.includes(marker)) {
			fail(`Upgrade did not add: ${marker}`, upgraded);
		}
	}
	for (const method of [
		"private fun ingestIncomingFile(",
		"private fun installNameBridge(",
		"override fun onNewIntent",
		"private fun installBackBridge(",
	]) {
		const n = countOccurrences(upgraded, method);
		if (n !== 1) {
			fail(`Upgrade produced ${n} copies of ${method}`, upgraded);
		}
	}
	console.log(
		"Dry run OK: clean patch, idempotent re-patch, and legacy-activity upgrade all pass.",
	);

	// 4. Revision upgrades: an activity patched by the PREVIOUS
	// revision of this script (shared temp path, install-time-only
	// bridge origin check) is upgraded in place to the current code,
	// once, with no duplication, and stays idempotent afterwards.
	if (patchMainActivity(upgraded) !== upgraded) {
		fail(
			"Dry run: re-patching the upgraded activity was not a no-op.",
			upgraded,
		);
	}
	console.log("Dry run OK: upgraded activity is stable under re-patch.");

	// 5. Stale-revision upgrade: an activity carrying the PREVIOUS
	// revision's ingest/bridge code (shared temp path, inline bridge
	// registration) is rewritten in place, exactly once, and is
	// idempotent afterwards.
	const stale = upgraded
		.replace(
			'File.createTempFile(".$base.", ".tmp", imports)',
			// Replacement function: "$$" inside a plain replacement
			// string would collapse to "$" and the stale marker would
			// never match.
			() => 'File(imports, ".$base.$$.tmp")',
		)
		// Faithfully reconstruct the old bridge shape: registration
		// inline in the call, no local binding, no per-call origin
		// re-check.
		.replace(
			/\/\/ addJavascriptInterface exposes[\s\S]*?webView\.addJavascriptInterface\(bridge, "__paperwrenAndroid"\)/,
			`    webView.addJavascriptInterface(object : Any() {
      @JavascriptInterface
      fun displayName(uri: String): String {
        return try {
          queryDisplayName(Uri.parse(uri))
        } catch (e: Exception) {
          ""
        }
      }

      @JavascriptInterface
      fun contentSize(uri: String): Long {
        return try {
          querySize(Uri.parse(uri))
        } catch (e: Exception) {
          0L
        }
      }
    }, "__paperwrenAndroid")`,
		);
	if (stale === upgraded) {
		fail("Dry run: stale-revision simulation did not change the file.", stale);
	}
	const reupgraded = patchMainActivity(stale);
	if (reupgraded.includes(".$base.$$.tmp")) {
		fail("Revision upgrade kept the shared temp file path.", reupgraded);
	}
	if (!reupgraded.includes("File.createTempFile")) {
		fail("Revision upgrade lost the unique temp file.", reupgraded);
	}
	if (reupgraded.includes('}, "__paperwrenAndroid")')) {
		fail("Revision upgrade kept the inline bridge registration.", reupgraded);
	}
	for (const method of [
		"private fun ingestIncomingFile(",
		"private fun installNameBridge(",
	]) {
		const n = countOccurrences(reupgraded, method);
		if (n !== 1) {
			fail(`Revision upgrade produced ${n} copies of ${method}`, reupgraded);
		}
	}
	if (patchMainActivity(reupgraded) !== reupgraded) {
		fail("Dry run: revision-upgraded activity is not idempotent.", reupgraded);
	}
	console.log(
		"Dry run OK: stale-revision activity upgrades in place and stays idempotent.",
	);
	process.exit(0);
}

// apply
const manifestPath = "src-tauri/gen/android/app/src/main/AndroidManifest.xml";
const activityPath =
	"src-tauri/gen/android/app/src/main/java/app/paperwren/docs/MainActivity.kt";

if (!existsSync(manifestPath) || !existsSync(activityPath)) {
	console.error(
		"Generated Android project not found. Run `tauri android init` first.",
	);
	process.exit(1);
}

writeFileSync(manifestPath, patchManifest(readFileSync(manifestPath, "utf8")));
writeFileSync(
	activityPath,
	patchMainActivity(readFileSync(activityPath, "utf8")),
);
console.log("Open-with pipeline patched into manifest and MainActivity.");
