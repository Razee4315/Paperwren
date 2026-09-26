package app.paperwren.docs

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.IntentCompat
import org.json.JSONObject
import java.io.File
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.concurrent.Executors

/**
 * Paperwren's only native code. It does three small jobs and keeps
 * everything else in the web layer:
 *
 * 1. "Open with" / "Share": copy the incoming content:// stream into
 *    app-private storage (filesDir/imports/<hash>/<name>) and hand the
 *    path to the web layer. Copies are named after a SHA-256 of their
 *    bytes, so the same file opened twice is stored once and two
 *    different files with the same name never collide.
 * 2. System Back: ask the web layer first; finish only when it did
 *    not consume the press.
 * 3. A tiny JS bridge for the in-app picker: the provider's real
 *    display name and size, and a best-effort persistable grant so
 *    recents can reopen after a restart.
 *
 * This file is copied verbatim over the generated activity by
 * scripts/install-android.mjs. Keep it self-contained.
 */
class MainActivity : TauriActivity() {
  private val main = Handler(Looper.getMainLooper())
  /** One ingest at a time: serial copies make hash dedupe race-free. */
  private val ingestExecutor = Executors.newSingleThreadExecutor()
  /** Files ingested but not yet accepted by the web layer. */
  private val pending = ArrayDeque<Delivery>()
  private var delivering = false

