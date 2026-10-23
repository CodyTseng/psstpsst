package chat.psstpsst.app.napplet

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.EditText
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.Executors
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl

private val permissionSerial = AtomicInteger(20000)
internal object BrowserPickers {
  private val serial = AtomicInteger(24000)
  private data class Pending(val owner: Any, val activity: java.lang.ref.WeakReference<Activity>, val callback: (Uri?, Intent?) -> Unit)
  private val callbacks = mutableMapOf<Int, Pending>()
  fun open(activity: Activity, intent: Intent, owner: Any, callback: (Uri?, Intent?) -> Unit) {
    val code = serial.incrementAndGet() and 65535
    callbacks[code] = Pending(owner, java.lang.ref.WeakReference(activity), callback)
    try { activity.startActivityForResult(intent, code) }
    catch (_: Exception) { callbacks.remove(code); callback(null, null) }
  }
  fun result(code: Int, result: Int, data: Intent?) {
    callbacks.remove(code)?.callback?.invoke(if (result == Activity.RESULT_OK) data?.data else null, if (result == Activity.RESULT_OK) data else null)
  }
  fun cancel(owner: Any) {
    for ((code, pending) in callbacks.toMap()) if (pending.owner === owner) {
      callbacks.remove(code); pending.callback(null, null); pending.activity.get()?.finishActivity(code)
    }
  }
}

