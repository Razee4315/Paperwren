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
 * Template anchors are verified against the tauri-cli 2.11.4
 * template (scripts/fixtures/MainActivity.template.kt), with the
 * structural checks the platform lessons demand: brace balance,
 * methods inside the class body, imports present, and the
 * dry-run mode to test a template before CI runs it.
 *
 * Usage:
 *   node scripts/patch-android-openwith.mjs check   # dry-run against the fixture
 *   node scripts/patch-android-openwith.mjs apply   # patch the generated project
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "apply";

// ---------- MainActivity patch ----------

const MAINACTIVITY_IMPORTS = `import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.content.IntentCompat
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File`;

const MAINACTIVITY_METHODS = `

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
  }

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
  }

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
  }

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
  }

  private fun sanitizeName(s: String): String {
    val cleaned = s.filter { it.isLetterOrDigit() || it in " .-_()" }.trim()
    return cleaned.ifEmpty { "document" }
  }

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
        val tmp = File(imports, ".$base.$$.tmp")
        try {
          contentResolver.openInputStream(uri)?.use { input ->
            tmp.outputStream().use { output -> input.copyTo(output) }
          } ?: return
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
      // Leave the app running; the file simply does not open.
    }
  }

  private fun isAppOrigin(url: String?): Boolean {
    if (url == null) return false
    return url.startsWith("http://tauri.localhost") ||
      url.startsWith("https://tauri.localhost") ||
      url.startsWith("http://localhost") ||
      url.startsWith("http://127.0.0.1")
  }

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
  }

  private fun findWebView(): WebView? {
    val root = window?.decorView as? android.view.ViewGroup ?: return null
    return findWebViewInGroup(root)
  }

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

const MAINACTIVITY_ONCREATE_HOOK = `    handleIncomingIntent(intent)
    installBackBridge()`;

const MAINACTIVITY_ONNEWINTENT = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleIncomingIntent(intent)
  }`;

/** System Back bridge (audit section 5.3): ask the web layer first;
 * when it did not consume Back (nothing to dismiss or pop), briefly
 * disable the callback so the dispatcher performs the default
 * finish behavior instead of looping back into this callback. */
