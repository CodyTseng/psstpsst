package chat.psstpsst.app.napplet

import android.content.Context
import android.util.Base64
import android.webkit.*
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.functions.Queues
import java.lang.ref.WeakReference
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl


private class FetchTask { @Volatile var call: Call? = null; val cancelled = AtomicBoolean(false) }

class ExpoNappletModule : Module() {
  private val views = mutableMapOf<String, WeakReference<NappletView>>()
  private val executor = Executors.newFixedThreadPool(4)
  private val calls = ConcurrentHashMap<String, FetchTask>()
  private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
    .connectTimeout(10, TimeUnit.SECONDS).callTimeout(20, TimeUnit.SECONDS)
    .proxy(java.net.Proxy.NO_PROXY)
    .dns(PublicDns()).build()
  override fun definition() = ModuleDefinition {
    Name("ExpoNapplet")
    Function("isAvailable") { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }
    AsyncFunction("fetchResourceAsync") { id: String, value: String, max: Int, promise: Promise ->
      val task = FetchTask()
      val admitted = synchronized(calls) { if (calls.size >= 12 || id.length > 128 || value.length > 4096) false else { calls[id] = task; true } }
      if (!admitted) promise.reject("ERR_RESOURCE", "quota-exceeded", null)
      else executor.execute {
        try {
          require(!task.cancelled.get()) { "cancelled" }
          val url = value.toHttpUrl()
          require((!(url.host.matches(Regex("[0-9.]+")) || url.host.contains(":")) || publicAddress(InetAddress.getByName(url.host))) && url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.port == 443 && max in 1..26214400) { "blocked-by-policy" }
          val call = client.newCall(Request.Builder().url(url).header("Accept-Encoding", "identity").build())
          task.call = call
          if (task.cancelled.get()) call.cancel()
          call.execute().use { response ->
            require(response.code == 200) { "resource-unavailable" }
            val body = response.body ?: error("resource-unavailable")
            require(body.contentLength() <= max) { "too-large" }
            val output = java.io.ByteArrayOutputStream()
            body.byteStream().use { input ->
              val buffer = ByteArray(16384)
              while (true) { val count = input.read(buffer); if (count < 0) break
                require(output.size() + count <= max) { "too-large" }; output.write(buffer, 0, count)
              }
            }
            promise.resolve(Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
          }
        } catch (error: Exception) { promise.reject("ERR_RESOURCE", error.message ?: "network-error", error) }
        finally { calls.remove(id) }
      }
    }
    AsyncFunction("cancelResourceAsync") { id: String -> calls[id]?.let { it.cancelled.set(true); it.call?.cancel() }; Unit }
    AsyncFunction("sendAsync") { id: String, message: String -> views[id]?.get()?.reply(message); Unit }.runOnQueue(Queues.MAIN)
    AsyncFunction("closeAsync") { id: String -> views.remove(id)?.get()?.dispose(); Unit }.runOnQueue(Queues.MAIN)
    AsyncFunction("goBackAsync") { id: String -> views[id]?.get()?.navigateBack() ?: false }.runOnQueue(Queues.MAIN)
    View(NappletView::class) {
      Events("onMessage")
      Prop("html") { view: NappletView, html: String -> view.load(html) }
      Prop("surfaceId") { view: NappletView, id: String -> views[id] = WeakReference(view) }
      OnViewDestroys { view: NappletView -> views.entries.removeAll { it.value.get() === view }; view.dispose() }
    }
    OnDestroy { calls.values.forEach { it.cancelled.set(true); it.call?.cancel() }; executor.shutdownNow() }
  }
}

class NappletView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onMessage by EventDispatcher()
  private val web = NappletWebView(context) { raw -> onMessage(mapOf("message" to raw)) }
  init { addView(web, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) }
  fun load(value: String) = web.loadDocument(value)
  fun reply(value: String) = web.reply(value)
  fun navigateBack() = web.navigateBack()
  fun dispose() { removeView(web); web.dispose() }
}
