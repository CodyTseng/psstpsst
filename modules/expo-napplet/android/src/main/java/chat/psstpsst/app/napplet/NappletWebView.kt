package chat.psstpsst.app.napplet

import android.content.Context
import android.webkit.*
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
  init {
    web.settings.apply {
      javaScriptEnabled = true; domStorageEnabled = false; databaseEnabled = false
      allowFileAccess = false; allowContentAccess = false; javaScriptCanOpenWindowsAutomatically = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; cacheMode = WebSettings.LOAD_NO_CACHE
      setSupportMultipleWindows(false); mediaPlaybackRequiresUserGesture = true
    }
    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // srcdoc and its initial blank document stay inside the sandboxed frame.
        return request.isForMainFrame || request.url.toString() !in setOf("about:blank", "about:srcdoc")
      }
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
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
  fun loadDocument(value: String) {
    if (value == html) return
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
      if (!disposed) web.evaluateJavascript("window.__hostReceive && window.__hostReceive(JSON.parse(${JSONObject.quote(message)}))", null)
    }
  }
  fun dispose() { if (disposed) return; disposed = true; web.stopLoading(); web.destroy(); html = "" }
}