/** Native browser surfaces retain their callbacks until the document is approved or disposed. */
internal class BrowserChrome(private val host: NappletWebView, private val context: Context) : WebChromeClient(), DownloadListener {
  private val activity get() = (context as? ReactContext)?.currentActivity
  private val dialogs = mutableSetOf<AlertDialog>()
  private var fullscreen: View? = null
  private var fullscreenCallback: CustomViewCallback? = null
  private var back: OnBackPressedCallback? = null
  private var fileCallback: ValueCallback<Array<Uri>>? = null
  private val workers = Executors.newSingleThreadExecutor()
  private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()
  private val calls = mutableSetOf<okhttp3.Call>()
  @Volatile private var disposed = false
  private val captures = mutableSetOf<PermissionRequest>()
  private fun title(url: String) = Uri.parse(url).host ?: host.title ?: ""
  override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
    val owner = activity ?: run { result.cancel(); return true }
    val dialog = AlertDialog.Builder(owner).setTitle(title(url)).setMessage(message)
      .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }.setOnCancelListener { result.cancel() }.create()
    show(dialog); return true
  }
  override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
    val owner = activity ?: run { result.cancel(); return true }
    val dialog = AlertDialog.Builder(owner).setTitle(title(url)).setMessage(message)
      .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }.setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
      .setOnCancelListener { result.cancel() }.create()
    show(dialog); return true
  }
  override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String, result: JsPromptResult): Boolean {
    val owner = activity ?: run { result.cancel(); return true }
    val input = EditText(owner).apply { setText(defaultValue); isSingleLine = true }
    val dialog = AlertDialog.Builder(owner).setTitle(title(url)).setMessage(message).setView(input)
      .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm(input.text.toString()) }
      .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.create()
    show(dialog); return true
  }
  private fun show(dialog: AlertDialog) { dialogs.add(dialog); dialog.setOnDismissListener { dialogs.remove(dialog) }; dialog.show() }

  override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
    fileCallback?.onReceiveValue(null); fileCallback = callback
    val owner = activity ?: run { fileCallback = null; callback.onReceiveValue(null); return true }
    val types = params.acceptTypes.flatMap { it.split(',') }.mapNotNull { value ->
      val type = value.trim()
      if (type.startsWith('.')) MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.drop(1).lowercase())
      else type.takeIf { it.contains('/') }
    }.distinct()
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(types.singleOrNull() ?: "*/*")
      .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
    if (types.size > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
    BrowserPickers.open(owner, intent, this) { uri, data ->
      if (fileCallback !== callback) return@open
      fileCallback = null
      val selected = data?.clipData?.let { clip -> Array(clip.itemCount) { clip.getItemAt(it).uri } } ?: uri?.let { arrayOf(it) }
      callback.onReceiveValue(if (disposed) null else selected)
    }
    return true
  }
  private fun nativePermissions(permissions: Array<String>, any: Boolean = false, callback: (Boolean) -> Unit) {
    val owner = activity ?: run { callback(false); return }
    val missing = permissions.filter { owner.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
    if (any && missing.size < permissions.size) { callback(true); return }
    if (missing.isEmpty()) { callback(true); return }
    val receiver = owner as? PermissionAwareActivity ?: run { callback(false); return }
    receiver.requestPermissions(missing.toTypedArray(), 20000 + permissionSerial.incrementAndGet() % 3000, PermissionListener { _, _, grants ->
      callback(!disposed && grants.isNotEmpty() && if (any) grants.any { it == PackageManager.PERMISSION_GRANTED } else grants.all { it == PackageManager.PERMISSION_GRANTED }); true
    })
  }
  override fun onPermissionRequest(request: PermissionRequest) {
    if (!host.sameOrigin(request.origin.toString())) { request.deny(); return }
    val resources = request.resources
    if (resources.any { it !in arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE, PermissionRequest.RESOURCE_AUDIO_CAPTURE) }) { request.deny(); return }
    captures.add(request)
    host.requestBrowser("permission", resources = resources.map { if (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE) "video" else "audio" }) { allowed ->
      if (!captures.contains(request)) return@requestBrowser
      if (!allowed || disposed) { captures.remove(request); request.deny(); return@requestBrowser }
      nativePermissions(resources.map { if (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE) Manifest.permission.CAMERA else Manifest.permission.RECORD_AUDIO }.toTypedArray()) { granted ->
        if (!captures.remove(request)) return@nativePermissions
        if (granted && !disposed) request.grant(resources) else request.deny()
      }
    }
  }
  override fun onPermissionRequestCanceled(request: PermissionRequest) { captures.remove(request) }
  override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
    if (!host.sameOrigin(origin)) { callback.invoke(origin, false, false); return }
    host.requestBrowser("permission", resources = listOf("geolocation")) { allowed ->
      if (!allowed) callback.invoke(origin, false, false)
      else nativePermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), any = true) { callback.invoke(origin, it, false) }
    }
  }
  override fun onShowCustomView(view: View, callback: CustomViewCallback) {
    val owner = activity as? ComponentActivity
    host.requestBrowser("permission", resources = listOf("fullscreen")) { allowed ->
      if (!allowed || disposed || owner == null || owner !== activity || fullscreen != null) { callback.onCustomViewHidden(); return@requestBrowser }
      fullscreen = view; fullscreenCallback = callback
      (owner.window.decorView as ViewGroup).addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      back = object : OnBackPressedCallback(true) { override fun handleOnBackPressed() { onHideCustomView() } }.also { owner.onBackPressedDispatcher.addCallback(owner, it) }
    }
  }
  override fun onHideCustomView() {
    fullscreen?.let { (it.parent as? ViewGroup)?.removeView(it) }; fullscreen = null
    fullscreenCallback?.onCustomViewHidden(); fullscreenCallback = null; back?.remove(); back = null
  }
  override fun onCreateWindow(view: WebView, dialog: Boolean, gesture: Boolean, message: android.os.Message): Boolean {
    val child = WebView(context)
    child.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(web: WebView, request: WebResourceRequest): Boolean {
        host.requestBrowser("window", request.url.toString()); child.destroy(); return true
      }
    }
    (message.obj as WebView.WebViewTransport).webView = child; message.sendToTarget(); return true
  }
  override fun onDownloadStart(url: String, userAgent: String, disposition: String, mime: String, size: Long) {
    if (!url.startsWith("https://") && !url.startsWith("http://")) return
    val name = URLUtil.guessFileName(url, disposition, mime).take(200)
    host.requestBrowser("download", url, filename = name) { allowed ->
      val owner = activity
      if (!allowed || owner == null || disposed) return@requestBrowser
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime.ifBlank { "application/octet-stream" }).putExtra(Intent.EXTRA_TITLE, name)
      val cookie = androidx.webkit.WebViewCompat.getProfile(host).cookieManager.getCookie(url)
      BrowserPickers.open(owner, intent, this) { uri, _ ->
        if (uri == null || disposed) return@open
        workers.execute { download(url, userAgent, cookie, uri) }
      }
    }
  }

  // Keep monitor regions out of nested resource/finally blocks: DEX verification
  // can reject their inlined combination before any WebView can be constructed.
  private fun trackDownload(call: okhttp3.Call) {
    synchronized(calls) {
      calls.add(call)
      if (disposed) call.cancel()
    }
  }
  private fun untrackDownload(call: okhttp3.Call) {
    synchronized(calls) { calls.remove(call) }
  }
  private fun download(url: String, userAgent: String, cookie: String?, uri: Uri) {
    try {
      val initial = url.toHttpUrl()
      var target = initial
      for (redirect in 0..5) {
        if (disposed) error("download-cancelled")
        val request = Request.Builder().url(target).header("User-Agent", userAgent).apply {
          if (cookie != null && target.scheme == initial.scheme && target.host == initial.host && target.port == initial.port) header("Cookie", cookie)
        }.build()
        val call = client.newCall(request)
        trackDownload(call)
        try {
          call.execute().use { response ->
            if (response.code in listOf(301,302,303,307,308)) {
              val next = response.header("Location")?.let { target.resolve(it) } ?: error("invalid-redirect")
              if (next.scheme !in listOf("http", "https") || redirect == 5) error("invalid-redirect")
              target = next
            } else {
              if (!response.isSuccessful) error("download-failed")
              context.contentResolver.openOutputStream(uri)?.use { output -> response.body?.byteStream()?.use { it.copyTo(output) } } ?: error("destination-unavailable")
              return
            }
          }
        } finally { untrackDownload(call) }
      }
    } catch (error: Exception) { android.util.Log.w("PsstBrowser", "Download failed", error) }
  }

  fun dispose() {
    disposed = true; fileCallback?.onReceiveValue(null); fileCallback = null
    captures.toList().forEach { it.deny() }; captures.clear()
    BrowserPickers.cancel(this)
    dialogs.toList().forEach { it.cancel() }; dialogs.clear(); onHideCustomView()
    synchronized(calls) { calls.forEach { it.cancel() }; calls.clear() }; workers.shutdownNow()
  }
  fun navigation() {
    captures.toList().forEach { it.deny() }; captures.clear()
    fileCallback?.onReceiveValue(null); fileCallback = null; BrowserPickers.cancel(this)
    dialogs.toList().forEach { it.cancel() }; dialogs.clear(); onHideCustomView()
  }
}
