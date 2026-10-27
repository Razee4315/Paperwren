package app.paperwren.docs

import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import android.util.Base64
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.Locale
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
 * 5. The system bars. The app draws under them, and many WebViews
 *    report no safe area for them, so their real sizes are handed to
 *    the page here. A slide show hides them and turns the screen
 *    sideways (the WebView turns down a page's own request for full
 *    screen, so the page asks here instead), and the status-bar icons
 *    follow the app's theme rather than the phone's.
 * 6. Read aloud, with the system's text-to-speech (a WebView has no
 *    speech of its own), in voices that speak on the phone only, and
 *    the volume keys turning pages while the reader asks for that.
 * 7. Pictures the WebView cannot draw (HEIC, from an iPhone): the
 *    system decodes them and hands back a JPEG.
 * 8. The scanner's photos: "Take a photo" is the WebView's own file
 *    chooser handing the job to the camera app (no permission), which
 *    leaves the photo in the app's own Pictures folder. They are only
 *    needed while the page reads them, so each start clears them out.
 * 9. A page whose renderer died (crashed, or taken back for memory):
 *    the app starts afresh instead of vanishing.
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

  /** Copies the web layer saves (a filled-in form, pages put
   * together): their bytes arrive a piece at a time into a file in the
   * cache, then the system's "save as" screen says where they go. No
   * permission is needed: the reader picks the place. */
  private val saving = HashMap<String, File>()
  private var saveToken: String? = null
  private var saveFile: File? = null
  private val savePicker =
    registerForActivityResult(object : androidx.activity.result.contract.ActivityResultContract<Pair<String, String>, Uri?>() {
      override fun createIntent(context: Context, input: Pair<String, String>): Intent =
        Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = input.second
          putExtra(Intent.EXTRA_TITLE, input.first)
        }

      override fun parseResult(resultCode: Int, intent: Intent?): Uri? =
        if (resultCode == RESULT_OK) intent?.data else null
    }) { uri ->
      val token = saveToken
      val file = saveFile
      saveToken = null
      saveFile = null
      if (token == null || file == null) return@registerForActivityResult
      if (uri == null) {
        file.delete()
        callWeb("__paperwrenSaved", JSONObject.quote(token) + ",\"cancel\"")
        return@registerForActivityResult
      }
      scanExecutor.execute {
        val result = try {
          contentResolver.openOutputStream(uri, "wt")?.use { out ->
            file.inputStream().use { it.copyTo(out) }
          } ?: throw IllegalStateException("no stream")
          try {
            // Open the copy from the message, and from Recent files after
            // the app restarts.
            contentResolver.takePersistableUriPermission(
              uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
          } catch (e: Exception) {
            // Readable until the app closes, then named only.
          }
          JSONObject()
            .put("name", queryDisplayName(uri))
            .put("uri", uri.toString())
            .toString()
        } catch (e: Exception) {
          "null"
        } finally {
          file.delete()
        }
        callWeb("__paperwrenSaved", JSONObject.quote(token) + "," + result)
      }
    }

  /** A slide show has the screen: the system bars are hidden. */
  private var barsHidden = false

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
    watchInsets(webView)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    installBackBridge()
    handleIntent(intent)
    clearCameraPhotos()
    sayIfRestarted()
  }

  // ---------- A WebView renderer that died ----------

  /** Called by the WebView client (its onRenderProcessGone is added at
   * build time, see src-tauri/.cargo/config.toml) when the page's
   * renderer process crashed or the system took it back for memory.
   * Left unanswered, Android closes the whole app without a word. The
   * dead WebView can never draw again and the Rust side is tied to it,
   * so the app starts afresh. A second time within a minute it closes
   * with a message instead, so a page that dies on every start cannot
   * go round and round. */
  fun onRendererGone(view: WebView, crashed: Boolean): Boolean {
    android.util.Log.w(
      "Paperwren", "WebView renderer gone (" + (if (crashed) "crashed" else "killed") + ")"
    )
    (view.parent as? android.view.ViewGroup)?.removeView(view)
    view.destroy()
    val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val again = now - prefs.getLong(RESTARTED_AT, 0L) < RESTART_WINDOW_MS
    prefs.edit()
      .putLong(RESTARTED_AT, now)
      .putBoolean(RESTART_PENDING, !again)
      .commit()
    if (again) {
      Toast.makeText(this, "Paperwren stopped. Please open it again.", Toast.LENGTH_LONG).show()
      main.postDelayed({
        finishAndRemoveTask()
        android.os.Process.killProcess(android.os.Process.myPid())
      }, 2500)
      return true
    }
    val start = packageManager.getLaunchIntentForPackage(packageName)
    if (start != null) {
      start.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      startActivity(start)
    }
    finishAffinity()
    android.os.Process.killProcess(android.os.Process.myPid())
    return true
  }

  /** After a restart for a dead renderer, say so once the page can
   * (it holds the translations); a page that never gets there leaves
   * it to a plain toast. Main thread. */
  private fun sayIfRestarted(attempt: Int = 0) {
    val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
    if (attempt == 0) {
      if (!prefs.getBoolean(RESTART_PENDING, false)) return
      prefs.edit().putBoolean(RESTART_PENDING, false).apply()
    }
    val fallback = "Paperwren had to restart."
    if (attempt > 60) {
      Toast.makeText(this, fallback, Toast.LENGTH_LONG).show()
      return
    }
    val webView = findWebView()
    if (webView == null || !isAppOrigin(webView.url)) {
      main.postDelayed({ sayIfRestarted(attempt + 1) }, 250)
      return
    }
    webView.evaluateJavascript(
      "(window.__paperwrenNativeError && window.__paperwrenNativeError(\"restarted\")) ? 'ok' : 'wait'"
    ) { result ->
      if (result != "\"ok\"") main.postDelayed({ sayIfRestarted(attempt + 1) }, 250)
    }
  }

  /** Photos the camera app wrote for an earlier scan ("JPEG_<time>_….jpg",
   * named by the WebView's file chooser). The scan itself keeps nothing. */
  private fun clearCameraPhotos() {
    scanExecutor.execute {
      try {
        val dir = getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES)
        dir?.listFiles()
          ?.filter { it.isFile && it.name.startsWith("JPEG_") && it.name.endsWith(".jpg") }
          ?.forEach { it.delete() }
      } catch (e: Exception) {
        // No such folder, or no storage there: nothing to clear.
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleIntent(intent)
  }

  override fun onDestroy() {
    ingestExecutor.shutdown()
    scanExecutor.shutdown()
    speech?.shutdown()
    speech = null
    super.onDestroy()
  }

  // ---------- Volume keys ----------

  /** The reader asked for the volume keys to turn pages. */
  @Volatile private var volumeKeysTurn = false

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val code = event.keyCode
    if (volumeKeysTurn &&
      (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)
    ) {
      // Down turns forward, up back; held, it keeps turning.
      if (event.action == KeyEvent.ACTION_DOWN) {
        callWeb("__paperwrenVolumeKey", if (code == KeyEvent.KEYCODE_VOLUME_DOWN) "1" else "-1")
      }
      return true
    }
    return super.dispatchKeyEvent(event)
  }

  // ---------- Read aloud ----------

  /** The system's text-to-speech, started the first time it is asked
   * for; what is asked before it is ready waits for it. */
  private var speech: TextToSpeech? = null
  private var speechReady = false
  private val speechWaiting = ArrayDeque<() -> Unit>()

  private fun spoken(token: String, outcome: String) =
    callWeb("__paperwrenSpoken", "${JSONObject.quote(token)}, ${JSONObject.quote(outcome)}")

  /** Main thread. */
  private fun withSpeech(then: () -> Unit) {
    if (speechReady) {
      then()
      return
    }
    speechWaiting.add(then)
    if (speech != null) return
    speech = TextToSpeech(this) { status ->
      main.post {
        val engine = speech
        speechReady = status == TextToSpeech.SUCCESS && engine != null
        if (speechReady && engine != null) {
          engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) {
              utteranceId?.let { spoken(it, "done") }
            }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
              utteranceId?.let { spoken(it, "error") }
            }
            override fun onError(utteranceId: String?, errorCode: Int) {
              utteranceId?.let { spoken(it, "error") }
            }
            override fun onStop(utteranceId: String?, interrupted: Boolean) {
              utteranceId?.let { spoken(it, "stopped") }
            }
          })
        }
        val waiting = speechWaiting.toList()
        speechWaiting.clear()
        if (!speechReady) {
          speech?.shutdown()
          speech = null
        }
        waiting.forEach { it() }
      }
    }
  }

  /** The voice for a language that speaks on the phone itself: one that
   * needs the network would send the text away. */
  private fun onDeviceVoice(engine: TextToSpeech, lang: String): Voice? {
    val wanted = if (lang.isBlank()) Locale.getDefault() else Locale.forLanguageTag(lang)
    val voices = try {
      engine.voices.orEmpty()
    } catch (e: Exception) {
      emptySet()
    }.filter { voice ->
      !voice.isNetworkConnectionRequired &&
        voice.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true
    }
    val ofLanguage = voices.filter { it.locale.language == wanted.language }
    return (ofLanguage.filter { it.locale.country == wanted.country }.ifEmpty { ofLanguage })
      .maxByOrNull { it.quality }
  }

  /** Main thread. */
  private fun speakNow(text: String, lang: String, rate: Float, token: String) {
    val engine = speech
    if (!speechReady || engine == null) {
      spoken(token, "no-voice")
      return
    }
    val voice = onDeviceVoice(engine, lang)
      ?: onDeviceVoice(engine, Locale.getDefault().toLanguageTag())
    if (voice == null) {
      spoken(token, "no-voice")
      return
    }
    engine.voice = voice
    engine.setSpeechRate(rate)
    val params = Bundle()
    if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, token) != TextToSpeech.SUCCESS) {
      spoken(token, "error")
    }
  }

  /** Coming back to a slide show (from the share sheet, another app,
   * the notification shade): the system may have brought its bars
   * back with it. */
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus && barsHidden) {
      WindowCompat.getInsetsController(window, window.decorView)
        .hide(WindowInsetsCompat.Type.systemBars())
    }
  }

  // ---------- System bars ----------

  /** Hide the status and navigation bars for a slide show (a swipe
   * from an edge shows them for a moment) and, for slides wider than
   * tall, turn the screen sideways; or put both back. Main thread. */
  private fun setImmersive(on: Boolean, landscape: Boolean) {
    barsHidden = on
    val bars = WindowCompat.getInsetsController(window, window.decorView)
    if (on) {
      bars.systemBarsBehavior =
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      bars.hide(WindowInsetsCompat.Type.systemBars())
      if (landscape) {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      }
    } else {
      bars.show(WindowInsetsCompat.Type.systemBars())
      requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
  }

  /** The room the system bars and a camera cutout take at each edge, in
   * CSS pixels, as JSON. The page reads it through the bridge when it
   * starts and hears every change through window.__paperwrenInsets. */
  @Volatile private var insetsJson = "null"

  private fun insetsOf(insets: WindowInsetsCompat): String {
    val edges = insets.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    )
    val density = resources.displayMetrics.density
    return JSONObject()
      .put("top", edges.top / density)
      .put("right", edges.right / density)
      .put("bottom", edges.bottom / density)
      .put("left", edges.left / density)
      .toString()
  }

  /** Follow the bars as they come and go: rotation, a slide show
   * hiding them, gesture or button navigation. The WebView still gets
   * the insets after us, for its own safe area. */
  private fun watchInsets(webView: WebView) {
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val json = insetsOf(insets)
      if (json != insetsJson) {
        insetsJson = json
        callWeb("__paperwrenInsets", json)
      }
      ViewCompat.onApplyWindowInsets(view, insets)
    }
    ViewCompat.requestApplyInsets(webView)
  }

  /** Say that something failed. The page holds the translations, so it
   * says it when it is up to (window.__paperwrenNativeError answers
   * true); before that, or in a build whose page does not know how,
   * a plain toast does. */
  private fun report(code: String, fallback: String) {
    main.post {
      val webView = findWebView()
      if (webView == null || !isAppOrigin(webView.url)) {
        Toast.makeText(this, fallback, Toast.LENGTH_LONG).show()
        return@post
      }
      webView.evaluateJavascript(
        "(window.__paperwrenNativeError && window.__paperwrenNativeError(" +
          JSONObject.quote(code) + ")) ? 'ok' : 'no'"
      ) { result ->
        if (result != "\"ok\"") {
          Toast.makeText(this, fallback, Toast.LENGTH_LONG).show()
        }
      }
    }
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
      report("open", "Paperwren couldn't open that file.")
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
      "application/vnd.ms-word.document.macroEnabled.12" -> "docm"
      "application/vnd.openxmlformats-officedocument.wordprocessingml.template" -> "dotx"
      "application/vnd.ms-excel" -> "xls"
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" -> "xlsx"
      "application/vnd.ms-excel.sheet.macroEnabled.12" -> "xlsm"
      "application/vnd.ms-excel.sheet.binary.macroEnabled.12" -> "xlsb"
      "application/vnd.openxmlformats-officedocument.spreadsheetml.template" -> "xltx"
      "application/vnd.ms-powerpoint" -> "ppt"
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" -> "pptx"
      "application/vnd.ms-powerpoint.presentation.macroEnabled.12" -> "pptm"
      "application/vnd.openxmlformats-officedocument.presentationml.slideshow" -> "ppsx"
      "application/json" -> "json"
      "application/xml", "text/xml" -> "xml"
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

    private fun onMain(code: String, failure: String, action: () -> Unit) {
      main.post {
        try {
          action()
        } catch (e: Exception) {
          report(code, failure)
        }
      }
    }

    @JavascriptInterface
    fun shareFile(target: String, name: String, mime: String): Boolean {
      if (!fromApp()) return false
      val uri = outgoingUri(target) ?: return false
      onMain("share", "Paperwren couldn't share that file.") { shareOut(uri, name, mime) }
      return true
    }

    @JavascriptInterface
    fun openFile(target: String, name: String, mime: String): Boolean {
      if (!fromApp()) return false
      val uri = outgoingUri(target) ?: return false
      onMain("open-with", "No other app can open this file.") { openElsewhere(uri, mime) }
      return true
    }

    /** Print the page as the web layer laid it out for paper. */
    @JavascriptInterface
    fun printPage(jobName: String): Boolean {
      if (!fromApp()) return false
      onMain("print", "Paperwren couldn't start printing.") {
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
      onMain("print", "Paperwren couldn't start printing.") {
        val manager = getSystemService(Context.PRINT_SERVICE) as PrintManager
        manager.print(jobName, filePrintAdapter(target, jobName), PrintAttributes.Builder().build())
      }
      return true
    }

    /** Read `text` aloud; the outcome comes back through
     * window.__paperwrenSpoken(token, "done" | "stopped" | "error" | "no-voice"). */
    @JavascriptInterface
    fun speak(text: String, lang: String, rate: Double, token: String): Boolean {
      if (!fromApp()) return false
      main.post { withSpeech { speakNow(text, lang, rate.toFloat(), token) } }
      return true
    }

    @JavascriptInterface
    fun stopSpeaking() {
      main.post { if (speechReady) speech?.stop() }
    }

    /** Draw a picture the WebView cannot (HEIC) and hand it back as a
     * JPEG through window.__paperwrenDecoded(token, base64 | null). */
    @JavascriptInterface
    fun decodePicture(base64: String, token: String): Boolean {
      if (!fromApp()) return false
      scanExecutor.execute {
        val jpeg = try {
          val bytes = Base64.decode(base64, Base64.DEFAULT)
          val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
          if (bitmap == null) null else {
            val out = java.io.ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out)
            bitmap.recycle()
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
          }
        } catch (e: Throwable) {
          null
        }
        callWeb(
          "__paperwrenDecoded",
          "${JSONObject.quote(token)}, ${if (jpeg == null) "null" else JSONObject.quote(jpeg)}"
        )
      }
      return true
    }

    /** The volume keys turn the pages (true), or change the volume. */
    @JavascriptInterface
    fun volumeKeys(on: Boolean) {
      if (!fromApp()) return
      volumeKeysTurn = on
    }

    @JavascriptInterface
    fun keepAwake(on: Boolean) {
      main.post {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }

    /** A slide show takes the whole screen, or gives it back: the
     * status and navigation bars, and (for slides wider than tall) the
     * way the screen is turned. */
    @JavascriptInterface
    fun immersive(on: Boolean, landscape: Boolean) {
      if (!fromApp()) return
      main.post { setImmersive(on, landscape) }
    }

    /** Which way the app's own bars are coloured (its theme, which
     * need not be the phone's), so the clock and battery are drawn to
     * be read on them. */
    @JavascriptInterface
    fun systemBars(dark: Boolean) {
      if (!fromApp()) return
      main.post {
        val bars = WindowCompat.getInsetsController(window, window.decorView)
        bars.isAppearanceLightStatusBars = !dark
        bars.isAppearanceLightNavigationBars = !dark
      }
    }

    /** The bars' room now, as window.__paperwrenInsets is told it:
     * {top, right, bottom, left} in CSS pixels, or null. */
    @JavascriptInterface
    fun insets(): String {
      if (!fromApp()) return "null"
      if (insetsJson != "null") return insetsJson
      // Asked before the first insets reached the WebView: read the
      // window's own, on the UI thread.
      val latch = CountDownLatch(1)
      var json = "null"
      main.post {
        try {
          ViewCompat.getRootWindowInsets(webView)?.let { json = insetsOf(it) }
        } finally {
          latch.countDown()
        }
      }
      latch.await(500, TimeUnit.MILLISECONDS)
      return json
    }

    /** Start a copy to save; its bytes follow through saveChunk. */
    @JavascriptInterface
    fun saveBegin(token: String): Boolean {
      if (!fromApp() || token.isEmpty() || token.length > 64) return false
      return try {
        val dir = File(cacheDir, "saving").apply { mkdirs() }
        synchronized(saving) {
          saving.remove(token)?.delete()
          saving[token] = File.createTempFile("copy", ".bin", dir)
        }
        true
      } catch (e: Exception) {
        false
      }
    }

    /** A piece of the copy, as base64. */
    @JavascriptInterface
    fun saveChunk(token: String, base64: String): Boolean {
      if (!fromApp()) return false
      val file = synchronized(saving) { saving[token] } ?: return false
      return try {
        FileOutputStream(file, true).use { it.write(Base64.decode(base64, Base64.DEFAULT)) }
        true
      } catch (e: Exception) {
        false
      }
    }

    /** Ask where the copy goes, offering `name`. Answers through
     * window.__paperwrenSaved(token, {name, uri} | "cancel" | null). */
    @JavascriptInterface
    fun saveFinish(token: String, name: String, mime: String): Boolean {
      if (!fromApp()) return false
      val file = synchronized(saving) { saving.remove(token) } ?: return false
      main.post {
        try {
          saveFile?.delete()
          saveToken = token
          saveFile = file
          savePicker.launch(Pair(name, mime.ifEmpty { "application/octet-stream" }))
        } catch (e: Exception) {
          saveToken = null
          saveFile = null
          file.delete()
          callWeb("__paperwrenSaved", JSONObject.quote(token) + ",null")
        }
      }
      return true
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

/** Where a restart for a dead renderer is remembered, and how close a
 * second one must come to close the app instead. */
private const val PREFS = "paperwren"
private const val RESTARTED_AT = "rendererRestartedAt"
private const val RESTART_PENDING = "rendererRestartPending"
private const val RESTART_WINDOW_MS = 60_000L

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