  private data class Delivery(val path: String, val name: String, val size: Long)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    installBackBridge()
    installJsBridge(0)
    handleIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleIntent(intent)
  }

  override fun onDestroy() {
    ingestExecutor.shutdown()
    super.onDestroy()
  }

  // ---------- Open with / Share ----------

  private fun handleIntent(intent: Intent?) {
    if (intent == null) return
    val uris: List<Uri> = when (intent.action) {
      Intent.ACTION_VIEW -> listOfNotNull(intent.data)
      Intent.ACTION_SEND -> listOfNotNull(
        IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
      )
      Intent.ACTION_SEND_MULTIPLE ->
        IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
          ?.toList() ?: emptyList()
      else -> emptyList()
    }
    // Consume the intent so a configuration change does not re-import it.
    intent.action = null
    for (uri in uris) {
      val mime = intent.type
      ingestExecutor.execute { ingest(uri, mime) }
    }
  }

  private fun ingest(uri: Uri, mime: String?) {
    try {
      val displayName = withExtension(queryDisplayName(uri), mime)
      val imports = File(filesDir, "imports").apply { mkdirs() }
      val tmp = File.createTempFile(".incoming.", ".tmp", imports)
      val digest = MessageDigest.getInstance("SHA-256")
      try {
        val input = contentResolver.openInputStream(uri) ?: throw IllegalStateException("no stream")
        DigestInputStream(input, digest).use { stream ->
          tmp.outputStream().use { out -> stream.copyTo(out, 64 * 1024) }
        }
        if (tmp.length() == 0L) throw IllegalStateException("empty file")
        val hash = digest.digest().joinToString("") { "%02x".format(it) }.take(16)
        val folder = File(imports, hash).apply { mkdirs() }
        val target = File(folder, safeFileName(displayName))
        if (target.exists() && target.length() == tmp.length()) {
          target.setLastModified(System.currentTimeMillis())
        } else if (!tmp.renameTo(target)) {
          throw IllegalStateException("rename failed")
        }
        val delivery = Delivery(target.absolutePath, displayName, target.length())
        main.post {
          pending.addLast(delivery)
          deliverNext(0)
        }
      } finally {
        tmp.delete()
      }
    } catch (e: Exception) {
      main.post {
        Toast.makeText(this, "Paperwren couldn't open that file.", Toast.LENGTH_LONG).show()
      }
    }
  }

  /** Hand queued files to the web layer one at a time. The page's
   * inline bridge answers true once it has queued the payload; until
   * the page is ready the delivery is retried (up to ~30 s). */
  private fun deliverNext(attempt: Int) {
    if (delivering && attempt == 0) return
    val next = pending.peekFirst() ?: run { delivering = false; return }
    delivering = true
    if (attempt > 200) {
      pending.pollFirst()
      delivering = false
      deliverNext(0)
      return
    }
    val webView = findWebView()
    if (webView == null || !isAppOrigin(webView.url)) {
      main.postDelayed({ deliverNext(attempt + 1) }, 150)
      return
    }
    val script = "(window.__paperwrenOpenFile && window.__paperwrenOpenFile(" +
      JSONObject.quote(next.path) + "," + JSONObject.quote(next.name) + "," + next.size +
      ")) ? 'ok' : 'wait'"
    webView.evaluateJavascript(script) { result ->
      if (result == "\"ok\"") {
        pending.pollFirst()
        delivering = false
        deliverNext(0)
      } else {
        main.postDelayed({ deliverNext(attempt + 1) }, 150)
      }
    }
  }

  // ---------- Provider metadata ----------

  private fun queryDisplayName(uri: Uri): String {
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (i >= 0) {
            val name = c.getString(i)
            if (!name.isNullOrBlank()) return name
          }
        }
      }
    } catch (e: Exception) {
      // Fall back to the last URI segment.
    }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "document"
  }

  private fun querySize(uri: Uri): Long {
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val i = c.getColumnIndex(OpenableColumns.SIZE)
          if (i >= 0 && !c.isNull(i)) return c.getLong(i)
        }
      }
    } catch (e: Exception) {
      // Unknown size is fine; the read reports the real length.
    }
    return 0L
  }

  private fun withExtension(name: String, mime: String?): String {
    if (name.substringAfterLast('.', "").length in 1..5) return name
    val ext = when (mime) {
      "application/pdf" -> "pdf"
      "application/msword" -> "doc"
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" -> "docx"
      "application/vnd.ms-excel" -> "xls"
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" -> "xlsx"
      "application/vnd.ms-powerpoint" -> "ppt"
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" -> "pptx"
      "application/vnd.oasis.opendocument.text" -> "odt"
      "application/vnd.oasis.opendocument.spreadsheet" -> "ods"
      "application/vnd.oasis.opendocument.presentation" -> "odp"
      "application/rtf", "text/rtf" -> "rtf"
      "text/csv", "text/comma-separated-values" -> "csv"
      "text/tab-separated-values" -> "tsv"
      "text/markdown" -> "md"
      "text/plain" -> "txt"
      else -> null
    }
    return if (ext != null) "$name.$ext" else name
  }

  private fun safeFileName(name: String): String {
    val cleaned = name.substringAfterLast('/')
      .filter { it.isLetterOrDigit() || it in " .-_()[]," }
      .trim()
      .trimStart('.')
      .take(120)
    return cleaned.ifEmpty { "document" }
  }

  // ---------- System Back ----------

  private fun installBackBridge() {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = findWebView()
        if (webView == null || !isAppOrigin(webView.url)) {
          finishFromBack()
          return
        }
        webView.evaluateJavascript(
          "window.__paperwrenHandleBack ? window.__paperwrenHandleBack() : false"
        ) { result ->
          if (result != "true") finishFromBack()
        }
      }

      private fun finishFromBack() {
        isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        isEnabled = true
      }
    })
  }

  // ---------- Picker bridge ----------

  /** Retried because the WebView is created after onCreate returns. */
  private fun installJsBridge(attempt: Int) {
    val webView = findWebView()
    if (webView == null || !isAppOrigin(webView.url)) {
      if (attempt < 200) main.postDelayed({ installJsBridge(attempt + 1) }, 150)
      return
    }
    // addJavascriptInterface is visible to every frame for the
    // WebView's lifetime, so each call re-checks the page origin.
    val bridge = object : Any() {
      private fun allowed(uri: String): Boolean =
        isAppOrigin(webView.url) && uri.startsWith("content://")

      @JavascriptInterface
      fun displayName(uri: String): String =
        if (!allowed(uri)) "" else try { queryDisplayName(Uri.parse(uri)) } catch (e: Exception) { "" }

      @JavascriptInterface
      fun contentSize(uri: String): Long =
        if (!allowed(uri)) 0L else try { querySize(Uri.parse(uri)) } catch (e: Exception) { 0L }

      /** Keep read access across restarts when the provider allows it. */
      @JavascriptInterface
      fun persist(uri: String): Boolean {
        if (!allowed(uri)) return false
        return try {
          contentResolver.takePersistableUriPermission(
            Uri.parse(uri),
            Intent.FLAG_GRANT_READ_URI_PERMISSION
          )
          true
        } catch (e: Exception) {
          false
        }
      }
    }
    webView.addJavascriptInterface(bridge, "__paperwrenAndroid")
  }

  // ---------- Helpers ----------

  private fun isAppOrigin(url: String?): Boolean {
    if (url == null) return false
    return url.startsWith("http://tauri.localhost") ||
      url.startsWith("https://tauri.localhost") ||
      url.startsWith("http://localhost") ||
      url.startsWith("http://127.0.0.1")
  }

  private fun findWebView(): WebView? {
    val root = window?.decorView as? android.view.ViewGroup ?: return null
    return findWebViewIn(root)
  }

  private fun findWebViewIn(group: android.view.ViewGroup): WebView? {
    for (i in 0 until group.childCount) {
      val child = group.getChildAt(i)
      if (child is WebView) return child
      if (child is android.view.ViewGroup) findWebViewIn(child)?.let { return it }
    }
    return null
  }
}
