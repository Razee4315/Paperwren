package app.paperwren.docs

import android.app.ActivityManager
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
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
import java.util.ArrayDeque
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Paperwren's only native code. It does a few small jobs and keeps
 * everything else in the web layer:
 *
 * 1. "Open with" / "Share": open incoming content:// documents
 *    directly in place where they live (zero-copy via content:// and
 *    readRange), taking persistable read access when the provider
 *    allows it and keeping ephemeral grants session-scoped otherwise.
 * 2. System Back: ask the web layer first; finish only when it did
 *    not consume the press. Back on a file another app opened with
 *    Paperwren goes back to that app (leaveToCaller).
 * 3. A tiny JS bridge for the in-app picker: the provider's real
 *    display name and size, while reading picked files directly from
 *    their content:// URI rather than copying them into imports/.
 * 4. Hand-offs the web layer cannot do: share a file, open it in
 *    another app, print (the page, or a PDF itself), keep the screen
 *    on while reading, browse a folder the user picked, pick documents
 *    with the system's own picker, and rename a document from such a
 *    folder (or a copy they saved, or one they picked) when they ask.
 *    None of these needs a manifest permission: sharing goes through a
 *    FileProvider grant, folders and renames through the Storage
 *    Access Framework.
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
 * 10. A large PDF read a piece at a time (readRange), so pdf.js never
 *    holds the whole file. A file too large to copy in is handed to
 *    the page by its content:// address instead, for this run only.
 *    Started by another app to show a file, the app's task stays out
 *    of the system's recent apps; started from its icon, it is shown
 *    there again.
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
  /** Files another app handed over that the page has not taken yet
   * (still being inspected, or waiting for the page). The page asks
   * (incoming) before it reopens the last document at start, so that
   * document does not open over the one the reader came for. */
  private val arriving = AtomicInteger(0)

  /** A file to hand to the web layer. `caller` says another app opened
   * it with Paperwren: "started" when that start began Paperwren, "woken"
   * when Paperwren was already running; null for anything else. */
  private data class Delivery(
    val path: String,
    val name: String,
    val size: Long,
    val caller: String?,
    val persisted: Boolean = false
  )

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
            // Keep reading this folder after the app restarts, and
            // renaming a file in it when the reader asks.
            keepAccess(uri)
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
  /** Bytes written so far to each copy in `saving`. Under its lock. */
  private val savedBytes = HashMap<String, Long>()
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
            // the app restarts (and rename it, when the reader asks).
            keepAccess(uri)
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

  /** The web layer's token for the document pick in flight, if any. */
  private var pickToken: String? = null
  /** "Open file": the system's own document picker, so the app may keep
   * the address of what the reader picked (and rename the original when
   * they ask), not only the copy it reads. Input: pictures only, and
   * whether several may be picked. Cancelling gives an empty list. No
   * permission is needed: the reader picks the documents. */
  private val documentPicker =
    registerForActivityResult(object : androidx.activity.result.contract.ActivityResultContract<Pair<Boolean, Boolean>, List<Uri>>() {
      override fun createIntent(context: Context, input: Pair<Boolean, Boolean>): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          // Everything a document could be: the app reads what it is.
          type = if (input.first) "image/*" else "*/*"
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, input.second)
          addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or
              Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
              Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
          )
        }

      override fun parseResult(resultCode: Int, intent: Intent?): List<Uri> {
        if (resultCode != RESULT_OK || intent == null) return emptyList()
        val picked = ArrayList<Uri>()
        val clip = intent.clipData
        if (clip != null) {
          for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { picked.add(it) }
        }
        if (picked.isEmpty()) intent.data?.let { picked.add(it) }
        return picked
      }
    }) { uris ->
      val token = pickToken
      pickToken = null
      if (token == null) return@registerForActivityResult
      val list = JSONArray()
      for (uri in uris) list.put(uri.toString())
      callWeb("__paperwrenPicked", JSONObject.quote(token) + "," + list.toString())
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
    // Read before handleIntent, which consumes the action. Opened by
    // another app to show one file (WhatsApp, Gmail, a file manager), the
    // app is a viewer for that moment and stays out of recent apps. A
    // start from the icon shows it there again; a re-creation (no action
    // left, saved state) keeps what it was.
    when (intent?.action) {
      Intent.ACTION_VIEW, Intent.ACTION_SEND -> setTaskExcludedFromRecents(true)
      else -> if (savedInstanceState == null) setTaskExcludedFromRecents(false)
    }
    handleIntent(intent, "started")
    clearCameraPhotos()
    clearAbandonedCopies()
    sayIfRestarted()
  }

  /** Keep this task out of the system's recent apps, or show it there
   * again. Best effort: a system that refuses leaves it as it was. */
  private fun setTaskExcludedFromRecents(excluded: Boolean) {
    try {
      getSystemService(ActivityManager::class.java)?.appTasks?.firstOrNull()
        ?.setExcludeFromRecents(excluded)
    } catch (e: Exception) {
      // Not ours to change here: nothing else depends on it.
    }
  }

  // ---------- A WebView renderer that died ----------

  /** Called by the WebView client (its onRenderProcessGone is added at
   * build time, see .cargo/config.toml) when the page's
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

  /** Copies the app was making when it last ended (".incoming.*.tmp" in
   * imports) and copies it was saving (cache/saving) that it never
   * finished: a stop mid-copy leaves them behind. Only ones older than
   * ten minutes go, so nothing in use now is touched. */
  private fun clearAbandonedCopies() {
    scanExecutor.execute {
      val before = System.currentTimeMillis() - ABANDONED_AFTER_MS
      try {
        File(filesDir, "imports").listFiles()
          ?.filter {
            it.isFile && it.name.startsWith(".incoming.") && it.name.endsWith(".tmp") &&
              it.lastModified() < before
          }
          ?.forEach { it.delete() }
      } catch (e: Exception) {
        // No imports yet: nothing to clear.
      }
      try {
        File(cacheDir, "saving").listFiles()
          ?.filter { it.isFile && it.lastModified() < before }
          ?.forEach { it.delete() }
      } catch (e: Exception) {
        // No copies saved yet: nothing to clear.
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // Started from its icon again: the app is back in recent apps.
    if (intent.action == Intent.ACTION_MAIN) setTaskExcludedFromRecents(false)
    handleIntent(intent, "woken")
  }

  override fun onDestroy() {
    ingestExecutor.shutdown()
    scanExecutor.shutdown()
    speech?.shutdown()
    speech = null
    synchronized(rangeLock) { closeRangeFile() }
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
        jsSafe(
          "(window.__paperwrenNativeError && window.__paperwrenNativeError(" +
            JSONObject.quote(code) + ")) ? 'ok' : 'no'"
        )
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
      webView.evaluateJavascript(jsSafe("window.$function && window.$function($arguments)"), null)
    }
  }

  /** JSON made safe to run as script. org.json leaves U+2028 and U+2029
   * as they are; JavaScript before ES2019 (older WebViews) reads either
   * as a line end, which inside a string literal is a syntax error and
   * drops the whole call. Only ever inside JSON strings here, so each is
   * written as its escape. */
  private fun jsSafe(json: String): String =
    json.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

  // ---------- Open with / Share ----------

  /** `how` is "started" (onCreate) or "woken" (onNewIntent): with one
   * file opened from another app, Back on it goes back to that app. */
  private fun handleIntent(intent: Intent?, how: String) {
    if (intent == null) return
    val fromApp = intent.action == Intent.ACTION_VIEW || intent.action == Intent.ACTION_SEND
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
    // Another app's document only: a file:// address, or one of the app's
    // own providers, could make the app copy out its own private files.
    // A share of many is bounded, so it cannot queue copies without end.
    val (foreign, refused) = uris.take(MAX_INCOMING).partition { incomingAllowed(it) }
    if (refused.isNotEmpty()) report("open", "Paperwren couldn't open that file.")
    val caller = if (fromApp && foreign.size == 1) how else null
    for (uri in foreign) {
      val mime = intent.type
      arriving.incrementAndGet()
      ingestExecutor.execute { ingest(uri, mime, caller) }
    }
  }

  /** A content:// document of another app's. The app's own providers
   * ("<package>.files", "<package>.fileprovider") hand out its own
   * files, so an address of theirs coming back in is refused. */
  private fun incomingAllowed(uri: Uri): Boolean {
    if (uri.scheme?.lowercase(Locale.ROOT) != "content") return false
    val authority = uri.authority?.lowercase(Locale.ROOT) ?: return false
    val own = packageName.lowercase(Locale.ROOT)
    return authority != own && !authority.startsWith("$own.")
  }

  private fun ingest(uri: Uri, mime: String?, caller: String?) {
    if (!incomingAllowed(uri)) {
      arriving.decrementAndGet()
      report("open", "Paperwren couldn't open that file.")
      return
    }
    try {
      // Open external files directly from their content:// URI in place
      // without copying whole documents into app storage (#103).
      val delivery = inPlace(uri, mime, caller)
      main.post {
        pending.addLast(delivery)
        deliverNext(0)
      }
    } catch (e: Exception) {
      arriving.decrementAndGet()
      report("open", "Paperwren couldn't open that file.")
    }
  }

  /** A file handed over by its content:// address rather than a copy.
   * The grant that came with it usually lasts only while the app runs;
   * where the sender allows keeping it, it is kept. */
  private fun inPlace(uri: Uri, mime: String?, caller: String?): Delivery {
    val type = mime ?: try { contentResolver.getType(uri) } catch (e: Exception) { null }
    var persisted = false
    try {
      contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      persisted = true
    } catch (e: Exception) {
      // Readable for this run only.
    }
    return Delivery(
      uri.toString(), withExtension(queryDisplayName(uri), type), querySize(uri), caller, persisted
    )
  }

  /** Size ceiling for streamed saves written through saveChunk. */
  private val MAX_INGEST_BYTES = 250L * 1024 * 1024

  /** Hand queued files to the web layer one at a time. The page's
   * inline bridge answers true once it has queued the payload; until
   * the page is ready the delivery is retried (up to ~30 s). */
  private fun deliverNext(attempt: Int) {
    if (delivering && attempt == 0) return
    val next = pending.peekFirst() ?: run { delivering = false; return }
    delivering = true
    if (attempt > 200) {
      pending.pollFirst()
      arriving.decrementAndGet()
      delivering = false
      deliverNext(0)
      return
    }
    val webView = findWebView()
    if (webView == null || !isAppOrigin(webView.url)) {
      main.postDelayed({ deliverNext(attempt + 1) }, 150)
      return
    }
    val script = jsSafe(
      "(window.__paperwrenOpenFile && window.__paperwrenOpenFile(" +
        JSONObject.quote(next.path) + "," + JSONObject.quote(next.name) + "," + next.size +
        "," + (next.caller?.let { JSONObject.quote(it) } ?: "null") +
        "," + (if (next.persisted) "true" else "false") +
        ")) ? 'ok' : 'wait'"
    )
    webView.evaluateJavascript(script) { result ->
      if (result == "\"ok\"") {
        pending.pollFirst()
        arriving.decrementAndGet()
        delivering = false
        deliverNext(0)
      } else {
        main.postDelayed({ deliverNext(attempt + 1) }, 150)
      }
    }
  }

  // ---------- Keeping access, and renaming ----------

  /** Hold on to a document or folder the reader chose (a folder to
   * browse, a copy they saved) after the app restarts: to read it, and
   * to write where the grant allows it, which only a rename the reader
   * asks for ever uses. A grant without writing is kept for reading. */
  private fun keepAccess(uri: Uri) {
    try {
      contentResolver.takePersistableUriPermission(
        uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      )
    } catch (e: Exception) {
      contentResolver.takePersistableUriPermission(
        uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
      )
    }
  }

  /** Rename one document where its provider keeps it. Only a document
   * that says it can be renamed, and one the app may write to, is
   * asked; the provider never puts it over another file (some give it
   * a free name instead), so the name is read back from it. Answers
   * {uri, name}, or "unsupported", "permission" or "not_found" (quoted
   * JSON), or null when the provider failed. */
  private fun renamedDocument(uri: Uri, name: String): String {
    renameRefusal(uri)?.let { return it }
    val renamed = DocumentsContract.renameDocument(contentResolver, uri, name) ?: return "null"
    try {
      // A document of its own (a saved copy, a picked original) has a new
      // address: keep it. One inside a folder the reader chose is covered
      // by the folder.
      keepAccess(renamed)
    } catch (e: Exception) {
      // Readable until the app closes, then picked again.
    }
    return JSONObject()
      .put("uri", renamed.toString())
      .put("name", queryDisplayName(renamed))
      .toString()
  }

  /** Why the app may not ask for a document to be renamed ("unsupported",
   * "permission" or "not_found", quoted JSON), or null when it may: the
   * document must say it can be renamed, and the app must be allowed to
   * write to it. */
  private fun renameRefusal(uri: Uri): String? {
    if (!DocumentsContract.isDocumentUri(this, uri)) return "\"unsupported\""
    var found = false
    var flags = 0
    contentResolver.query(
      uri, arrayOf(DocumentsContract.Document.COLUMN_FLAGS), null, null, null
    )?.use { c ->
      if (c.moveToFirst()) {
        found = true
        if (!c.isNull(0)) flags = c.getInt(0)
      }
    }
    if (!found) return "\"not_found\""
    if ((flags and DocumentsContract.Document.FLAG_SUPPORTS_RENAME) == 0) return "\"unsupported\""
    if (checkCallingOrSelfUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION) !=
      PackageManager.PERMISSION_GRANTED
    ) return "\"permission\""
    return null
  }

  // ---------- Provider metadata ----------

  /** The name a provider gives a document, as the page shows it. The
   * sending app chooses it, so control characters and the two line
   * separators JavaScript reads as line ends are taken out. */
  private fun queryDisplayName(uri: Uri): String {
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (i >= 0) {
            val name = c.getString(i)?.let { plainName(it) }
            if (!name.isNullOrBlank()) return name
          }
        }
      }
    } catch (e: Exception) {
      // Fall back to the last URI segment.
    }
    return uri.lastPathSegment?.substringAfterLast('/')?.let { plainName(it) }
      ?.ifBlank { null } ?: "document"
  }

  private fun plainName(name: String): String =
    name.filterNot { it <= '\u001F' || it == '\u007F' || it == ' ' || it == ' ' }

  private fun querySize(uri: Uri): Long {
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val i = c.getColumnIndex(OpenableColumns.SIZE)
          if (i >= 0 && !c.isNull(i)) return c.getLong(i).coerceAtLeast(0L)
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
      "text/vcard", "text/x-vcard", "text/directory" -> "vcf"
      "model/gltf-binary" -> "glb"
      "text/plain" -> "txt"
      else -> null
    }
    return if (ext != null) "$name.$ext" else name
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

      /** Legacy bridge entry retained as a no-op stub: Paperwren opens
       * picked and external content:// documents directly in place and
       * never copies them into app storage (#103). */
      @JavascriptInterface
      fun importPicked(uri: String, token: String): Boolean = false
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
      if (!fromApp()) return
      main.post { if (speechReady) speech?.stop() }
    }

    /** Draw a picture the WebView cannot (HEIC) and hand it back as a
     * JPEG through window.__paperwrenDecoded(token, base64 | null). The
     * picture is bounded twice: its bytes (MAX_PICTURE_BASE64), and its
     * size in pixels, read from its header before any pixel is decoded,
     * so a small file that claims to be huge never fills memory. */
    @JavascriptInterface
    fun decodePicture(base64: String, token: String): Boolean {
      if (!fromApp()) return false
      if (base64.length > MAX_PICTURE_BASE64) return false
      scanExecutor.execute {
        val jpeg = try {
          val bytes = Base64.decode(base64, Base64.DEFAULT)
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
          val w = bounds.outWidth
          val h = bounds.outHeight
          val fits = w > 0 && h > 0 && w.toLong() * h.toLong() <= MAX_PICTURE_PIXELS
          val bitmap = if (fits) BitmapFactory.decodeByteArray(bytes, 0, bytes.size) else null
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
      if (!fromApp()) return
      main.post {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }

    /** Back on a file another app opened with Paperwren: back to that
     * app. Paperwren started for it ends and leaves Recents, as a
     * viewer should; one that was already running steps behind it and
     * keeps what the reader had open before. */
    @JavascriptInterface
    fun leaveToCaller(started: Boolean): Boolean {
      if (!fromApp()) return false
      main.post {
        if (started) finishAndRemoveTask() else moveTaskToBack(true)
      }
      return true
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

    /** Start a copy to save; its bytes follow through saveChunk. A few
     * at a time (MAX_SAVING), so a page cannot fill the cache with copies
     * it never finishes. */
    @JavascriptInterface
    fun saveBegin(token: String): Boolean {
      if (!fromApp() || token.isEmpty() || token.length > 64) return false
      return try {
        val dir = File(cacheDir, "saving").apply { mkdirs() }
        synchronized(saving) {
          if (!saving.containsKey(token) && saving.size >= MAX_SAVING) return false
          saving.remove(token)?.delete()
          savedBytes.remove(token)
          saving[token] = File.createTempFile("copy", ".bin", dir)
          savedBytes[token] = 0L
        }
        true
      } catch (e: Exception) {
        false
      }
    }

    /** A piece of the copy, as base64. A copy larger than an imported
     * one may be (MAX_INGEST_BYTES) is dropped, file and all. */
    @JavascriptInterface
    fun saveChunk(token: String, base64: String): Boolean {
      if (!fromApp()) return false
      val file = synchronized(saving) { saving[token] } ?: return false
      return try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        val total = synchronized(saving) {
          val sum = (savedBytes[token] ?: 0L) + bytes.size
          savedBytes[token] = sum
          sum
        }
        if (total > MAX_INGEST_BYTES) {
          synchronized(saving) {
            saving.remove(token)
            savedBytes.remove(token)
          }
          file.delete()
          return false
        }
        FileOutputStream(file, true).use { it.write(bytes) }
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
      val file = synchronized(saving) {
        savedBytes.remove(token)
        saving.remove(token)
      } ?: return false
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
          Uri.parse(treeUri),
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
      } catch (e: Exception) {
        // Already released, or never held.
      }
    }

    /** Rename a document the reader opened from a folder or saved (not a
     * copy the app holds). Answers through window.__paperwrenRenamed
     * (token, {uri, name} | "unsupported" | "permission" | "not_found" |
     * null). */
    @JavascriptInterface
    fun renameDocument(target: String, name: String, token: String): Boolean {
      if (!fromApp() || !target.startsWith("content://")) return false
      if (name.isBlank() || name.contains('/') || name.length > 255) return false
      return try {
        scanExecutor.execute {
          val result = try {
            renamedDocument(Uri.parse(target), name)
          } catch (e: SecurityException) {
            "\"permission\""
          } catch (e: java.io.FileNotFoundException) {
            "\"not_found\""
          } catch (e: UnsupportedOperationException) {
            "\"unsupported\""
          } catch (e: Exception) {
            "null"
          }
          callWeb("__paperwrenRenamed", JSONObject.quote(token) + "," + result)
        }
        true
      } catch (e: Exception) {
        false
      }
    }

    /** "Open file" with the system's own picker. Answers through
     * window.__paperwrenPicked(token, [uri, ...] | null): empty when the
     * reader cancels, null when the picker could not start. */
    @JavascriptInterface
    fun pickDocuments(token: String, pictures: Boolean, multiple: Boolean): Boolean {
      if (!fromApp()) return false
      main.post {
        try {
          pickToken = token
          documentPicker.launch(Pair(pictures, multiple))
        } catch (e: Exception) {
          pickToken = null
          callWeb("__paperwrenPicked", JSONObject.quote(token) + ",null")
        }
      }
      return true
    }

    /** Keep a picked document over restarts, as Recent files names it:
     * to read it, and to rename it when the reader asks. Released again
     * through releaseFolder once nothing names it. */
    @JavascriptInterface
    fun keepDocument(target: String): Boolean {
      if (!fromApp() || !target.startsWith("content://")) return false
      return try {
        keepAccess(Uri.parse(target))
        true
      } catch (e: Exception) {
        false
      }
    }

    /** Whether renameDocument may be asked for this document (the same
     * checks it makes), so the reader is told beforehand when only the
     * name in Paperwren can change. */
    @JavascriptInterface
    fun canRenameDocument(target: String): Boolean {
      if (!fromApp() || !target.startsWith("content://")) return false
      return try {
        renameRefusal(Uri.parse(target)) == null
      } catch (e: Exception) {
        false
      }
    }

    /** Up to `length` bytes of a document from `offset`, as base64 ("" past
     * its end), or null when it cannot be read that way (a provider that
     * only streams, a file outside the imports store). pdf.js reads a large
     * PDF like this, a piece at a time. Runs on the JavaBridge thread. */
    @JavascriptInterface
    fun readRange(target: String, offset: Long, length: Int): String? {
      if (!fromApp() || offset < 0 || length <= 0) return null
      return try {
        val bytes = readPiece(target, offset, minOf(length, MAX_RANGE_BYTES)) ?: return null
        Base64.encodeToString(bytes, Base64.NO_WRAP)
      } catch (e: Exception) {
        null
      }
    }

    /** The size of a document readRange can read, or -1 when unknown. */
    @JavascriptInterface
    fun fileSize(target: String): Long {
      if (!fromApp()) return -1L
      return try {
        if (target.startsWith("content://")) {
          val told = synchronized(rangeLock) { rangeFile(target)?.statSize ?: -1L }
          if (told >= 0) told else querySize(Uri.parse(target)).takeIf { it > 0 } ?: -1L
        } else {
          managedCopy(target)?.length() ?: -1L
        }
      } catch (e: Exception) {
        -1L
      }
    }

    /** Whether a file another app handed over is still on its way to the
     * page (being copied in, or waiting for the page to take it). */
    @JavascriptInterface
    fun incoming(): Boolean = fromApp() && arriving.get() > 0
  }

  // ---------- Reading a piece of a document ----------

  /** The document readRange read last, held open: pdf.js asks for many
   * pieces of one file, and opening it at each costs a call to its
   * provider. Only the JavaBridge thread uses it, under rangeLock. */
  private val rangeLock = Any()
  private var rangeTarget: String? = null
  private var rangeDescriptor: ParcelFileDescriptor? = null

  /** The open descriptor of a content:// document. Under rangeLock. */
  private fun rangeFile(target: String): ParcelFileDescriptor? {
    if (target == rangeTarget) rangeDescriptor?.let { return it }
    closeRangeFile()
    val opened = contentResolver.openFileDescriptor(Uri.parse(target), "r") ?: return null
    rangeTarget = target
    rangeDescriptor = opened
    return opened
  }

  /** Under rangeLock. */
  private fun closeRangeFile() {
    try {
      rangeDescriptor?.close()
    } catch (e: Exception) {
      // Closed already.
    }
    rangeDescriptor = null
    rangeTarget = null
  }

  /** One of the app's imported copies, or null for any other path. */
  private fun managedCopy(target: String): File? {
    val file = File(target).canonicalFile
    val imports = File(filesDir, "imports").canonicalFile
    return if (file.isFile && file.path.startsWith(imports.path + File.separator)) file else null
  }

  /** Bytes of a content:// document or an imported copy, read at `offset`
   * without reading what comes before it. A provider that hands over a
   * pipe cannot be read this way and throws; the page then reads the file
   * whole, as before. */
  private fun readPiece(target: String, offset: Long, length: Int): ByteArray? {
    if (target.startsWith("content://")) {
      return synchronized(rangeLock) {
        val pfd = rangeFile(target) ?: return@synchronized null
        try {
          readAt(pfd.fileDescriptor, offset, length)
        } catch (e: Exception) {
          closeRangeFile()
          throw e
        }
      }
    }
    val file = managedCopy(target) ?: return null
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use {
      readAt(it.fileDescriptor, offset, length)
    }
  }

  /** pread straight on the descriptor: no stream wraps it, so nothing
   * but closeRangeFile ever closes the one held open. */
  private fun readAt(fd: java.io.FileDescriptor, offset: Long, length: Int): ByteArray {
    val bytes = ByteArray(length)
    var done = 0
    while (done < length) {
      val read = android.system.Os.pread(fd, bytes, done, length - done, offset + done)
      if (read <= 0) break
      done += read
    }
    return if (done == length) bytes else bytes.copyOf(done)
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

  /** The page the app itself serves. The host is compared whole: a
   * prefix ("http://localhost") would also take a page at
   * "http://localhost.attacker.tld", and the JS bridges answer
   * whoever this says yes to. Only http(s): a file:// or data: page
   * with that host is not the app's. A release build serves its page
   * from tauri.localhost alone; localhost and 127.0.0.1 are a debug
   * build's dev server, where any app on the phone could listen. The
   * flag is read from applicationInfo, not BuildConfig, whose package
   * the generated project chooses. */
  private fun isAppOrigin(url: String?): Boolean {
    if (url == null) return false
    val parsed = try {
      Uri.parse(url)
    } catch (e: Exception) {
      return false
    }
    val scheme = parsed.scheme?.lowercase(Locale.ROOT)
    if (scheme != "https" && scheme != "http") return false
    val host = parsed.host?.lowercase(Locale.ROOT) ?: return false
    if (host == "tauri.localhost") return true
    return debuggable && (host == "localhost" || host == "127.0.0.1")
  }

  private val debuggable: Boolean by lazy {
    (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
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

/** The most one readRange answers with (before base64): pdf.js asks for
 * 64 KiB pieces, and a bound keeps any one answer small. */
private const val MAX_RANGE_BYTES = 2 * 1024 * 1024

/** The most documents one share takes in. */
private const val MAX_INCOMING = 50

/** Copies being saved at once (saveBegin). */
private const val MAX_SAVING = 4

/** A picture decodePicture takes: about 25 MB of bytes as base64, and
 * at most 32 million pixels (128 MB as a bitmap). */
private const val MAX_PICTURE_BASE64 = 35_000_000
private const val MAX_PICTURE_PIXELS = 32_000_000L

/** Half-made copies older than this are left from an earlier run. */
private const val ABANDONED_AFTER_MS = 10 * 60 * 1000L

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
