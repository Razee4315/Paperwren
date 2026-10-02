package app.paperwren.docs

import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Paperwren's only native code. It does a few small jobs and keeps
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
 *    display name and size, and a copy of the picked file into the
 *    same imports store so recents can reopen after a restart.
 * 4. Hand-offs the web layer cannot do: share a file, open it in
 *    another app, print (the page, or a PDF itself), keep the screen
 *    on while reading, and browse a folder the user picked. None of
 *    these needs a manifest permission: sharing goes through a
 *    FileProvider grant, folders through the Storage Access Framework.
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

  /** Folder scans can be long; they must not hold up file imports. */
  private val scanExecutor = Executors.newSingleThreadExecutor()
  /** The web layer's token for the folder pick in flight, if any. */
  private var folderToken: String? = null
  /** Must be registered before the activity starts, hence a field. */
  private val folderPicker =
    registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
      val token = folderToken
      folderToken = null
      if (token != null) {
        var result = "null"
        if (uri != null) {
          try {
            // Keep reading this folder after the app restarts.
            contentResolver.takePersistableUriPermission(
              uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
            val root = DocumentsContract.buildDocumentUriUsingTree(
              uri, DocumentsContract.getTreeDocumentId(uri)
            )
            result = JSONObject()
              .put("uri", uri.toString())
              .put("name", queryDisplayName(root))
              .toString()
          } catch (e: Exception) {
            result = "null"
          }
        }
        callWeb("__paperwrenFolder", JSONObject.quote(token) + "," + result)
      }
    }

  /** Our Back bridge owns system Back; Wry's default would only walk
   * WebView history (and, registered later, would win over ours). */
  override val handleBackNavigation: Boolean = false
  private var bridgeInstalled = false

  /** Called by Wry when the WebView exists but before the page loads.
   * addJavascriptInterface only becomes visible to JavaScript on the
   * NEXT page load, so installing it here (not after load) is what
   * makes window.__paperwrenAndroid available to the app at all. */
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    addJsBridge(webView)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    installBackBridge()
    handleIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleIntent(intent)
  }

  override fun onDestroy() {
    ingestExecutor.shutdown()
    scanExecutor.shutdown()
    super.onDestroy()
  }

  // ---------- Hand-offs: share, open elsewhere, print ----------

  /** A URI another app may read: the content:// URI itself, or a
   * FileProvider URI for one of our own imported copies. Files
   * outside the imports store are never exposed. */
  private fun outgoingUri(target: String): Uri? {
    if (target.startsWith("content://")) return Uri.parse(target)
    return try {
      val file = File(target).canonicalFile
      val imports = File(filesDir, "imports").canonicalFile
      if (!file.isFile || !file.path.startsWith(imports.path + File.separator)) null
      else FileProvider.getUriForFile(this, "$packageName.files", file)
    } catch (e: Exception) {
      null
    }
  }

  private fun openStream(target: String): InputStream? {
    if (target.startsWith("content://"))
      return contentResolver.openInputStream(Uri.parse(target))
    val file = File(target).canonicalFile
    val imports = File(filesDir, "imports").canonicalFile
    if (!file.isFile || !file.path.startsWith(imports.path + File.separator)) return null
    return file.inputStream()
  }

  private fun shareOut(uri: Uri, name: String, mime: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
      type = mime
      putExtra(Intent.EXTRA_STREAM, uri)
      putExtra(Intent.EXTRA_TITLE, name)
      // The chooser's own preview needs the grant too.
      clipData = ClipData.newRawUri(name, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    startActivity(Intent.createChooser(send, null))
  }

  private fun openElsewhere(uri: Uri, mime: String) {
    val view = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, mime)
      clipData = ClipData.newRawUri("", uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    // Offer every app that opens this type except Paperwren itself.
    val chooser = Intent.createChooser(view, null).apply {
      putExtra(
        Intent.EXTRA_EXCLUDE_COMPONENTS,
        arrayOf(ComponentName(this@MainActivity, MainActivity::class.java))
      )
    }
    startActivity(chooser)
  }

  /** Prints a file's own bytes: for a PDF this is exact, with no
   * re-rendering through the web page. */
  private fun filePrintAdapter(target: String, name: String) = object : PrintDocumentAdapter() {
    override fun onLayout(
      oldAttributes: PrintAttributes?,
      newAttributes: PrintAttributes?,
      cancellationSignal: CancellationSignal?,
      callback: PrintDocumentAdapter.LayoutResultCallback,
      extras: Bundle?
    ) {
      if (cancellationSignal?.isCanceled == true) {
        callback.onLayoutCancelled()
        return
      }
      val info = PrintDocumentInfo.Builder(name)
        .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
        .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
        .build()
      callback.onLayoutFinished(info, oldAttributes != newAttributes)
    }

    override fun onWrite(
      pages: Array<out PageRange>?,
      destination: ParcelFileDescriptor,
      cancellationSignal: CancellationSignal?,
      callback: PrintDocumentAdapter.WriteResultCallback
    ) {
      try {
        val input = openStream(target) ?: throw IllegalStateException("no stream")
        input.use { source ->
          FileOutputStream(destination.fileDescriptor).use { out -> source.copyTo(out, 64 * 1024) }
        }
        callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
      } catch (e: Exception) {
        callback.onWriteFailed(e.message)
      }
    }
  }

  // ---------- Folders (Storage Access Framework) ----------

  /** Every document under a picked folder, a few levels deep, as a
   * JSON array of {uri, name, size, modified, folder}. Bounded so a
   * huge tree can never hang the scan or flood the web layer. */
  private fun scanFolder(tree: Uri, extensions: Set<String>): JSONArray {
    val found = JSONArray()
    val columns = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )
    // (document id, folder label, depth) still to visit.
    val queue = ArrayDeque<Triple<String, String, Int>>()
    queue.addLast(Triple(DocumentsContract.getTreeDocumentId(tree), "", 0))
    var visited = 0
    while (queue.isNotEmpty() && found.length() < MAX_FOLDER_FILES && visited < MAX_FOLDERS) {
      val (parent, label, depth) = queue.pollFirst() ?: break
      visited++
      val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
      try {
        contentResolver.query(children, columns, null, null, null)?.use { c ->
          while (c.moveToNext() && found.length() < MAX_FOLDER_FILES) {
            val id = c.getString(0) ?: continue
            val name = c.getString(1) ?: continue
            val mime = c.getString(2)
            if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
              if (depth < MAX_FOLDER_DEPTH && !name.startsWith("."))
                queue.addLast(Triple(id, if (label.isEmpty()) name else "$label/$name", depth + 1))
              continue
            }
            val extension = name.substringAfterLast('.', "").lowercase()
            if (extension !in extensions) continue
            found.put(
              JSONObject()
                .put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString())
                .put("name", name)
                .put("size", if (c.isNull(3)) 0L else c.getLong(3))
                .put("modified", if (c.isNull(4)) 0L else c.getLong(4))
                .put("folder", label)
            )
          }
        }
      } catch (e: Exception) {
        // A folder we may not read: skip it, keep the rest.
      }
    }
    return found
  }

  /** Call a web-layer callback, on the UI thread, if the app page is loaded. */
  private fun callWeb(function: String, arguments: String) {
    main.post {
      val webView = findWebView() ?: return@post
      if (!isAppOrigin(webView.url)) return@post
      webView.evaluateJavascript("window.$function && window.$function($arguments)", null)
    }
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
      val delivery = copyIn(uri, mime)
      main.post {
        pending.addLast(delivery)
        deliverNext(0)
      }
    } catch (e: Exception) {
      main.post {
        Toast.makeText(this, "Paperwren couldn't open that file.", Toast.LENGTH_LONG).show()
      }
    }
  }

  /** Copy a content:// stream into imports/<hash>/<name>. Runs on the
   * ingest executor only. Throws when the stream can't be read. */
  private fun copyIn(uri: Uri, mime: String?): Delivery {
    val type = mime ?: try { contentResolver.getType(uri) } catch (e: Exception) { null }
    val displayName = withExtension(queryDisplayName(uri), type)
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
      return Delivery(target.absolutePath, displayName, target.length())
    } finally {
      tmp.delete()
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
      "image/png" -> "png"
      "image/jpeg" -> "jpg"
      "image/gif" -> "gif"
      "image/webp" -> "webp"
      "image/bmp" -> "bmp"
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

  private fun addJsBridge(webView: WebView) {
    if (bridgeInstalled) return
    bridgeInstalled = true
    // addJavascriptInterface is visible to every frame for the
    // WebView's lifetime, so each call re-checks the page origin.
    val bridge = object : Any() {
      // Bridge methods run on the JavaBridge thread, and WebView
      // methods throw off the UI thread: read the URL on main.
      private fun allowed(uri: String): Boolean =
        uri.startsWith("content://") && isAppOrigin(currentUrl(webView))

      @JavascriptInterface
      fun displayName(uri: String): String =
        if (!allowed(uri)) "" else try { queryDisplayName(Uri.parse(uri)) } catch (e: Exception) { "" }

      @JavascriptInterface
      fun contentSize(uri: String): Long =
        if (!allowed(uri)) 0L else try { querySize(Uri.parse(uri)) } catch (e: Exception) { 0L }

      /** Copy a picked file into managed storage so its recent still
       * opens after a restart. The dialog plugin picks with
       * ACTION_GET_CONTENT, whose read grant dies with the process and
       * can never be made persistable; a private copy is the only thing
       * that survives. Answers later through window.__paperwrenImported
       * (token, {path,name,size} | null); returns false when it could
       * not even start. */
      @JavascriptInterface
      fun importPicked(uri: String, token: String): Boolean {
        if (!allowed(uri)) return false
        val parsed = Uri.parse(uri)
        return try {
          ingestExecutor.execute {
            val result = try {
              val d = copyIn(parsed, null)
              JSONObject().put("path", d.path).put("name", d.name).put("size", d.size).toString()
            } catch (e: Exception) {
              "null"
            }
            main.post {
              if (!isAppOrigin(webView.url)) return@post
              webView.evaluateJavascript(
                "window.__paperwrenImported && window.__paperwrenImported(" +
                  JSONObject.quote(token) + "," + result + ")",
                null
              )
            }
          }
          true
        } catch (e: Exception) {
          false
        }
      }
    }
    webView.addJavascriptInterface(bridge, "__paperwrenAndroid")
    webView.addJavascriptInterface(handOffBridge(webView), "__paperwrenAndroidExtras")
  }

  /** Share, open elsewhere, print, keep awake, folders. A second
   * object so the picker bridge above stays exactly as shipped. */
  private fun handOffBridge(webView: WebView) = object : Any() {
    private fun fromApp(): Boolean = isAppOrigin(currentUrl(webView))

    private fun onMain(failure: String, action: () -> Unit) {
      main.post {
        try {
          action()
        } catch (e: Exception) {
          Toast.makeText(this@MainActivity, failure, Toast.LENGTH_LONG).show()
        }
      }
    }

    @JavascriptInterface
    fun shareFile(target: String, name: String, mime: String): Boolean {
      if (!fromApp()) return false
      val uri = outgoingUri(target) ?: return false
      onMain("Paperwren couldn't share that file.") { shareOut(uri, name, mime) }
      return true
    }

    @JavascriptInterface
    fun openFile(target: String, name: String, mime: String): Boolean {
      if (!fromApp()) return false
      val uri = outgoingUri(target) ?: return false
      onMain("No other app can open this file.") { openElsewhere(uri, mime) }
      return true
    }

    /** Print the page as the web layer laid it out for paper. */
    @JavascriptInterface
    fun printPage(jobName: String): Boolean {
      if (!fromApp()) return false
      onMain("Paperwren couldn't start printing.") {
        val manager = getSystemService(Context.PRINT_SERVICE) as PrintManager
        manager.print(
          jobName,
          webView.createPrintDocumentAdapter(jobName),
          PrintAttributes.Builder().build()
        )
      }
      return true
    }

    /** Print a PDF's own bytes. */
    @JavascriptInterface
    fun printFile(target: String, jobName: String): Boolean {
      if (!fromApp()) return false
      if (!target.startsWith("content://") && outgoingUri(target) == null) return false
      onMain("Paperwren couldn't start printing.") {
        val manager = getSystemService(Context.PRINT_SERVICE) as PrintManager
        manager.print(jobName, filePrintAdapter(target, jobName), PrintAttributes.Builder().build())
      }
      return true
    }

    @JavascriptInterface
    fun keepAwake(on: Boolean) {
      main.post {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }

    /** Ask the user for a folder. Answers through
     * window.__paperwrenFolder(token, {uri,name} | null). */
    @JavascriptInterface
    fun pickFolder(token: String): Boolean {
      if (!fromApp()) return false
      main.post {
        try {
          folderToken = token
          folderPicker.launch(null)
        } catch (e: Exception) {
          folderToken = null
          callWeb("__paperwrenFolder", JSONObject.quote(token) + ",null")
        }
      }
      return true
    }

    /** List a picked folder's documents. Answers through
     * window.__paperwrenFolderList(token, [...] | null). */
    @JavascriptInterface
    fun listFolder(treeUri: String, extensions: String, token: String): Boolean {
      if (!fromApp() || !treeUri.startsWith("content://")) return false
      val wanted = extensions.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()
      return try {
        scanExecutor.execute {
          val result = try {
            scanFolder(Uri.parse(treeUri), wanted).toString()
          } catch (e: Exception) {
            "null"
          }
          callWeb("__paperwrenFolderList", JSONObject.quote(token) + "," + result)
        }
        true
      } catch (e: Exception) {
        false
      }
    }

    /** Stop holding on to a folder the user removed from the app. */
    @JavascriptInterface
    fun releaseFolder(treeUri: String) {
      if (!fromApp() || !treeUri.startsWith("content://")) return
      try {
        contentResolver.releasePersistableUriPermission(
          Uri.parse(treeUri), Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
      } catch (e: Exception) {
        // Already released, or never held.
      }
    }
  }

  // ---------- Helpers ----------

  /** WebView.url from any thread (bridge calls arrive off the UI thread). */
  private fun currentUrl(webView: WebView): String? {
    if (Looper.myLooper() == Looper.getMainLooper()) return webView.url
    val latch = CountDownLatch(1)
    var url: String? = null
    main.post {
      url = webView.url
      latch.countDown()
    }
    latch.await(500, TimeUnit.MILLISECONDS)
    return url
  }

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

/** Bounds for a folder scan. */
private const val MAX_FOLDER_FILES = 2000
private const val MAX_FOLDERS = 400
private const val MAX_FOLDER_DEPTH = 4

/**
 * Grants other apps temporary read access to one imported copy at a
 * time (share / open in another app). A subclass of its own so its
 * manifest entry can never collide with a FileProvider the template
 * or a plugin declares. Declared by scripts/install-android.mjs with
 * the authority "<package>.files" and res/xml/paperwren_files.xml.
 */
class PaperwrenFiles : FileProvider()