const MAINACTIVITY_BACK_METHOD = `
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

const MAINACTIVITY_FIELDS = `
  private var pendingPath: String? = null
  private var pendingName: String? = null
  private var pendingSize: Long = 0L`;

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
            <data android:mimeType="application/octet-stream" />
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
            <data android:mimeType="application/octet-stream" />
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

function patchMainActivity(original) {
	let src = original;

	if (src.includes("handleIncomingIntent")) {
		console.log("MainActivity.kt already patched.");
		return src;
	}

	// 1. Imports: add after the last import line.
	if (!/^import android\.content\.Intent$/m.test(src)) {
		const lastImport = src.lastIndexOf("\nimport ");
		if (lastImport === -1) fail("No import lines found in MainActivity.", src);
		const lineEnd = src.indexOf("\n", lastImport + 1);
		src =
			src.slice(0, lineEnd + 1) +
			MAINACTIVITY_IMPORTS +
			"\n" +
			src.slice(lineEnd + 1);
	}

	// 2. onCreate hook: inject right after super.onCreate.
	const onCreateAnchor = src.indexOf("super.onCreate(savedInstanceState)");
	if (onCreateAnchor === -1) fail("onCreate anchor missing.", src);
	const onCreateLineEnd = src.indexOf("\n", onCreateAnchor);
	src =
		src.slice(0, onCreateLineEnd + 1) +
		MAINACTIVITY_ONCREATE_HOOK +
		"\n" +
		src.slice(onCreateLineEnd + 1);

	// 3. onNewIntent + fields + methods inside the class body.
	// Compute the closing brace AFTER the insertion above so the
	// index cannot go stale.
	const classIdx = src.indexOf("class MainActivity");
	if (classIdx === -1) fail("MainActivity class not found.", src);
	const lastBrace = src.lastIndexOf("}");
	if (lastBrace < classIdx) fail("Class closing brace not found.", src);
	src =
		src.slice(0, lastBrace) +
		MAINACTIVITY_ONNEWINTENT +
		"\n" +
		MAINACTIVITY_FIELDS +
		"\n" +
		MAINACTIVITY_BACK_METHOD +
		"\n" +
		MAINACTIVITY_METHODS +
		"\n" +
		src.slice(lastBrace);

	// 4. Uri import (used in method signatures).
	if (!/^import android\.net\.Uri$/m.test(src)) {
		fail("Uri import missing after patch.", src);
	}

	// 5. Structural checks (platform lessons 1.9 and 2.10).
	if (braces(src) !== 0) fail("Brace balance broken by patch.", src);
	const bodyEnd = src.lastIndexOf("}");
	const injected = src.indexOf("private fun handleIncomingIntent");
	if (injected === -1 || injected > bodyEnd) {
		fail("Injected methods landed outside the class body.", src);
	}
	// Every override must sit inside the class body.
	const classBody = src.slice(classIdx, bodyEnd);
	if (!classBody.includes("override fun onNewIntent")) {
		fail("onNewIntent missing from the class body.", src);
	}
	if (/(^|\n)override fun/.test(src.slice(bodyEnd))) {
		fail("An override sits after the class body.", src);
	}
	// onCreate must keep its original call then our hooks, in order.
	const onCreateBody = src.slice(
		onCreateAnchor,
		src.indexOf("}", onCreateAnchor),
	);
	if (onCreateBody.indexOf("handleIncomingIntent") === -1) {
		fail("onCreate hook not adjacent to super.onCreate.", src);
	}
	if (onCreateBody.indexOf("installBackBridge") === -1) {
		fail("Back bridge hook not adjacent to super.onCreate.", src);
	}
	if (!classBody.includes("OnBackPressedCallback")) {
		fail("Back bridge callback missing from the class body.", src);
	}
	if (!classBody.includes("OpenableColumns.DISPLAY_NAME")) {
		fail("Display-name query missing from the class body.", src);
	}
	const bridgeExpression = String.raw`JSONObject.quote(path) + "," + JSONObject.quote(name) + "," + pendingSize + ") ? \"accepted\" : \"pending\""`;
	if (!src.includes(bridgeExpression)) {
		fail("Bridge expression has invalid Kotlin string quoting.", src);
	}
	return src;
}

function patchManifest(original) {
	let src = original;
	if (src.includes("android.intent.action.VIEW")) {
		console.log("AndroidManifest.xml already patched.");
		return src;
	}
	// Anchor: the end of the launcher intent filter inside the activity.
	const anchor = src.indexOf("</intent-filter>");
	if (anchor === -1) fail("No intent-filter found in manifest.", src);
	const insertAt = anchor + "</intent-filter>".length;
	src = src.slice(0, insertAt) + ACTION_VIEW_FILTER + src.slice(insertAt);
	if (braces(src) !== 0 || (src.match(/<intent-filter/g) || []).length < 2) {
		fail("Manifest patch produced unexpected structure.", src);
	}
	return src;
}

if (mode === "check") {
	const template = readFileSync(
		"scripts/fixtures/MainActivity.template.kt",
		"utf8",
	);
	const patched = patchMainActivity(template);
	if (braces(patched) !== 0) fail("Dry run left braces unbalanced.", patched);
	// The dry-run must produce a class whose overrides all sit inside
	// the class body.
	const body = patched.slice(patched.indexOf("class MainActivity"));
	const last = body.lastIndexOf("}");
	const inside = body.slice(0, last);
	if (!inside.includes("override fun onNewIntent")) {
		fail("Dry run: onNewIntent outside class.", body);
	}
	if (!inside.includes("installBackBridge")) {
		fail("Dry run: back bridge outside class.", body);
	}
	if (!inside.includes("OpenableColumns.DISPLAY_NAME")) {
		fail("Dry run: display-name query outside class.", body);
	}
	console.log("Dry run OK: patch applies cleanly to the 2.11.4 template.");
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
