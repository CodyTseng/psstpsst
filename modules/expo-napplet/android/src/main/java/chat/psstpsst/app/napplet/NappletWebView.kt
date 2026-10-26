package chat.psstpsst.app.napplet

import android.content.Context
import android.graphics.Color
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.webkit.*
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject

private const val ORIGIN = "https://napplet.psstpsst.invalid"

internal class NappletWebView(context: Context, private val onMessage: (String) -> Unit) : WebView(context) {
  private val web get() = this
  @Volatile private var html = ""
  private val documentUrl = "$ORIGIN/${java.util.UUID.randomUUID()}"
  private var lastReply = 0L
  private var disposed = false
  private var touchActive = false
  private var touchCancelled = false
  private var page: JSONObject? = null
  private var pageValue = ""
  private var pageOrigin = ""
  private var documentNavigating = true
  private var committedPageUrl: String? = null
  private var committedDocument: String? = null
  private var document = java.util.UUID.randomUUID().toString()
  private var startScript: androidx.webkit.ScriptHandler? = null
  private val navigationDownloads = mutableSetOf<String>()
  private val browserRequests = mutableMapOf<String, (Boolean) -> Unit>()
  private val chrome = BrowserChrome(this, context)
  internal fun requestBrowser(action: String, target: String? = null, resources: List<String>? = null, filename: String? = null, callback: (Boolean) -> Unit = {}) {
    if (disposed || page == null || browserRequests.size >= 16) { callback(false); return }
    val id = "browser:${java.util.UUID.randomUUID()}"
    if (action == "download" && documentNavigating) navigationDownloads.add(id)
    browserRequests[id] = { allowed -> navigationDownloads.remove(id); callback(allowed); if (action == "download") restoreCommittedDocument() }
    onMessage(JSONObject(envelope("explore.browser")).apply {
      if (action == "download" && documentNavigating) {
        put("policyDocument", committedDocument ?: document)
        committedPageUrl?.let { put("origin", origin(it)); put("url", it) }
      }
    }.put("browser", JSONObject().put("id", id).put("action", action)
      .apply { if(target != null) put("url",target); if(resources != null) put("resources",JSONArray(resources)); if(filename != null) put("filename",filename) }).toString())
  }
  private fun restoreCommittedDocument(completion: (Boolean) -> Unit = {}) {
    val previous = committedDocument; val source = committedPageUrl; val pending = document
    if (navigationDownloads.isNotEmpty() || !documentNavigating || previous == null || source == null || disposed) { completion(false); return }
    evaluateJavascript("window.__exploreNativeDocumentToken") { token ->
      if (navigationDownloads.isNotEmpty() || !documentNavigating || document != pending || disposed || token != JSONObject.quote(previous)) { completion(false); return@evaluateJavascript }
      documentNavigating = false
      document = java.util.UUID.randomUUID().toString()
      committedDocument = document
      cancelBrowser(); chrome.navigation()
      onMessage(JSONObject(envelope("explore.navigation")).put("phase", "resume").put("previousDocument", previous)
        .put("origin", origin(source)).put("url", source).toString())
      evaluateJavascript("window.__exploreNativeDocumentToken=${JSONObject.quote(document)};window.__exploreDocumentCommitted=true;window.__exploreCommit?.()", null)
      completion(true)
    }
  }
  private fun cancelBrowser() { val pending=browserRequests.values.toList();browserRequests.clear();navigationDownloads.clear();pending.forEach { it(false) } }
  private fun origin(value: String): String {
    val uri = android.net.Uri.parse(value)
    val port = uri.port
    return "${uri.scheme}://${uri.host}" + if (port > 0 && !(uri.scheme == "https" && port == 443) && !(uri.scheme == "http" && port == 80)) ":$port" else ""
  }
  internal fun sameOrigin(value: String) = origin(value) == origin(url ?: "")
  private fun envelope(type: String, raw: String? = null): String = JSONObject().put("type",type).put("origin",origin(url ?: pageOrigin))
    .put("document",document).put("url",url ?: pageOrigin).apply { if(raw != null) put("raw",raw) }.toString()

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> { touchActive = true; touchCancelled = false }
      MotionEvent.ACTION_UP -> touchActive = false
      MotionEvent.ACTION_CANCEL -> { touchActive = false; touchCancelled = true }
    }
    return super.dispatchTouchEvent(event)
  }

  override fun onCancelPendingInputEvents() {
    val cancelTouch = touchActive
    touchActive = false
    if (cancelTouch && !disposed) {
      touchCancelled = true
      val now = SystemClock.uptimeMillis()
      val cancel = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0f, 0f, 0)
      try { super.onTouchEvent(cancel) } finally { cancel.recycle() }
    }
    super.onCancelPendingInputEvents()
  }

  override fun performHapticFeedback(feedbackConstant: Int, flags: Int): Boolean {
    // Chromium can acknowledge a long press after system Back has cancelled its touch.
    // Keep live page feedback, but never add a stale long-press buzz to system navigation.
    if (feedbackConstant == HapticFeedbackConstants.LONG_PRESS && touchCancelled) return false
    return super.performHapticFeedback(feedbackConstant, flags)
  }

  init {
    setBackgroundColor(Color.TRANSPARENT)
    ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
      // AppScreen already keeps this WebView inside the system safe area.
      // Forward zeroes to reset CSS safe-area values, while retaining IME insets.
      val safeArea = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      WindowInsetsCompat.Builder(insets)
        .setInsets(safeArea, Insets.NONE)
        .setInsetsIgnoringVisibility(safeArea, Insets.NONE)
        .setDisplayCutout(null)
        .build()
    }
    web.settings.apply {
      javaScriptEnabled = true; domStorageEnabled = false; databaseEnabled = false
      allowFileAccess = false; allowContentAccess = false; javaScriptCanOpenWindowsAutomatically = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; cacheMode = WebSettings.LOAD_NO_CACHE
      setSupportMultipleWindows(true); mediaPlaybackRequiresUserGesture = true
    }
    web.webChromeClient = chrome
    web.setDownloadListener(chrome)
    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        page?.let { config ->
          val scheme = request.url.scheme
          val blocked = scheme !in setOf("http","https") || (!config.has("url") && origin(request.url.toString()) != pageOrigin)
          if (blocked && request.isForMainFrame) requestBrowser(if(scheme in setOf("http","https")) "window" else "external", request.url.toString())
          return blocked
        }
        // srcdoc and its initial blank document stay inside the sandboxed frame.
        if (request.isForMainFrame) return request.url.toString() != documentUrl
        return request.url.toString().substringBefore('#') !in setOf("about:blank", "about:srcdoc")
      }
      override fun onPageStarted(view: WebView, value: String, favicon: android.graphics.Bitmap?) {
        if(page != null) { documentNavigating=true;cancelBrowser();chrome.navigation();document=java.util.UUID.randomUUID().toString();onMessage(JSONObject(envelope("explore.navigation")).put("phase","start").toString()) }
      }
      override fun onPageFinished(view: WebView, value: String) {
        if (page != null && documentNavigating) restoreCommittedDocument()
      }
      override fun onPageCommitVisible(view: WebView, value: String) {
        if (page == null || view.url != value) return
        committedPageUrl = value
        committedDocument = document
        documentNavigating = false
        onMessage(JSONObject(envelope("explore.navigation")).put("phase", "commit").toString())
        evaluateJavascript("window.__exploreNativeDocumentToken=${JSONObject.quote(document)};window.__exploreDocumentCommitted=true;window.__exploreCommit?.()", null)
      }
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (page == null || !request.isForMainFrame || navigationDownloads.isNotEmpty()) return
        val pending = document
        restoreCommittedDocument { restored ->
          if (!restored && document == pending) onMessage(JSONObject(envelope("explore.error")).put("url", request.url.toString())
            .put("error", "${error.errorCode}: ${error.description}").toString())
        }
      }
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        page?.let { config ->
          if (config.has("url")) return null
          if (origin(request.url.toString()) == pageOrigin) {
            val files=config.optJSONArray("files") ?: JSONArray()
            val path=request.url.path ?: "/"
            for(i in 0 until files.length()) {
              val file=files.getJSONObject(i)
              if(file.getString("path") == path || file.getString("path") == "${path}index.html" && path.endsWith("/")) {
                val bytes=android.util.Base64.decode(file.getString("body"),android.util.Base64.DEFAULT)
                val network=if(config.optBoolean("network")) "https: http: wss: ws:" else ""
                return WebResourceResponse(file.getString("mime"),"UTF-8",200,"OK",mapOf("Content-Security-Policy" to "default-src 'self' data: blob: $network; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: $network; style-src 'self' 'unsafe-inline' $network; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'"),java.io.ByteArrayInputStream(bytes))
              }
            }
            return WebResourceResponse("text/plain","UTF-8",404,"Not Found",emptyMap(),java.io.ByteArrayInputStream(byteArrayOf()))
          }
          if(config.optBoolean("network") || request.url.scheme in setOf("data","blob","about")) return null
          return WebResourceResponse("text/plain","UTF-8",403,"Blocked",emptyMap(),java.io.ByteArrayInputStream(byteArrayOf()))
        }
        if (request.isForMainFrame && request.method == "GET" && request.url.toString() == documentUrl) {
          return WebResourceResponse("text/html", "UTF-8", 200, "OK",
            mapOf("Cache-Control" to "no-store", "Referrer-Policy" to "no-referrer"),
            java.io.ByteArrayInputStream(html.toByteArray(Charsets.UTF_8)))
        }
        // Local data resources carry no network authority. CSP still limits their use.
        if (!request.isForMainFrame && request.url.scheme in setOf("data", "about")) return null
        return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), java.io.ByteArrayInputStream(byteArrayOf()))
      }
    }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      WebViewCompat.addWebMessageListener(web, "__nappletHost", setOf(ORIGIN)) { _, message, source, mainFrame, _ ->
        if (mainFrame && source.toString().trimEnd('/') == ORIGIN) {
          val raw = message.data
          if (raw != null && raw.length <= 1500000) onMessage(raw)
        }
      }
    }
  }
  fun loadPage(value: String) {
    if(value == pageValue) return
    require(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) { "napplets.rebuild_required" }
    require(WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) { "napplets.rebuild_required" }
    pageValue=value
    val config=JSONObject(value);page=config
    val profileHash=java.security.MessageDigest.getInstance("SHA-256").digest(config.optString("storageId",config.getString("sourceId")).toByteArray()).joinToString("") { "%02x".format(it) }
    WebViewCompat.setProfile(web,"explore-$profileHash")
    val hash=java.security.MessageDigest.getInstance("SHA-256").digest(config.getString("sourceId").toByteArray()).joinToString("") { "%02x".format(it) }
    pageOrigin="https://$hash.explore.psstpsst.invalid"
    settings.domStorageEnabled=true
    WebViewCompat.removeWebMessageListener(web,"__nappletHost")
    WebViewCompat.addWebMessageListener(web,"__nappletHost",setOf("*")) { _, message, source, main, _ ->
      if(!documentNavigating && main && source.scheme in setOf("http","https") && origin(source.toString()) == origin(committedPageUrl ?: "")) {
        message.data?.let { raw -> if(raw.length <= 1500000 && runCatching { JSONObject(raw).optString("documentToken") == document }.getOrDefault(false)) onMessage(envelope("explore.request",raw)) }
      }
    }
    startScript?.remove()
    startScript=WebViewCompat.addDocumentStartJavaScript(web,config.getString("script"),setOf("*"))
    loadUrl(if(config.has("url")) config.getString("url") else "$pageOrigin/index.html")
  }
  fun loadDocument(value: String) {
    if (value.isEmpty() || value == html || page != null) return
    html = value
    web.loadUrl(documentUrl)
  }
  fun reply(value: String) {
    if (value.isEmpty()) return
    val batch = JSONArray(value)
    for (index in 0 until batch.length()) {
      val entry = batch.getJSONObject(index)
      val serial = entry.getLong("serial")
      if (serial <= lastReply) continue
      lastReply = serial
      val message = entry.getString("message")
      if(page != null) {
        val response=JSONObject(message)
        if(response.optString("document") == document && response.optJSONObject("reply")?.optString("type") == "browser.result") {
          val reply=response.getJSONObject("reply");browserRequests.remove(reply.optString("id"))?.invoke(reply.optBoolean("result"));continue
        }
        if(!disposed && response.optString("document") == document) evaluateJavascript("if(${response.getJSONObject("reply").optString("type") == "theme"} || window.__exploreDocumentToken === ${JSONObject.quote(response.getJSONObject("reply").optString("nonce"))}) { window.__exploreReceive && window.__exploreReceive(${response.getJSONObject("reply")}) }",null)
        continue
      }
      if (!disposed) web.evaluateJavascript("window.__hostReceive && window.__hostReceive(JSON.parse(${JSONObject.quote(message)}))", null)
    }
  }
  fun navigateBack(): Boolean {
    if (disposed || copyBackForwardList().currentIndex <= 0) return false
    // Programmatic History traversal retains entries without user activation.
    evaluateJavascript("history.back()", null)
    return true
  }
  fun dispose() { if (disposed) return; disposed = true; cancelBrowser();chrome.dispose();visibility = INVISIBLE; web.stopLoading(); web.destroy(); html = "" }
}
